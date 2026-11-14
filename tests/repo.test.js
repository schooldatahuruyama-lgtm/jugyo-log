// リポジトリの土台（開発ルール、道具、設定）がそろっているかと、
// データベースの出し入れ（js/repo.js・js/dev/memory-net.js）を確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRepo } from '../js/repo.js';
import { createMemoryNet } from '../js/dev/memory-net.js';
import { fileRefs } from '../js/lesson-logic.js';
import { NetError } from '../js/errors.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const at = (p) => join(root, p);

test('リポジトリの土台がそろっている', () => {
  for (const p of [
    'CLAUDE.md',
    'AGENTS.md',
    'docs/requirements.md',
    'tools/codex-review.ps1',
    'tools/codex-implement.ps1',
    'tools/pages-branch.ps1',
  ]) {
    assert.ok(existsSync(at(p)), `${p} がありません`);
  }
  const pkg = JSON.parse(readFileSync(at('package.json'), 'utf8'));
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.scripts.test, 'node --test "tests/*.test.js"');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  const ignore = readFileSync(at('.gitignore'), 'utf8').split(/\r?\n/);
  assert.ok(ignore.includes('.superpowers/'), '.gitignore に .superpowers/ がありません');
});

// ---- ここから下は、データベースの出し入れ（js/repo.js）を、メモリ上の net を相手に確かめる ----

// net の呼び出しを数える（書きこみの回数と、get と getPublic のどちらを使ったか）
function counted(net) {
  const calls = { get: [], getPublic: [], set: [], update: [], remove: [] };
  const wrapped = { ...net };
  for (const name of Object.keys(calls)) {
    wrapped[name] = (...args) => { calls[name].push(args); return net[name](...args); };
  }
  return { net: wrapped, calls };
}

function setup(initial = null) {
  const mem = createMemoryNet({ initial });
  const { net, calls } = counted(mem);
  return { mem, repo: createRepo(net), calls };
}

const writes = (calls) => calls.set.length + calls.update.length + calls.remove.length;

test('先生の用語: 1 回の update で追加・削除と日時を変え、資料とほかの用語を残す', async () => {
  const materials = { m1: { fileId: 'F' } };
  const lesson = { title: '光', createdAt: 10, updatedAt: 20, materials, terms: { keep: '鏡' } };
  const { repo, mem, calls } = setup({ lessons: { c1: { l1: lesson } } });
  await repo.addLessonTerm('c1', 'l1', 'term00000001', '光の反射', 100);
  assert.equal(writes(calls), 1);
  assert.deepEqual(calls.update[0], ['', {
    'lessons/c1/l1/terms/term00000001': '光の反射', 'lessons/c1/l1/updatedAt': 100,
  }]);
  assert.deepEqual(await mem.get('lessons/c1/l1'), { ...lesson, updatedAt: 100, terms: { keep: '鏡', term00000001: '光の反射' } });
  await repo.removeLessonTerm('c1', 'l1', 'term00000001', 200);
  assert.equal(writes(calls), 2);
  assert.deepEqual(calls.update[1], ['', {
    'lessons/c1/l1/terms/term00000001': null, 'lessons/c1/l1/updatedAt': 200,
  }]);
  assert.deepEqual(await mem.get('lessons/c1/l1'), { ...lesson, updatedAt: 200 });
});

test('授業と資料の編集: updateLesson・addMaterial・setMaterialOrders・removeMaterial は用語を残す', async () => {
  const terms = { term00000001: '光の反射' };
  const { repo, mem } = setup({ lessons: { c1: { l1: { title: '光', terms } } } });
  await repo.updateLesson('c1', 'l1', { date: '2026-11-15', title: '反射', unitId: '' }, 100);
  assert.deepEqual(await mem.get('lessons/c1/l1/terms'), terms);
  await repo.addMaterial([{ classId: 'c1', lessonId: 'l1', order: 0 }], 'm1', { fileId: 'F' }, '画像', 200);
  assert.deepEqual(await mem.get('lessons/c1/l1/terms'), terms);
  await repo.setMaterialOrders('c1', 'l1', { m1: 1 }, 300);
  assert.deepEqual(await mem.get('lessons/c1/l1/terms'), terms);
  await repo.removeMaterial('c1', 'l1', 'm1', 400);
  assert.deepEqual(await mem.get('lessons/c1/l1/terms'), terms);
});

test('getLesson・listLessons: 用語は生のオブジェクト、無いものや型違いは空。listAllLessons は生のまま', async () => {
  const terms = { term00000001: ' ＡＢＣ ', bad: 3 };
  const lessons = { c1: { l1: { terms }, l2: { title: '光' }, l3: { terms: ['光'] }, l4: { terms: '光' } } };
  const { repo } = setup({ lessons });
  assert.deepEqual((await repo.getLesson('c1', 'l1')).terms, terms);
  for (const lesson of await repo.listLessons('c1')) {
    assert.deepEqual(lesson.terms, lesson.id === 'l1' ? terms : {});
    assert.deepEqual((await repo.getLesson('c1', lesson.id)).terms, lesson.terms);
  }
  assert.deepEqual(await repo.listAllLessons(), lessons);
});

test('getMyTerms・getMyLessonTerms: 1 回で読み、t1〜t8 の文字だけを生のまま返す', async () => {
  const value = { t8: '鏡', t1: ' ＡＢＣ ', t2: '', t3: 3, t4: {}, t9: '外', t01: '外', 't1\n': '外' };
  const { repo, calls } = setup({ terms: { 's00-001': { c1: { l1: value, l2: { t2: '光' }, bad: '不正', array: ['光'] } } } });
  const expected = { t8: '鏡', t1: ' ＡＢＣ ', t2: '' };
  assert.deepEqual(await repo.getMyTerms('s00-001', 'c1'), { l1: expected, l2: { t2: '光' } });
  assert.deepEqual(calls.get, [['terms/s00-001/c1']]);
  assert.deepEqual(await repo.getMyLessonTerms('s00-001', 'c1', 'l1'), expected);
  assert.deepEqual(calls.get.at(-1), ['terms/s00-001/c1/l1']);
  assert.equal(writes(calls), 0);
  for (const value of [null, undefined, 3, '文字', [], ['光']]) {
    const direct = createRepo({ get: async () => value });
    assert.deepEqual(await direct.getMyTerms('s00-001', 'c1'), {});
    assert.deepEqual(await direct.getMyLessonTerms('s00-001', 'c1', 'l1'), {});
  }
});

test('setMyTerm・removeMyTerm: 指定の置き場所だけを書き、ほかの授業・用語を残す', async () => {
  const { repo, mem, calls } = setup({ terms: { 's00-001': { c1: { l1: { t2: '鏡' }, l2: { t1: '光' } } } } });
  await repo.setMyTerm('s00-001', 'c1', 'l1', 't1', '光の反射');
  assert.deepEqual(calls.set, [['terms/s00-001/c1/l1/t1', '光の反射']]);
  assert.equal(writes(calls), 1);
  assert.deepEqual(await mem.get('terms/s00-001/c1/l1'), { t1: '光の反射', t2: '鏡' });
  await repo.removeMyTerm('s00-001', 'c1', 'l1', 't1');
  assert.deepEqual(calls.remove, [['terms/s00-001/c1/l1/t1']]);
  assert.equal(writes(calls), 2);
  assert.deepEqual(await mem.get('terms/s00-001/c1'), { l1: { t2: '鏡' }, l2: { t1: '光' } });
});

test('用語の通信: 不正な置き場所・ID は通信の前に断る', async () => {
  const { repo, calls } = setup();
  for (const slot of ['t9', 't0', 't01', 't1\n', 't1/x', '', null, 1, ['t1']]) {
    await assert.rejects(repo.setMyTerm('s00-001', 'c1', 'l1', slot, '光'), TypeError);
    await assert.rejects(repo.removeMyTerm('s00-001', 'c1', 'l1', slot), TypeError);
  }
  for (let i = 0; i < 3; i++) {
    const ids = ['c1', 'l1', 'term00000001'];
    ids[i] = 'bad/key';
    await assert.rejects(repo.addLessonTerm(...ids, '光', 100), TypeError);
    await assert.rejects(repo.removeLessonTerm(...ids, 100), TypeError);
    const own = ['s00-001', 'c1', 'l1'];
    own[i] = 'bad/key';
    await assert.rejects(repo.getMyLessonTerms(...own), TypeError);
    await assert.rejects(repo.setMyTerm(...own, 't1', '光'), TypeError);
    await assert.rejects(repo.removeMyTerm(...own, 't1'), TypeError);
    if (i < 2) await assert.rejects(repo.getMyTerms(...own.slice(0, 2)), TypeError);
  }
  assert.equal(writes(calls), 0);
  assert.equal(calls.get.length, 0);
});

test('用語の通信: NetError はそのまま伝える', async () => {
  for (const code of ['network', 'denied']) {
    const error = new NetError(code);
    const fail = async () => { throw error; };
    const repo = createRepo({ get: fail, set: fail, update: fail, remove: fail });
    await assert.rejects(repo.addLessonTerm('c1', 'l1', 'term00000001', '光', 100), (e) => e === error);
    await assert.rejects(repo.removeLessonTerm('c1', 'l1', 'term00000001', 100), (e) => e === error);
    await assert.rejects(repo.getMyTerms('s00-001', 'c1'), (e) => e === error);
    await assert.rejects(repo.getMyLessonTerms('s00-001', 'c1', 'l1'), (e) => e === error);
    await assert.rejects(repo.setMyTerm('s00-001', 'c1', 'l1', 't1', '光'), (e) => e === error);
    await assert.rejects(repo.removeMyTerm('s00-001', 'c1', 'l1', 't1'), (e) => e === error);
  }
});

test('listRecords: 2 人分を 1 回で読み、getRecord と同じ形で返す。書きこみをしない', async () => {
  const first = { memo: 'メモ', level: 4, learned: '分かったこと', question: '', updatedAt: 10 };
  const second = { memo: 5, level: '3', learned: 'あ'.repeat(2001), question: null, updatedAt: '20', extra: true };
  const { repo, mem, calls } = setup({ records: { c1: { l1: { 's26-001': first, 's26-002': second } } } });
  const before = mem.dump();
  const result = await repo.listRecords('c1', 'l1');
  assert.deepEqual(result, {
    's26-001': { ...first, attachments: [] },
    's26-002': { memo: '', level: null, learned: 'あ'.repeat(2000), question: '', updatedAt: 0, attachments: [] },
  });
  assert.deepEqual(calls.get, [['records/c1/l1']]);
  assert.equal(calls.getPublic.length, 0);
  assert.equal(writes(calls), 0);
  assert.deepEqual(mem.dump(), before);
  for (const sid of Object.keys(result)) assert.deepEqual(result[sid], await repo.getRecord('c1', 'l1', sid));
});

test('listRecords: 無ければ空。オブジェクトでない 1 人分は入れない', async () => {
  const { repo } = setup();
  assert.deepEqual(await repo.listRecords('c1', 'l1'), {});
  for (const value of [null, undefined, [], [{ memo: '不正な一覧' }], 'x', 1]) {
    assert.deepEqual(await createRepo({ get: async () => value }).listRecords('c1', 'l1'), {});
  }
  const all = { 's26-001': {}, 's26-002': 'x', 's26-003': null, 's26-004': [], 's26-005': 1 };
  assert.deepEqual(await createRepo({ get: async () => all }).listRecords('c1', 'l1'), {
    's26-001': { memo: '', level: null, learned: '', question: '', updatedAt: 0, attachments: [] },
  });
  for (const updatedAt of [undefined, null, NaN, Infinity]) {
    const direct = createRepo({ get: async () => ({ 's26-001': { updatedAt } }) });
    assert.equal((await direct.listRecords('c1', 'l1'))['s26-001'].updatedAt, 0);
  }
});

test('saveRecord: 理解度なしは level を置かず、1 回の update で記録を保存し印を消す', async () => {
  const { repo, mem, calls } = setup({ marks: { 's26-001': { c1: { l1: 3, l2: 4 } } } });
  const record = { memo: 'm', level: null, learned: '', question: '' };
  await repo.saveRecord('c1', 'l1', 's26-001', record, 5000);
  assert.equal(writes(calls), 1);
  assert.deepEqual(calls.update, [['', {
    'records/c1/l1/s26-001/memo': 'm', 'records/c1/l1/s26-001/learned': '',
    'records/c1/l1/s26-001/question': '', 'records/c1/l1/s26-001/updatedAt': 5000,
    'records/c1/l1/s26-001/level': null,
    'marks/s26-001/c1/l1': null,
  }]]);
  assert.equal(Object.hasOwn(await mem.get('records/c1/l1/s26-001'), 'level'), false);
  assert.equal(await mem.get('marks/s26-001/c1/l1'), null);
  assert.equal(await mem.get('marks/s26-001/c1/l2'), 4);
  assert.deepEqual(await repo.getRecord('c1', 'l1', 's26-001'), { ...record, updatedAt: 5000, attachments: [] });
});

test('saveRecord: 理解度を記録と印に 1 回で置き、余分な項目を保存しない', async () => {
  for (const level of [1, 3, 4]) {
    const { repo, mem, calls } = setup();
    const record = { memo: 'm', level, learned: 'l', question: 'q', extra: true };
    const before = structuredClone(record);
    await repo.saveRecord('c1', 'l1', 's26-001', record, 5000);
    assert.equal(writes(calls), 1);
    assert.deepEqual(calls.update, [['', {
      'records/c1/l1/s26-001/memo': 'm', 'records/c1/l1/s26-001/learned': 'l',
      'records/c1/l1/s26-001/question': 'q', 'records/c1/l1/s26-001/updatedAt': 5000,
      'records/c1/l1/s26-001/level': level,
      'marks/s26-001/c1/l1': level,
    }]]);
    assert.equal(await mem.get('records/c1/l1/s26-001/level'), level);
    assert.equal(await mem.get('marks/s26-001/c1/l1'), level);
    assert.deepEqual(record, before);
  }
});

test('saveRecord・getRecord: 欠けた項目・型の違い・上限をそろえる', async () => {
  const { repo, mem } = setup();
  assert.equal(await repo.getRecord('c1', 'l1', 's26-001'), null);
  const bad = { memo: 5, level: '3', learned: 'あ'.repeat(2001), question: null, updatedAt: '5000' };
  await mem.set('records/c1/l1/s26-001', bad);
  assert.deepEqual(await repo.getRecord('c1', 'l1', 's26-001'), { memo: '', level: null, learned: 'あ'.repeat(2000), question: '', updatedAt: 0, attachments: [] });
  await repo.saveRecord('c1', 'l1', 's26-001', bad, 5000);
  assert.deepEqual(await mem.get('records/c1/l1/s26-001'), { memo: '', learned: 'あ'.repeat(2000), question: '', updatedAt: 5000 });
  for (const updatedAt of [undefined, null, NaN, Infinity]) {
    const direct = createRepo({ get: async () => ({ memo: 'm', updatedAt }) });
    assert.equal((await direct.getRecord('c1', 'l1', 's26-001')).updatedAt, 0);
  }
});

test('getMarks: 1〜4 の整数だけを返し、数字のキーの配列にも対応する', async () => {
  const { repo, calls } = setup({ marks: { 's26-001': { c1: { l1: 3, l2: 'x', l3: 9, l4: 1, l5: 4, l6: 2.5, l7: 0 } } } });
  assert.deepEqual(await repo.getMarks('s26-001', 'c1'), { l1: 3, l4: 1, l5: 4 });
  assert.deepEqual(await repo.getMarks('s26-001', 'missing'), {});
  assert.deepEqual(calls.get, [['marks/s26-001/c1'], ['marks/s26-001/missing']]);
  assert.deepEqual(await createRepo({ get: async () => [null, 1, 4, '3', NaN, Infinity] }).getMarks('s26-001', 'c1'), { 1: 1, 2: 4 });
});

test('saveRecord: 添付を残して項目ごとに 1 回で書き、理解度を消しても添付は残る', async () => {
  const { repo, mem, calls } = setup();
  const item = { type: 'image', fileId: 'file-a', bytes: 3 };
  await repo.addAttachment('c1', 'l1', 's26-001', 'a1', item, '画像', 100);
  const saved = { a1: { ...item, addedAt: 100 } };
  for (const level of [3, null]) {
    const before = writes(calls);
    await repo.saveRecord('c1', 'l1', 's26-001', { memo: 'メモ', level, attachments: {} }, 200);
    assert.equal(writes(calls), before + 1);
    assert.deepEqual(calls.update.at(-1), ['', {
      'records/c1/l1/s26-001/memo': 'メモ', 'records/c1/l1/s26-001/learned': '',
      'records/c1/l1/s26-001/question': '', 'records/c1/l1/s26-001/updatedAt': 200,
      'records/c1/l1/s26-001/level': level, 'marks/s26-001/c1/l1': level,
    }]);
    assert.deepEqual(await mem.get('records/c1/l1/s26-001/attachments'), saved);
    assert.equal(await mem.get('records/c1/l1/s26-001/level'), level);
    assert.equal(await mem.get('marks/s26-001/c1/l1'), level);
    assert.equal(await mem.get('recThumbs/c1/l1/s26-001/a1'), '画像');
  }
});

test('addAttachment: 目録と画像だけを 1 回で書き、文字と更新日時と印を変えない', async () => {
  const record = { memo: 'メモ', level: 4, learned: '分かった', question: '疑問', updatedAt: 10 };
  const { repo, mem, calls } = setup({ records: { c1: { l1: { 's26-001': record } } }, marks: { 's26-001': { c1: { l1: 4 } } } });
  const item = { type: 'image', fileId: 'file-a', bytes: 3 };
  await repo.addAttachment('c1', 'l1', 's26-001', 'a1', { ...item, name: '保存しない名前' }, '画像', 100);
  assert.equal(writes(calls), 1);
  assert.deepEqual(calls.update, [['', {
    'records/c1/l1/s26-001/attachments/a1': { ...item, addedAt: 100 }, 'recThumbs/c1/l1/s26-001/a1': '画像',
  }]]);
  assert.deepEqual(await mem.get('records/c1/l1/s26-001'), { ...record, attachments: { a1: { ...item, addedAt: 100 } } });
  assert.equal(await mem.get('marks/s26-001/c1/l1'), 4);
});

test('addAttachment: 文字以外の thumb は書かず、同じ置き場所はあとの 1 個が残る', async () => {
  const { repo, mem, calls } = setup();
  for (const thumb of [null, undefined, 3, {}]) {
    const before = writes(calls);
    const item = { type: 'pdf', fileId: `file-${before}`, bytes: 100 };
    await repo.addAttachment('c1', 'l1', 's26-001', 'a1', item, thumb, before);
    assert.equal(writes(calls), before + 1);
    assert.deepEqual(calls.update.at(-1), ['', { 'records/c1/l1/s26-001/attachments/a1': { ...item, addedAt: before } }]);
    assert.deepEqual(await mem.get('records/c1/l1/s26-001/attachments'), { a1: { ...item, addedAt: before } });
  }
  assert.equal(await mem.get('recThumbs'), null);
});

test('removeAttachment: 目録と画像を 1 回で消し、文字・日時・ほかの置き場所を残す', async () => {
  const record = { memo: 'メモ', updatedAt: 10 };
  const item = { type: 'image', fileId: 'file-a', bytes: 3, addedAt: 100 };
  const { repo, mem, calls } = setup({ records: { c1: { l1: { 's26-001': { ...record, attachments: { a1: item, a2: item } } } } },
    recThumbs: { c1: { l1: { 's26-001': { a1: '画像1', a2: '画像2' } } } } });
  await repo.removeAttachment('c1', 'l1', 's26-001', 'a1');
  assert.equal(writes(calls), 1);
  assert.deepEqual(calls.update, [['', { 'records/c1/l1/s26-001/attachments/a1': null, 'recThumbs/c1/l1/s26-001/a1': null }]]);
  assert.deepEqual(await mem.get('records/c1/l1/s26-001'), { ...record, attachments: { a2: item } });
  assert.deepEqual(await repo.getRecThumbs('c1', 'l1', 's26-001'), { a2: '画像2' });
});

test('getRecord・listRecords: 添付を選別して足した順に返す', async () => {
  const item = { type: 'image', fileId: 'file-a', bytes: 3, addedAt: 100 };
  const { repo } = setup({ records: { c1: { l1: { 's26-001': { attachments: { a1: item, a2: { ...item, addedAt: 50 }, a7: item, a3: '不正' } } } } } });
  const result = await repo.getRecord('c1', 'l1', 's26-001');
  assert.deepEqual(result.attachments, [{ slot: 'a2', ...item, addedAt: 50 }, { slot: 'a1', ...item }]);
  assert.deepEqual((await repo.listRecords('c1', 'l1'))['s26-001'], result);
});

test('getRecThumbs: 文字だけを読み、無ければ空で書きこまない', async () => {
  const { repo, calls } = setup({ recThumbs: { c1: { l1: { 's26-001': { a1: 'data:image/jpeg;base64,AQID', a2: 3, a3: {} } } } } });
  assert.deepEqual(await repo.getRecThumbs('c1', 'l1', 's26-001'), { a1: 'data:image/jpeg;base64,AQID' });
  assert.deepEqual(await repo.getRecThumbs('c1', 'l2', 's26-001'), {});
  assert.deepEqual(calls.get, [['recThumbs/c1/l1/s26-001'], ['recThumbs/c1/l2/s26-001']]);
  assert.equal(writes(calls), 0);
});

test('添付: 不正な置き場所と ID は通信の前に断る', async () => {
  const { repo, calls } = setup();
  for (const slot of ['a7', 'a0', 'a1\n', 'a1/x', '', null, 1]) {
    await assert.rejects(repo.addAttachment('c1', 'l1', 's26-001', slot, {}, null, 100), TypeError);
    await assert.rejects(repo.removeAttachment('c1', 'l1', 's26-001', slot), TypeError);
  }
  for (let i = 0; i < 3; i++) {
    const ids = ['c1', 'l1', 's26-001'];
    ids[i] = 'bad/key';
    await assert.rejects(repo.addAttachment(...ids, 'a1', {}, null, 100), TypeError);
    await assert.rejects(repo.removeAttachment(...ids, 'a1'), TypeError);
    await assert.rejects(repo.getRecThumbs(...ids), TypeError);
  }
  assert.equal(writes(calls), 0);
  assert.equal(calls.get.length, 0);
});

test('添付: 通信の例外をそのまま伝える', async () => {
  const error = new NetError('denied');
  const fail = async () => { throw error; };
  const repo = createRepo({ get: fail, update: fail });
  await assert.rejects(repo.addAttachment('c1', 'l1', 's26-001', 'a1', {}, null, 100), (e) => e === error);
  await assert.rejects(repo.removeAttachment('c1', 'l1', 's26-001', 'a1'), (e) => e === error);
  await assert.rejects(repo.getRecThumbs('c1', 'l1', 's26-001'), (e) => e === error);
});

test('記録のメソッド: 不正な ID は通信の前に例外にする', async () => {
  const { repo, calls } = setup();
  for (const bad of ['', 'a/b', 'a.b', '#', '$', '[x]', null]) {
    for (let i = 0; i < 3; i++) {
      const ids = ['c1', 'l1', 's26-001'];
      ids[i] = bad;
      await assert.rejects(repo.getRecord(...ids), TypeError);
      await assert.rejects(repo.saveRecord(...ids, { memo: '' }, 1000), TypeError);
    }
    await assert.rejects(repo.getMarks(bad, 'c1'), TypeError);
    await assert.rejects(repo.getMarks('s26-001', bad), TypeError);
    await assert.rejects(repo.listRecords(bad, 'l1'), TypeError);
    await assert.rejects(repo.listRecords('c1', bad), TypeError);
  }
  assert.equal(calls.get.length, 0);
  assert.equal(writes(calls), 0);
});

test('記録のメソッド: 通信エラーをそのまま伝え、保存の失敗は両方に反映しない', async () => {
  for (const code of ['network', 'denied']) {
    const error = new NetError(code);
    const fail = async () => { throw error; };
    const repo = createRepo({ get: fail, update: fail });
    await assert.rejects(repo.getRecord('c1', 'l1', 's26-001'), (e) => e === error);
    await assert.rejects(repo.listRecords('c1', 'l1'), (e) => e === error);
    await assert.rejects(repo.getMarks('s26-001', 'c1'), (e) => e === error);
    await assert.rejects(repo.saveRecord('c1', 'l1', 's26-001', { level: 3 }, 1000), (e) => e === error);
  }
  const mem = createMemoryNet({ deny: (op) => op === 'update' });
  await assert.rejects(createRepo(mem).saveRecord('c1', 'l1', 's26-001', { level: 3 }, 1000), (e) => e.code === 'denied');
  assert.equal(mem.dump(), null);
});

test('memory-net: ルートへの複数パスの update は、それぞれのパスに置き、null は消す', async () => {
  const mem = createMemoryNet({ initial: { a: { b: 1, x: 2 }, c: { d: 3 } } });
  await mem.update('', { 'a/b': 5, 'c/d': null, 'e/f/g': 'h' });
  assert.deepEqual(mem.dump(), { a: { b: 5, x: 2 }, e: { f: { g: 'h' } } });
});

test('memory-net: getPublic で読め、subscribe を持たず、clear で空になる', async () => {
  const mem = createMemoryNet({ initial: { gen: { 's26-001': 2 } } });
  assert.equal(await mem.getPublic('gen/s26-001'), 2);
  assert.equal(await mem.get('gen/none'), null);
  assert.equal('subscribe' in mem, false);
  mem.clear();
  assert.equal(mem.dump(), null);
});

test('memory-net: 書きこみのたびに onChange が呼ばれる', async () => {
  const seen = [];
  const mem = createMemoryNet({ onChange: (root) => seen.push(root) });
  await mem.set('a', 1);
  await mem.remove('a');
  assert.equal(seen.length, 2);
});

test('memory-net: shallow は子のキーだけを返し、文字・数・真偽値・null はそのまま', async () => {
  const mem = createMemoryNet({ initial: { obj: { a: { memo: '記録' }, b: 2 }, array: [null, { memo: '記録' }, 3], text: '文字', num: 4, bool: false } });
  assert.deepEqual(await mem.get('obj', { shallow: true }), { a: true, b: true });
  assert.deepEqual(await mem.get('array', { shallow: true }), { 1: true, 2: true });
  assert.deepEqual(await mem.get('obj'), { a: { memo: '記録' }, b: 2 });
  assert.deepEqual(await mem.get('obj', { shallow: false }), { a: { memo: '記録' }, b: 2 });
  assert.equal(await mem.get('text', { shallow: true }), '文字');
  assert.equal(await mem.get('num', { shallow: true }), 4);
  assert.equal(await mem.get('bool', { shallow: true }), false);
  assert.equal(await mem.get('missing', { shallow: true }), null);
  const result = await mem.get('obj', { shallow: true });
  result.a = false;
  assert.deepEqual(await mem.get('obj', { shallow: true }), { a: true, b: true });
});

test('memory-net: shallow でも拒否と通信失敗を伝える', async () => {
  const denied = createMemoryNet({ deny: (op) => op === 'get' });
  await assert.rejects(denied.get('records/c1/l1', { shallow: true }), (e) => e.code === 'denied');
  const offline = createMemoryNet();
  offline.setOnline(false);
  await assert.rejects(offline.get('records/c1/l1', { shallow: true }), (e) => e.code === 'network');
});

test('単元: 作成と改名、その年度だけを order・名前順で返す', async () => {
  const { repo, mem } = setup();
  await repo.createUnit('u1', { year: 2026, name: 'い', order: 3 });
  await repo.createUnit('u2', { year: 2026, name: 'い', order: 0 });
  await repo.createUnit('u3', { year: 2026, name: 'う', order: 0 });
  await repo.createUnit('u4', { year: 2025, name: 'あ', order: 0 });
  await repo.renameUnit('u3', 'あ');
  assert.deepEqual(await mem.get('units/u3'), { year: 2026, name: 'あ', order: 0 });
  assert.deepEqual(await repo.listUnits(2026), [
    { id: 'u3', year: 2026, name: 'あ', order: 0 },
    { id: 'u2', year: 2026, name: 'い', order: 0 },
    { id: 'u1', year: 2026, name: 'い', order: 3 },
  ]);
  assert.deepEqual(await repo.listUnits(2024), []);
});

test('setUnitOrders: 1 回のルート update で順番だけを変える', async () => {
  const { repo, mem, calls } = setup({ units: { u1: { year: 2026, name: '電流', order: 0 }, u2: { year: 2026, name: '天気', order: 1 } } });
  await repo.setUnitOrders({ u1: 1, u2: 0 });
  assert.equal(writes(calls), 1);
  assert.deepEqual(calls.update, [['', { 'units/u1/order': 1, 'units/u2/order': 0 }]]);
  assert.deepEqual(await mem.get('units/u1'), { year: 2026, name: '電流', order: 1 });
});

test('listUnits: 項目の欠けや型の違いでも落ちない', async () => {
  const { repo } = setup({ units: { u1: { year: 2026, name: 3, order: '2' }, u2: null, u3: 'x', u4: { year: '2026', name: '電流', order: 1 } } });
  assert.deepEqual(await repo.listUnits(2026), [{ id: 'u1', year: 2026, name: '', order: 0 }]);
});

test('createLessons: 複数クラスの授業を 1 回で作り、空の unitId は置かない', async () => {
  const { repo, mem, calls } = setup();
  const date = '2026-11-12';
  const title = '電流と電圧';
  await repo.createLessons([
    { classId: 'c1', lessonId: 'l1', date, title, unitId: 'u1' },
    { classId: 'c2', lessonId: 'l2', date, title, unitId: '' },
  ], 1000);
  assert.equal(writes(calls), 1);
  assert.deepEqual(calls.update, [['', {
    'lessons/c1/l1': { date, title, unitId: 'u1', createdAt: 1000, updatedAt: 1000 },
    'lessons/c2/l2': { date, title, createdAt: 1000, updatedAt: 1000 },
  }]]);
  assert.equal(Object.hasOwn(await mem.get('lessons/c2/l2'), 'unitId'), false);
});

test('updateLesson: 日付・授業名・単元・更新日時だけを変え、資料と作成日時を残す', async () => {
  const { repo, mem, calls } = setup();
  await repo.createLessons([{ classId: 'c1', lessonId: 'l1', date: '2026-11-12', title: '電流', unitId: 'u1' }], 1000);
  const material = { kind: 'board', type: 'image', fileId: 'F', name: '板書', bytes: 100 };
  await repo.addMaterial([{ classId: 'c1', lessonId: 'l1', order: 0 }], 'm1', material, 'data:image/jpeg;base64,xx', 2000);
  const before = writes(calls);
  await repo.updateLesson('c1', 'l1', { date: '2026-11-13', title: '電圧', unitId: '' }, 3000);
  assert.equal(writes(calls), before + 1);
  assert.deepEqual(calls.update.at(-1), ['', {
    'lessons/c1/l1/date': '2026-11-13', 'lessons/c1/l1/title': '電圧',
    'lessons/c1/l1/unitId': null, 'lessons/c1/l1/updatedAt': 3000,
  }]);
  assert.deepEqual(await mem.get('lessons/c1/l1'), {
    date: '2026-11-13', title: '電圧', createdAt: 1000, updatedAt: 3000,
    materials: { m1: { ...material, order: 0 } },
  });
  await repo.updateLesson('c1', 'l1', { date: '2026-11-13', title: '電圧', unitId: 'u2' }, 4000);
  assert.equal(await mem.get('lessons/c1/l1/unitId'), 'u2');
});

test('addMaterial・removeMaterial: 共有資料を 1 回で登録し、片方だけから外せる', async () => {
  const { repo, mem, calls } = setup({ lessons: { c1: { l1: { title: '電流' } }, c2: { l2: { title: '電圧' } } } });
  const material = { kind: 'board', type: 'image', fileId: 'F', name: '板書', bytes: 100 };
  const thumb = 'data:image/jpeg;base64,xx';
  await repo.addMaterial([{ classId: 'c1', lessonId: 'l1', order: 0 }, { classId: 'c2', lessonId: 'l2', order: 3 }], 'm1', material, thumb, 2000);
  assert.equal(writes(calls), 1);
  assert.deepEqual(calls.update, [['', {
    'lessons/c1/l1/materials/m1': { ...material, order: 0 }, 'thumbs/c1/l1/m1': thumb, 'lessons/c1/l1/updatedAt': 2000,
    'lessons/c2/l2/materials/m1': { ...material, order: 3 }, 'thumbs/c2/l2/m1': thumb, 'lessons/c2/l2/updatedAt': 2000,
  }]]);
  assert.equal(Object.hasOwn(material, 'order'), false);
  assert.deepEqual(await repo.getThumbs('c1', 'l1'), { m1: thumb });
  assert.equal(fileRefs(await repo.listAllLessons(), 'F').length, 2);

  await repo.removeMaterial('c1', 'l1', 'm1', 3000);
  assert.equal(writes(calls), 2);
  assert.deepEqual(calls.update.at(-1), ['', {
    'lessons/c1/l1/materials/m1': null, 'thumbs/c1/l1/m1': null, 'lessons/c1/l1/updatedAt': 3000,
  }]);
  assert.equal(await mem.get('lessons/c1/l1/materials/m1'), null);
  assert.equal(await mem.get('thumbs/c1/l1/m1'), null);
  assert.equal(await mem.get('lessons/c1/l1/title'), '電流');
  assert.deepEqual(await mem.get('lessons/c2/l2/materials/m1'), { ...material, order: 3 });
  assert.equal(await mem.get('thumbs/c2/l2/m1'), thumb);
  assert.deepEqual(fileRefs(await repo.listAllLessons(), 'F'), [{ classId: 'c2', lessonId: 'l2', materialId: 'm1' }]);
  await repo.removeMaterial('c2', 'l2', 'm1', 4000);
  assert.deepEqual(fileRefs(await repo.listAllLessons(), 'F'), []);
});

test('addMaterial: thumb が null なら thumbs を書かず、同じ資料 ID で二重に登録しない', async () => {
  const { repo, mem, calls } = setup();
  const targets = [{ classId: 'c1', lessonId: 'l1', order: 0 }];
  const material = { kind: 'handout', type: 'pdf', fileId: 'F', name: '資料.pdf', bytes: 100 };
  await repo.addMaterial(targets, 'm1', material, null, 2000);
  await repo.addMaterial(targets, 'm1', material, null, 2000);
  assert.equal(writes(calls), 2);
  assert.deepEqual(calls.update[0], ['', {
    'lessons/c1/l1/materials/m1': { ...material, order: 0 }, 'lessons/c1/l1/updatedAt': 2000,
  }]);
  assert.deepEqual(await mem.get('lessons/c1/l1/materials'), { m1: { ...material, order: 0 } });
  assert.equal(await mem.get('thumbs'), null);
});

test('setMaterialOrders: 順番と更新日時だけを 1 回で変え、資料と画像を残す', async () => {
  const material = { kind: 'board', type: 'image', fileId: 'F', name: '板書', bytes: 100, order: 0 };
  const { repo, mem, calls } = setup({ lessons: { c1: { l1: { createdAt: 1000, materials: { m1: material, m2: { ...material, order: 3 } } } } }, thumbs: { c1: { l1: { m1: 'data:image/jpeg;base64,xx' } } } });
  await repo.setMaterialOrders('c1', 'l1', { m1: 1, m2: 0 }, 3000);
  assert.equal(writes(calls), 1);
  assert.deepEqual(calls.update, [['', {
    'lessons/c1/l1/materials/m1/order': 1, 'lessons/c1/l1/materials/m2/order': 0, 'lessons/c1/l1/updatedAt': 3000,
  }]]);
  assert.deepEqual(await mem.get('lessons/c1/l1/materials/m1'), { ...material, order: 1 });
  assert.equal(await mem.get('lessons/c1/l1/createdAt'), 1000);
  assert.equal(await mem.get('thumbs/c1/l1/m1'), 'data:image/jpeg;base64,xx');
});

test('countRecords: 中身を読まず、shallow で人数だけを数える', async () => {
  const { repo, calls } = setup({ records: { c1: { l1: { s1: { memo: '記録' }, s2: { learned: '振り返り' } } } } });
  assert.equal(await repo.countRecords('c1', 'l1'), 2);
  assert.equal(await repo.countRecords('c1', 'missing'), 0);
  assert.deepEqual(calls.get, [['records/c1/l1', { shallow: true }], ['records/c1/missing', { shallow: true }]]);
  assert.equal(writes(calls), 0);
});

test('deleteLesson: 授業とサムネイルを 1 回で消し、ほかの授業と記録は変えない', async () => {
  const { repo, mem, calls } = setup({ lessons: { c1: { l1: { title: '電流' }, l2: { title: '電圧' } } }, thumbs: { c1: { l1: { m1: '画像' }, l2: { m2: '画像2' } } }, records: { c1: { l2: { s1: { memo: '記録' } } } } });
  await repo.deleteLesson('c1', 'l1');
  assert.equal(writes(calls), 1);
  assert.deepEqual(calls.update, [['', { 'lessons/c1/l1': null, 'thumbs/c1/l1': null }]]);
  assert.equal(await mem.get('lessons/c1/l1'), null);
  assert.equal(await mem.get('thumbs/c1/l1'), null);
  assert.deepEqual(await mem.get('lessons/c1/l2'), { title: '電圧' });
  assert.equal(await mem.get('thumbs/c1/l2/m2'), '画像2');
  assert.deepEqual(await mem.get('records/c1/l2'), { s1: { memo: '記録' } });
});

test('listLessons・getLesson: 日付・作成日時の新しい順で、欠けた項目を補い、資料は生の形で返す', async () => {
  const materials = { m1: { fileId: 'F', extra: true } };
  const { repo } = setup({ lessons: { c1: {
    l1: { date: '2026-11-11', title: '電流', unitId: 'u1', materials, createdAt: 900, updatedAt: 1000 },
    l2: { date: '2026-11-12', title: '電圧', createdAt: 100 },
    l3: { date: '2026-11-12', title: '回路', createdAt: 200 },
    bad: { date: 5, title: null, unitId: 3, materials: 'x', createdAt: 'x', updatedAt: false },
  } } });
  const list = await repo.listLessons('c1');
  assert.deepEqual(list.map((x) => x.id), ['l3', 'l2', 'l1', 'bad']);
  assert.deepEqual(list[2], { id: 'l1', classId: 'c1', date: '2026-11-11', title: '電流', unitId: 'u1', materials, terms: {}, createdAt: 900, updatedAt: 1000 });
  assert.deepEqual(list[3], { id: 'bad', classId: 'c1', date: '', title: '', unitId: '', materials: {}, terms: {}, createdAt: 0, updatedAt: 0 });
  assert.deepEqual(list[0].materials, {});
  assert.deepEqual(await repo.getLesson('c1', 'l1'), list[2]);
  assert.equal(await repo.getLesson('c1', 'missing'), null);
  assert.deepEqual(await repo.listLessons('missing'), []);
});

test('listAllLessons・getThumbs: 全授業の形を保ち、画像は文字だけ。空なら空のオブジェクト', async () => {
  const lessons = { c1: { l1: { title: '電流' } }, c2: { l2: { title: '電圧' } } };
  const { repo, calls } = setup({ lessons, thumbs: { c1: { l1: { m1: 'data:image/jpeg;base64,xx', bad: 3 } } } });
  assert.deepEqual(await repo.listAllLessons(), lessons);
  assert.deepEqual(calls.get, [['lessons']]);
  assert.deepEqual(await repo.getThumbs('c1', 'l1'), { m1: 'data:image/jpeg;base64,xx' });
  assert.deepEqual(await repo.getThumbs('c1', 'missing'), {});
  assert.deepEqual(await setup().repo.listAllLessons(), {});
});

test('単元・授業・資料: 不正なキーがあれば、書きこみの前に断る', async () => {
  const { repo, calls } = setup();
  await assert.rejects(repo.createUnit('bad/key', { year: 2026, name: '電流', order: 0 }), TypeError);
  await assert.rejects(repo.setUnitOrders({ u1: 0, 'bad/key': 1 }), TypeError);
  await assert.rejects(repo.createLessons([
    { classId: 'c1', lessonId: 'l1', date: '2026-11-12', title: '電流' },
    { classId: 'bad/key', lessonId: 'l2', date: '2026-11-12', title: '電流' },
  ], 1000), TypeError);
  await assert.rejects(repo.addMaterial([{ classId: 'c1', lessonId: 'l1', order: 0 }, { classId: 'c2', lessonId: 'bad/key', order: 1 }], 'm1', {}, null, 2000), TypeError);
  await assert.rejects(repo.removeMaterial('c1', 'l1', 'bad/key', 2000), TypeError);
  await assert.rejects(repo.setMaterialOrders('c1', 'l1', { m1: 0, 'bad/key': 1 }, 2000), TypeError);
  await assert.rejects(repo.deleteLesson('c1', 'bad/key'), TypeError);
  assert.equal(writes(calls), 0);
});

test('reserveIds: 連番を進めて生徒 ID を作り、台帳に入れる', async () => {
  const { repo, mem, calls } = setup();
  assert.deepEqual(await repo.reserveIds(26, 3, 1000), ['s26-001', 's26-002', 's26-003']);
  assert.deepEqual(await repo.reserveIds(26, 2, 2000), ['s26-004', 's26-005']);
  assert.equal(await mem.get('counters/26'), 5);
  assert.deepEqual(await mem.get('students/s26-004'), { createdAt: 2000 });
  assert.equal(calls.update.length, 2);
  assert.equal(writes(calls), 2);
});

test('reserveIds: 0 件や、連番が 999 をこえるときは例外で、データベースを変えない', async () => {
  const { repo, mem, calls } = setup({ counters: { 26: 998 } });
  await assert.rejects(repo.reserveIds(26, 0, 0));
  await assert.rejects(repo.reserveIds(26, 2, 0));
  assert.equal(writes(calls), 0);
  assert.equal(await mem.get('counters/26'), 998);
  assert.deepEqual(await repo.reserveIds(26, 1, 0), ['s26-999']);
});

test('linkAccount: 1 回のルート update で、対応・回数・最初のパスワード・台帳の uid を書く', async () => {
  const { repo, mem, calls } = setup({ students: { 's26-001': { createdAt: 1 } } });
  await repo.linkAccount('s26-001', { uid: 'u1', generation: 1, password: 'abcd2345' });
  assert.equal(calls.update.length, 1);
  assert.equal(calls.update[0][0], '');
  assert.equal(writes(calls), 1);
  assert.equal(await mem.get('accounts/u1'), 's26-001');
  assert.equal(await mem.get('gen/s26-001'), 1);
  assert.equal(await mem.get('initialPw/s26-001'), 'abcd2345');
  assert.equal(await mem.get('students/s26-001/uid'), 'u1');
  assert.equal(await mem.get('students/s26-001/createdAt'), 1);
});

test('linkAccount: 古いアカウントの対応を消す', async () => {
  const { repo, mem } = setup();
  await repo.linkAccount('s26-001', { uid: 'u1', generation: 1, password: 'abcd2345' });
  await repo.linkAccount('s26-001', { uid: 'u2', generation: 2, password: 'x' }, 'u1');
  assert.equal(await mem.get('accounts/u1'), null);
  assert.equal(await mem.get('accounts/u2'), 's26-001');
  assert.equal(await mem.get('gen/s26-001'), 2);
  assert.equal(await repo.getMyStudentId('u2'), 's26-001');
  assert.equal(await repo.getMyStudentId('u1'), null);
});

test('saveMembers: members と memberOf を 1 回で書き、getMembers は出席番号順', async () => {
  const { repo, mem, calls } = setup();
  await repo.saveMembers('c1', { set: { 's26-001': 3, 's26-002': 1 }, remove: [] });
  assert.equal(writes(calls), 1);
  assert.equal(calls.update[0][0], '');
  assert.deepEqual(await repo.getMembers('c1'), [
    { studentId: 's26-002', number: 1 },
    { studentId: 's26-001', number: 3 },
  ]);
  assert.equal(await mem.get('memberOf/s26-001/c1'), true);

  await repo.saveMembers('c1', { set: {}, remove: ['s26-001'] });
  assert.equal(writes(calls), 2);
  assert.deepEqual(await repo.getMembers('c1'), [{ studentId: 's26-002', number: 1 }]);
  assert.equal(await mem.get('memberOf/s26-001'), null);
});

test('getMembersOfYear: その年度の組の名簿を、生徒 ID ごとにまとめる', async () => {
  const { repo } = setup({
    classes: {
      c1: { year: 2026, name: '1組', createdAt: 1 },
      c2: { year: 2026, name: '2組', createdAt: 1 },
      c3: { year: 2025, name: '1組', createdAt: 1 },
    },
    members: { c1: { 's26-001': 1 }, c2: { 's26-002': 4 }, c3: { 's25-001': 2 } },
  });
  assert.deepEqual(await repo.getMembersOfYear(2026), {
    's26-001': { classId: 'c1', number: 1 },
    's26-002': { classId: 'c2', number: 4 },
  });
});

test('myClasses: 年度の新しい順に、出席番号つきで返し、消えた組は入れない', async () => {
  const { repo } = setup({
    classes: {
      c1: { year: 2025, name: '1組', createdAt: 1 },
      c2: { year: 2026, name: '2組', createdAt: 1 },
    },
    members: { c1: { 's26-001': 5 }, c2: { 's26-001': 7 } },
    memberOf: { 's26-001': { c1: true, c2: true, gone: true } },
  });
  assert.deepEqual(await repo.myClasses('s26-001'), [
    { id: 'c2', year: 2026, name: '2組', number: 7 },
    { id: 'c1', year: 2025, name: '1組', number: 5 },
  ]);
  assert.deepEqual(await repo.myClasses('s26-009'), []);
});

test('listClasses: 年度の新しい順・同じ年度は名前順。項目が欠けていても落ちない', async () => {
  const { repo } = setup({
    classes: {
      a: { year: 2025, name: '1組', createdAt: 1 },
      b: { year: 2026, name: '2組', createdAt: 2 },
      c: { year: 2026, name: '1組', createdAt: 3 },
      d: { year: '2026', name: 5 },
    },
  });
  assert.deepEqual(await repo.listClasses(), [
    { id: 'c', year: 2026, name: '1組', createdAt: 3 },
    { id: 'b', year: 2026, name: '2組', createdAt: 2 },
    { id: 'a', year: 2025, name: '1組', createdAt: 1 },
    { id: 'd', year: 0, name: '', createdAt: 0 },
  ]);
});

test('createClass と renameClass', async () => {
  const { repo, mem } = setup();
  await repo.createClass('c1', { year: 2026, name: '1組' }, 500);
  assert.deepEqual(await mem.get('classes/c1'), { year: 2026, name: '1組', createdAt: 500 });
  await repo.renameClass('c1', '3組');
  assert.deepEqual(await repo.listClasses(), [{ id: 'c1', year: 2026, name: '3組', createdAt: 500 }]);
});

test('listStudents: ID 順で、uid が無ければ null', async () => {
  const { repo } = setup({
    students: { 's26-002': { createdAt: 2, uid: 'u2' }, 's26-001': { createdAt: 1 } },
  });
  assert.deepEqual(await repo.listStudents(), [
    { id: 's26-001', uid: null, createdAt: 1 },
    { id: 's26-002', uid: 'u2', createdAt: 2 },
  ]);
  assert.deepEqual(await setup().repo.listStudents(), []);
});

test('最初のパスワードを読み、1 人分を消せる', async () => {
  const { repo, mem } = setup({ initialPw: { 's26-001': 'aaaa2222', 's26-002': 'bbbb3333' } });
  assert.deepEqual(await repo.getInitialPasswords(), { 's26-001': 'aaaa2222', 's26-002': 'bbbb3333' });
  await repo.clearInitialPassword('s26-001');
  assert.equal(await mem.get('initialPw/s26-001'), null);
  assert.deepEqual(await repo.getInitialPasswords(), { 's26-002': 'bbbb3333' });
});

test('isTeacher と getMyStudentId', async () => {
  const { repo } = setup({ teacherList: { t1: true, t2: 'yes' }, accounts: { u1: 's26-001' } });
  assert.equal(await repo.isTeacher('t1'), true);
  assert.equal(await repo.isTeacher('t2'), false);
  assert.equal(await repo.isTeacher('u1'), false);
  assert.equal(await repo.getMyStudentId('u1'), 's26-001');
  assert.equal(await repo.getMyStudentId('t1'), null);
});

test('getGeneration: getPublic で読み（get は使わない）、数でなければ null', async () => {
  const { repo, calls } = setup({ gen: { 's26-001': 2, 's26-002': 'x' } });
  assert.equal(await repo.getGeneration('s26-001'), 2);
  assert.equal(await repo.getGeneration('s26-002'), null);
  assert.equal(await repo.getGeneration('s26-003'), null);
  assert.equal(calls.getPublic.length, 3);
  assert.equal(calls.get.length, 0);
});

test('reserveIds: ほかの画面と連番が重なって断られたら、読み直して別の ID を取る', async () => {
  const { createRepo } = await import('../js/repo.js');
  const { createMemoryNet } = await import('../js/dev/memory-net.js');
  const { NetError } = await import('../js/errors.js');
  const inner = createMemoryNet({});
  let raced = false;
  // 規則の代わり: students/<id>/createdAt がすでにあれば、update をまるごと断る
  const net = {
    ...inner,
    // この画面が連番を読んだ直後に、ほかの画面が 2 人分を先に取った、という順番を作る
    async get(path) {
      const v = await inner.get(path);
      if (path === 'counters/26' && !raced) {
        raced = true;
        await inner.update('', {
          'counters/26': 2, 'students/s26-001/createdAt': 1, 'students/s26-002/createdAt': 1, 'students/s26-001/uid': 'uOther',
        });
      }
      return v;
    },
    async update(path, patch) {
      const db = inner.dump() || {};
      for (const k of Object.keys(patch)) {
        const parts = k.split('/');
        if (parts.length === 3 && parts[0] === 'students' && parts[2] === 'createdAt') {
          const had = db.students && db.students[parts[1]] && db.students[parts[1]].createdAt !== undefined;
          if (had) throw new NetError('denied');
        }
      }
      return inner.update(path, patch);
    },
  };
  const ids = await createRepo(net).reserveIds(26, 2, 5000);
  assert.deepEqual(ids, ['s26-003', 's26-004']);
  const db = inner.dump();
  assert.equal(db.counters['26'], 4);
  assert.equal(db.students['s26-001'].uid, 'uOther'); // 先に取った人のデータは残る
  assert.equal(db.students['s26-001'].createdAt, 1);
});

test('reserveIds: 断られつづけたら、3 回でやめて denied を伝える', async () => {
  const { createRepo } = await import('../js/repo.js');
  const { NetError } = await import('../js/errors.js');
  let updates = 0;
  const net = { get: async () => 0, update: async () => { updates += 1; throw new NetError('denied'); } };
  await assert.rejects(createRepo(net).reserveIds(26, 1, 0), (e) => e.code === 'denied');
  assert.equal(updates, 3);
});
