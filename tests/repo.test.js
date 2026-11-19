// リポジトリの土台（開発ルール、道具、設定）がそろっているかと、
// データベースの出し入れ（js/repo.js・js/dev/memory-net.js）を確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRepo } from '../js/repo.js';
import { createMemoryNet } from '../js/dev/memory-net.js';
import { createDemoBackend } from '../js/dev/demo.js';
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

test('AI のまとめを整えて保存・読み取り・上書きし、授業と同じ update で消す', async () => {
  const { repo, calls, mem } = setup();
  const summary = { overview: ' 見本のまとめ ', questionGroups: [], misconceptions: [], nextLesson: [], followUp: [{ number: '名前の見本', reason: '説明' }] };
  const labels = { '1番': 's26-001', '名簿外1': 's26-002' };
  await repo.setAiSummary('c1', 'l1', { summary, model: 'demo', basedOn: { count: 2, latest: 20 }, labels }, 30);
  const expected = { v: 1, createdAt: 30, model: 'demo', basedOn: { count: 2, latest: 20 },
    overview: '見本のまとめ', questionGroups: [], misconceptions: [], nextLesson: [], followUp: [], labels };
  assert.deepEqual(calls.set[0], ['aiSummaries/c1/l1', expected]);
  assert.deepEqual(await repo.getAiSummary('c1', 'l1'), expected);
  await repo.setAiSummary('c1', 'l1', { summary: { overview: '作り直した見本' }, model: 'demo', basedOn: { count: 3, latest: 40 }, labels: { '2番': 's26-001' } }, 50);
  assert.equal((await repo.getAiSummary('c1', 'l1')).createdAt, 50);
  assert.equal((await repo.getAiSummary('c1', 'l1')).overview, '作り直した見本');
  assert.deepEqual((await repo.getAiSummary('c1', 'l1')).labels, { '2番': 's26-001' });
  await mem.set('aiSummaries/c1/keep', expected);
  await repo.deleteLesson('c1', 'l1');
  assert.equal(calls.update.length, 1);
  assert.equal(calls.update[0][1]['aiSummaries/c1/l1'], null);
  assert.equal(calls.update[0][1]['lessons/c1/l1'], null);
  assert.equal(await repo.getAiSummary('c1', 'l1'), null);
  assert.deepEqual(await repo.getAiSummary('c1', 'keep'), expected);
});

test('AI のまとめ: 対応表の不正な組を保存時・読込時に落とし、古いまとめも読める', async () => {
  const { repo, mem } = setup();
  const value = { v: 1, createdAt: 10, model: 'demo', basedOn: { count: 2, latest: 5 }, overview: '見本',
    followUp: [{ number: '1番', reason: '理由の見本' }, { number: '2番', reason: '別の理由' }] };
  const valid = { '1番': 's26-001', '名簿外2': 's26-002' };
  const labels = { ...valid, '名前の見本': 's26-003', '0番': 's26-003', '1番\n': 's26-003',
    '2番': 'invalid', '3番': null, '4番': 4, '5番': 'S26-005', '6番': 's26-006/other' };
  await repo.setAiSummary('c1', 'l1', { summary: value, model: value.model, basedOn: value.basedOn, labels }, 10);
  assert.deepEqual((await mem.get('aiSummaries/c1/l1')).labels, valid);
  await mem.set('aiSummaries/c1/l1', { ...value, labels });
  const read = await repo.getAiSummary('c1', 'l1');
  assert.deepEqual(read.labels, valid);
  assert.deepEqual(read.followUp, value.followUp);
  for (const labels of [null, [], '見本', 3]) {
    await mem.set('aiSummaries/c1/l1', { ...value, labels });
    assert.deepEqual((await repo.getAiSummary('c1', 'l1')).labels ?? {}, {});
  }
  await mem.set('aiSummaries/c1/l1', value);
  const old = await repo.getAiSummary('c1', 'l1');
  assert.equal(old.labels, undefined);
  assert.deepEqual(old.followUp, value.followUp);
});

test('AI のまとめ: 形のおかしい保存値は null、不正な保存は書く前に止める', async () => {
  const valid = { v: 1, createdAt: 10, model: 'demo', basedOn: { count: 1, latest: 5 }, overview: '見本' };
  for (const value of [null, [], {}, { ...valid, v: 2 }, { ...valid, createdAt: '10' }, { ...valid, model: '' },
    { ...valid, basedOn: null }, { ...valid, basedOn: { count: 61, latest: 5 } },
    { ...valid, basedOn: { count: 1, latest: '5' } }, { ...valid, overview: '' }, { ...valid, followUp: '不正な形' }]) {
    const { repo, calls } = setup({ aiSummaries: { c1: { l1: value } } });
    assert.equal(await repo.getAiSummary('c1', 'l1'), null);
    await assert.rejects(repo.setAiSummary('c1', 'l1', { summary: value, model: 'demo', basedOn: { count: 1, latest: 5 } }, NaN), TypeError);
    assert.equal(writes(calls), 0);
  }
  const repo = createRepo({ set: async () => { throw new NetError('network'); } });
  await assert.rejects(repo.setAiSummary('c1', 'l1', { summary: valid, model: 'demo', basedOn: valid.basedOn }, 10), { code: 'network' });
});

test('返事の読み取り: 指定の道だけを読み、不正な返事・目印を落とす', async () => {
  const first = { text: ' 文\r\n文 ', updatedAt: 10 };
  const second = { seen: true, updatedAt: 0 };
  const { repo, calls, mem } = setup({ replies: { c1: { l1: { s1: first, s2: second,
    bad: { updatedAt: 20 }, long: { text: 'あ'.repeat(401), updatedAt: 20 }, wrong: '文' } } },
  replyMarks: { s1: { c1: { l1: 10, l2: 0, bad: '20', wrong: true, obj: {} } } } });
  const before = mem.dump();
  const expected = { s1: { text: '文\n文', seen: false, updatedAt: 10 }, s2: { text: '', seen: true, updatedAt: 0 } };
  assert.deepEqual(await repo.getReply('c1', 'l1', 's1'), expected.s1);
  assert.deepEqual(await repo.listReplies('c1', 'l1'), expected);
  assert.deepEqual(await repo.getReplyMarks('s1', 'c1'), { l1: 10, l2: 0 });
  assert.deepEqual(calls.get, [['replies/c1/l1/s1'], ['replies/c1/l1'], ['replyMarks/s1/c1']]);
  assert.equal(await repo.getReply('c1', 'l1', 'missing'), null);
  assert.deepEqual(await repo.listReplies('c1', 'missing'), {});
  assert.deepEqual(await repo.getReplyMarks('s1', 'missing'), {});
  assert.equal(writes(calls), 0);
  assert.deepEqual(mem.dump(), before);
  for (const value of [null, undefined, 3, '文', [], { bad: NaN, wrong: Infinity }]) {
    const direct = createRepo({ get: async () => value });
    assert.equal(await direct.getReply('c1', 'l1', 's1'), null);
    assert.deepEqual(await direct.listReplies('c1', 'l1'), {});
    assert.deepEqual(await direct.getReplyMarks('s1', 'c1'), {});
  }
});

test('setReply: 文と印を整え、本文と目印を 1 回で保存する。再保存は時刻だけ変わる', async () => {
  const { repo, mem, calls } = setup();
  const input = { text: ' 文\r\n文 ', seen: true, extra: true };
  await repo.setReply('c1', 'l1', 's1', input, 10);
  assert.equal(writes(calls), 1);
  assert.deepEqual(calls.update[0], ['', { 'replies/c1/l1/s1': { text: '文\n文', seen: true, updatedAt: 10 }, 'replyMarks/s1/c1/l1': 10 }]);
  await repo.setReply('c1', 'l1', 's1', input, 20);
  assert.deepEqual(await repo.getReply('c1', 'l1', 's1'), { text: '文\n文', seen: true, updatedAt: 20 });
  assert.deepEqual(await repo.getReplyMarks('s1', 'c1'), { l1: 20 });
  await repo.setReply('c1', 'l1', 's1', { text: ' \n', seen: true }, 30);
  assert.deepEqual(await mem.get('replies/c1/l1/s1'), { seen: true, updatedAt: 30 });
  await repo.setReply('c1', 'l1', 's1', { text: 'あ'.repeat(400), seen: 'true' }, 40);
  assert.deepEqual(await mem.get('replies/c1/l1/s1'), { text: 'あ'.repeat(400), updatedAt: 40 });
  await repo.setReply('c1', 'l1', 's2', { text: 1, seen: true }, 50);
  assert.deepEqual(await mem.get('replies/c1/l1/s2'), { seen: true, updatedAt: 50 });
  assert.equal(await mem.get('records'), null);
  assert.equal(calls.update.length, 5);
  assert.deepEqual(input, { text: ' 文\r\n文 ', seen: true, extra: true });
});

test('setReply: 不正な入力・時刻は書く前に TypeError。空は削除せず removeReply に任せる', async () => {
  const { repo, mem, calls } = setup();
  await repo.setReply('c1', 'l1', 's1', { seen: true }, 10);
  const before = mem.dump();
  for (const value of [null, undefined, [], 1, '文', {}, { text: ' \r\n' }, { text: 1 }, { seen: 'true' },
    { seen: 1 }, { text: 'あ'.repeat(401) }, { text: 'あ'.repeat(401), seen: true }]) {
    await assert.rejects(repo.setReply('c1', 'l1', 's1', value, 20), TypeError);
  }
  for (const now of [undefined, null, '20', false, NaN, Infinity, {}, []]) {
    await assert.rejects(repo.setReply('c1', 'l1', 's1', { seen: true }, now), TypeError);
  }
  assert.equal(writes(calls), 1);
  assert.deepEqual(mem.dump(), before);
});

test('stampReplies: 文の道に触れず、seen・updatedAt・目印だけを 1 回のルート update で保存する', async () => {
  const existing = { 's26-001': { text: '保存済み\nの返事', updatedAt: 1 },
    's26-002': { text: 'あ'.repeat(400), seen: true, updatedAt: 1 }, 's26-004': { text: '対象外', updatedAt: 1 } };
  const { repo, mem, calls } = setup({ replies: { c1: { l1: existing } } });
  const ids = [1, 2, 3].map((n) => `s26-00${n}`);
  await repo.stampReplies('c1', 'l1', ids, 20);
  const expected = {};
  for (const sid of ids) {
    expected[`replies/c1/l1/${sid}/seen`] = true;
    expected[`replies/c1/l1/${sid}/updatedAt`] = 20;
    expected[`replyMarks/${sid}/c1/l1`] = 20;
  }
  assert.deepEqual(calls.update, [['', expected]]);
  assert.equal(writes(calls), 1);
  assert.equal(calls.get.length, 0);
  for (const sid of ids) {
    assert.deepEqual(await mem.get(`replies/c1/l1/${sid}`), { ...(existing[sid] ?? {}), seen: true, updatedAt: 20 });
    assert.deepEqual(await repo.getReplyMarks(sid, 'c1'), { l1: 20 });
  }
  assert.deepEqual(await mem.get('replies/c1/l1/s26-004'), existing['s26-004']);
});

test('stampReplies: 一覧を読んだ後に別の端末で追加・修正した文も残る', async () => {
  const { repo, mem, calls } = setup({ replies: { c1: { l1: { 's26-001': { text: '古い返事', updatedAt: 1 } } } } });
  const existing = await repo.listReplies('c1', 'l1');
  await mem.set('replies/c1/l1/s26-001', { text: '別の端末で修正した返事', updatedAt: 10 });
  await mem.set('replies/c1/l1/s26-002', { text: '別の端末で追加した返事', updatedAt: 10 });
  await repo.stampReplies('c1', 'l1', ['s26-001', 's26-002'], 20);
  assert.equal(writes(calls), 1);
  assert.deepEqual(await repo.listReplies('c1', 'l1'), {
    's26-001': { text: '別の端末で修正した返事', seen: true, updatedAt: 20 },
    's26-002': { text: '別の端末で追加した返事', seen: true, updatedAt: 20 },
  });
  assert.deepEqual(existing, { 's26-001': { text: '古い返事', seen: false, updatedAt: 1 } });
});

test('stampReplies: 60 人まで 1 回で保存し、文が無い・対象が重複した場合も書ける', async () => {
  const { repo, calls } = setup();
  const ids = Array.from({ length: 60 }, (_, i) => `s26-${String(i + 1).padStart(3, '0')}`);
  await repo.stampReplies('c1', 'l1', ids, 10);
  assert.equal(calls.update.length, 1);
  assert.equal(Object.keys(calls.update[0][1]).length, 180);
  assert.equal(Object.keys(await repo.listReplies('c1', 'l1')).length, 60);
  await repo.stampReplies('c1', 'l1', [ids[0], ids[0]], 20);
  assert.equal(Object.keys(calls.update[1][1]).length, 3);
  assert.deepEqual(await repo.getReply('c1', 'l1', ids[0]), { text: '', seen: true, updatedAt: 20 });
});

test('stampReplies: 空・配列以外・61 人・不正な ID や時刻は書く前に TypeError', async () => {
  const { repo, calls } = setup();
  for (const ids of [null, undefined, {}, 's26-001', [], Array(1), Array(61).fill('s26-001'),
    ['s26-001', null], ['s1'], ['s26-001/other'], [123], ['s26-001', '']]) {
    await assert.rejects(repo.stampReplies('c1', 'l1', ids, 1), TypeError);
  }
  for (const now of [undefined, null, '1', NaN, Infinity, true]) {
    await assert.rejects(repo.stampReplies('c1', 'l1', ['s26-001'], now), TypeError);
  }
  for (const [cid, lid] of [[null, 'l1'], ['c1', ''], ['bad/path', 'l1'], ['c1', 'bad.path']]) {
    await assert.rejects(repo.stampReplies(cid, lid, ['s26-001'], 1), TypeError);
  }
  assert.equal(writes(calls), 0);
});

test('stampReplies: update の失敗で一部だけ保存されない', async () => {
  const initial = { replies: { c1: { l1: { 's26-001': { text: '残す文', updatedAt: 1 } } } } };
  const error = new NetError('network');
  const mem = createMemoryNet({ initial, onChange: () => { throw error; } });
  const repo = createRepo(mem);
  await assert.rejects(repo.stampReplies('c1', 'l1', ['s26-001', 's26-002'], 20), (e) => e === error);
  assert.deepEqual(mem.dump(), initial);
});

for (const initialText of ['', '古い返事']) {
  test(`unstampReply: 別の端末で${initialText ? '修正' : '追加'}した最新の文を残し、seen・時刻・目印だけを 1 回で更新する`, async () => {
    const { repo, mem, calls } = setup({ replies: { c1: { l1: { s1: { text: initialText, seen: true, updatedAt: 1 } } } } });
    const saved = await repo.getReply('c1', 'l1', 's1');
    await mem.set('replies/c1/l1/s1', { text: '別の端末で保存した返事', seen: true, updatedAt: 10 });
    const result = await repo.unstampReply('c1', 'l1', 's1', 20);
    assert.deepEqual(calls.get, [['replies/c1/l1/s1'], ['replies/c1/l1/s1']]);
    assert.deepEqual(calls.update, [['', {
      'replies/c1/l1/s1/seen': null, 'replies/c1/l1/s1/updatedAt': 20, 'replyMarks/s1/c1/l1': 20,
    }]]);
    assert.equal(writes(calls), 1);
    assert.deepEqual(result, { reply: { text: '別の端末で保存した返事', seen: false, updatedAt: 20 } });
    assert.deepEqual(await mem.get('replies/c1/l1/s1'), { text: '別の端末で保存した返事', updatedAt: 20 });
    assert.deepEqual(await repo.getReplyMarks('s1', 'c1'), { l1: 20 });
    assert.equal(saved.text, initialText);
  });
}

test('unstampReply: 文なしなら返事と目印を 1 回で消し、続けて取り消しても成功する。他の返事は残す', async () => {
  for (const text of [undefined, '', ' \r\n　']) {
    const keep = { text: '別の返事', seen: true, updatedAt: 1 };
    const { repo, mem, calls } = setup({ replies: { c1: { l1: { s1: { text, seen: true, updatedAt: 1 }, s2: keep }, l2: { s1: keep } } },
      replyMarks: { s1: { c1: { l1: 1, l2: 1 } }, s2: { c1: { l1: 1 } } } });
    assert.deepEqual(await repo.unstampReply('c1', 'l1', 's1', 20), { reply: null });
    assert.deepEqual(calls.update[0], ['', { 'replies/c1/l1/s1': null, 'replyMarks/s1/c1/l1': null }]);
    assert.deepEqual(await repo.unstampReply('c1', 'l1', 's1', 30), { reply: null });
    assert.deepEqual(calls.update[1], ['', { 'replyMarks/s1/c1/l1': null }]);
    assert.deepEqual(calls.get, [['replies/c1/l1/s1'], ['replies/c1/l1/s1']]);
    assert.equal(writes(calls), 2);
    assert.deepEqual(await mem.get('replies'), { c1: { l1: { s2: keep }, l2: { s1: keep } } });
    assert.deepEqual(await mem.get('replyMarks'), { s1: { c1: { l2: 1 } }, s2: { c1: { l1: 1 } } });
  }
});

test('unstampReply: 返事が無い・形が不正なら、目印だけ消して成功する', async () => {
  for (const value of [null, '文', [], { text: '文' }, { updatedAt: 1 }, { text: 'あ'.repeat(401), seen: true, updatedAt: 1 }]) {
    const { repo, mem, calls } = setup({ replies: { c1: { l1: { s1: value } } }, replyMarks: { s1: { c1: { l1: 1, l2: 2 } } } });
    const before = await mem.get('replies');
    assert.deepEqual(await repo.unstampReply('c1', 'l1', 's1', 20), { reply: null });
    assert.deepEqual(calls.get, [['replies/c1/l1/s1']]);
    assert.deepEqual(calls.update, [['', { 'replyMarks/s1/c1/l1': null }]]);
    assert.equal(writes(calls), 1);
    assert.deepEqual(await mem.get('replies'), before);
    assert.deepEqual(await mem.get('replyMarks'), { s1: { c1: { l2: 2 } } });
  }
});

test('unstampReply: すでに文だけの返事も文を残して時刻と目印を進める', async () => {
  const { repo, mem, calls } = setup({ replies: { c1: { l1: { s1: { text: '残す文', updatedAt: 1 } } } } });
  for (const now of [20, 30]) {
    assert.deepEqual(await repo.unstampReply('c1', 'l1', 's1', now), { reply: { text: '残す文', seen: false, updatedAt: now } });
    assert.deepEqual(calls.update.at(-1), ['', {
      'replies/c1/l1/s1/seen': null, 'replies/c1/l1/s1/updatedAt': now, 'replyMarks/s1/c1/l1': now,
    }]);
    assert.deepEqual(await mem.get('replies/c1/l1/s1'), { text: '残す文', updatedAt: now });
    assert.deepEqual(await mem.get('replyMarks/s1/c1'), { l1: now });
  }
  assert.equal(writes(calls), 2);
});

test('unstampReply: 読みこみ失敗はそのまま投げ、何も書かない', async () => {
  for (const code of ['network', 'denied']) {
    const error = new NetError(code);
    const mem = createMemoryNet({ initial: { replies: { c1: { l1: { s1: { seen: true, updatedAt: 1 } } } },
      replyMarks: { s1: { c1: { l1: 1 } } } } });
    const before = mem.dump();
    const { net, calls } = counted({ ...mem, get: async () => { throw error; } });
    await assert.rejects(createRepo(net).unstampReply('c1', 'l1', 's1', 20), (e) => e === error);
    assert.deepEqual(calls.get, [['replies/c1/l1/s1']]);
    assert.equal(writes(calls), 0);
    assert.deepEqual(mem.dump(), before);
  }
});

test('unstampReply: 不正な時刻は通信前に TypeError。書きこみ失敗でも一部だけ保存されない', async () => {
  const { repo, calls } = setup();
  for (const now of [undefined, null, '20', false, NaN, Infinity, {}, []]) {
    await assert.rejects(repo.unstampReply('c1', 'l1', 's1', now), TypeError);
  }
  assert.equal(calls.get.length, 0);
  assert.equal(writes(calls), 0);
  for (const value of [null, { seen: true, updatedAt: 1 }, { text: '残す文', seen: true, updatedAt: 1 }]) {
    const initial = { replies: { c1: { l1: { s1: value } } },
      replyMarks: { s1: { c1: { l1: 1 } } } };
    const error = new NetError('network');
    const mem = createMemoryNet({ initial, onChange: () => { throw error; } });
    const before = mem.dump();
    await assert.rejects(createRepo(mem).unstampReply('c1', 'l1', 's1', 20), (e) => e === error);
    assert.deepEqual(mem.dump(), before);
  }
});

test('removeReply: 本文と目印を 1 回で消し、無くても成功。他の生徒・授業は残す', async () => {
  const { repo, mem, calls } = setup();
  for (const [lid, sid] of [['l1', 's1'], ['l1', 's2'], ['l2', 's1']]) {
    await repo.setReply('c1', lid, sid, { seen: true }, 10);
  }
  for (let i = 0; i < 2; i++) {
    await repo.removeReply('c1', 'l1', 's1');
    assert.deepEqual(calls.update.at(-1), ['', { 'replies/c1/l1/s1': null, 'replyMarks/s1/c1/l1': null }]);
  }
  assert.equal(writes(calls), 5);
  assert.equal(await repo.getReply('c1', 'l1', 's1'), null);
  assert.deepEqual(await repo.getReplyMarks('s1', 'c1'), { l2: 10 });
  assert.deepEqual(await mem.get('replies'), { c1: { l1: { s2: { seen: true, updatedAt: 10 } }, l2: { s1: { seen: true, updatedAt: 10 } } } });
});

test('返事の通信: 不正な ID は通信前に断り、通信失敗はそのまま伝える', async () => {
  const { repo, calls } = setup();
  for (const bad of ['', 'bad/key', 'bad.key', '#', '$', '[', ']', null, 1]) {
    for (let i = 0; i < 3; i++) {
      const ids = ['c1', 'l1', 's1'];
      ids[i] = bad;
      await assert.rejects(repo.getReply(...ids), TypeError);
      await assert.rejects(repo.setReply(...ids, { seen: true }, 10), TypeError);
      await assert.rejects(repo.removeReply(...ids), TypeError);
      await assert.rejects(repo.unstampReply(...ids, 10), TypeError);
      if (i < 2) {
        await assert.rejects(repo.listReplies(...ids.slice(0, 2)), TypeError);
        await assert.rejects(repo.getReplyMarks(...ids.slice(0, 2)), TypeError);
      }
    }
  }
  assert.equal(calls.get.length, 0);
  assert.equal(writes(calls), 0);
  for (const code of ['network', 'denied']) {
    const error = new NetError(code);
    const fail = async () => { throw error; };
    const failed = createRepo({ get: fail, update: fail });
    for (const operation of [() => failed.getReply('c1', 'l1', 's1'), () => failed.listReplies('c1', 'l1'),
      () => failed.getReplyMarks('s1', 'c1'), () => failed.setReply('c1', 'l1', 's1', { seen: true }, 10),
      () => failed.removeReply('c1', 'l1', 's1'),
      () => failed.unstampReply('c1', 'l1', 's1', 10)]) {
      await assert.rejects(operation(), (e) => e === error);
    }
  }
});

test('deleteLesson: 浅く読んだ全員の返事と目印を授業と同時に消す。不正な返事も残さない', async () => {
  const { repo, mem, calls } = setup({ lessons: { c1: { l1: { title: '削除' }, l2: { title: '残す' } } },
    replies: { c1: { l1: { s1: { text: '文', updatedAt: 10 }, s2: { broken: true } }, l2: { s1: { seen: true, updatedAt: 20 } } } },
    replyMarks: { s1: { c1: { l1: 10, l2: 20 }, c2: { l1: 30 } }, s2: { c1: { l1: 10 } } } });
  await repo.deleteLesson('c1', 'l1');
  assert.deepEqual(calls.get, [['replies/c1/l1', { shallow: true }]]);
  assert.deepEqual(calls.update, [['', { 'lessons/c1/l1': null, 'thumbs/c1/l1': null, 'replies/c1/l1': null, 'aiSummaries/c1/l1': null,
    'replyMarks/s1/c1/l1': null, 'replyMarks/s2/c1/l1': null }]]);
  assert.equal(writes(calls), 1);
  assert.equal(await mem.get('lessons/c1/l1'), null);
  assert.equal(await mem.get('replies/c1/l1'), null);
  assert.deepEqual(await mem.get('replyMarks'), { s1: { c1: { l2: 20 }, c2: { l1: 30 } } });
  assert.deepEqual(await repo.getReply('c1', 'l2', 's1'), { text: '', seen: true, updatedAt: 20 });
});

test('deleteLesson: 浅い読みが失敗したら、何も消さずに失敗を伝える', async () => {
  for (const code of ['network', 'denied']) {
    const mem = createMemoryNet({ initial: { lessons: { c1: { l1: { title: '残す' } } } } });
    const { net, calls } = counted(mem);
    const before = mem.dump();
    const error = new NetError(code);
    const repo = createRepo({ ...net, get: async (...args) => {
      assert.deepEqual(args, ['replies/c1/l1', { shallow: true }]);
      throw error;
    } });
    await assert.rejects(repo.deleteLesson('c1', 'l1'), (e) => e === error);
    assert.equal(writes(calls), 0);
    assert.deepEqual(mem.dump(), before);
  }
});

test('返事の更新・削除: 保存先が失敗したら本文と目印・授業は変更されない', async () => {
  const initial = { lessons: { c1: { l1: { title: '残す' } } },
    replies: { c1: { l1: { s1: { text: '元の返事', updatedAt: 10 } } } },
    replyMarks: { s1: { c1: { l1: 10 } } } };
  const error = new NetError('network');
  const mem = createMemoryNet({ initial, onChange: () => { throw error; } });
  const repo = createRepo(mem);
  for (const operation of [() => repo.setReply('c1', 'l1', 's1', { text: '新しい返事', seen: true }, 20),
    () => repo.removeReply('c1', 'l1', 's1'), () => repo.deleteLesson('c1', 'l1')]) {
    await assert.rejects(operation(), (e) => e === error);
    assert.deepEqual(mem.dump(), initial);
  }
});

test('練習モードの返事: 先生と生徒の切り替え・再作成後も同じデータを読み、削除も保存する', async () => {
  const saved = new Map();
  const storage = { getItem: (k) => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v), removeItem: (k) => saved.delete(k) };
  const options = { storage, random: () => 0.1, now: () => 10 };
  let demo = createDemoBackend(options);
  let repo = createRepo(demo.net);
  const password = 'demo-only';
  const email = 's00-001.g1@jugyolog.invalid';
  await demo.auth.signIn('teacher@example.invalid', password);
  const { uid } = await demo.auth.createAccount(email, password);
  await repo.linkAccount('s00-001', { uid, generation: 1, password });
  await repo.setReply('c1', 'l1', 's00-001', { text: '確認用の返事', seen: true }, 10);
  demo.auth.signOut();
  await demo.auth.signIn(email, password);
  assert.deepEqual(await repo.getReply('c1', 'l1', 's00-001'), { text: '確認用の返事', seen: true, updatedAt: 10 });
  demo = createDemoBackend(options);
  repo = createRepo(demo.net);
  assert.equal((await demo.auth.restore()).uid, uid);
  assert.deepEqual(await repo.getReplyMarks('s00-001', 'c1'), { l1: 10 });
  demo.auth.signOut();
  await demo.auth.signIn('teacher@example.invalid', password);
  await repo.removeReply('c1', 'l1', 's00-001');
  const restored = createRepo(createDemoBackend(options).net);
  assert.equal(await restored.getReply('c1', 'l1', 's00-001'), null);
  assert.deepEqual(await restored.getReplyMarks('s00-001', 'c1'), {});
});

test('PDF の目録: 入れ子へ保存・削除し、平らな場所で読み直す。小さい画像は書かない', async () => {
  const { repo, mem, calls } = setup();
  const index = { fileId: 'page-ink', bytes: 42, strokes: 1, on: 'pdf' };
  const base = 'records/c1/l1/s26-001';
  for (const place of ['a1', 'Abc123Def456']) {
    for (const page of [1, 999]) {
      const field = `${place}#p${page}`;
      await repo.setInk('c1', 'l1', 's26-001', field, index, 'thumb', 20);
      assert.deepEqual(calls.update.at(-1), ['', { [`${base}/inkPages/${place}/p${page}`]: { ...index, updatedAt: 20 },
        [`${base}/inkPagesCleared/${place}/p${page}`]: null }]);
      for (const record of [await repo.getRecord('c1', 'l1', 's26-001'), (await repo.listRecords('c1', 'l1'))['s26-001']]) {
        assert.deepEqual(record.ink[field], { ...index, updatedAt: 20 });
      }
      await repo.removeInk('c1', 'l1', 's26-001', field, 30);
      assert.deepEqual(calls.update.at(-1), ['', { [`${base}/inkPages/${place}/p${page}`]: null,
        [`${base}/inkPagesCleared/${place}/p${page}`]: 30 }]);
      assert.equal((await repo.getRecord('c1', 'l1', 's26-001')).inkCleared[field], 30);
      assert.equal((await repo.listRecords('c1', 'l1'))['s26-001'].ink[field], undefined);
      await repo.setInk('c1', 'l1', 's26-001', field, index, null, 40);
      assert.equal((await repo.getRecord('c1', 'l1', 's26-001')).inkCleared[field], undefined);
    }
  }
  assert.equal(await mem.get('inkThumbs'), null);
  assert.equal(await mem.get('recThumbs'), null);
  assert.equal(await mem.get(`${base}/ink`), null);
  const before = writes(calls);
  for (const field of ['a1#p0', 'a1#p-1', 'a1#p1.5', 'a1#p1000', 'a1#px', 'a1#p01', 'a1#p1\n', 'memo#p1']) {
    await assert.rejects(repo.setInk('c1', 'l1', 's26-001', field, index, null, 50), TypeError);
    await assert.rejects(repo.removeInk('c1', 'l1', 's26-001', field, 50), TypeError);
  }
  for (const on of [undefined, null, 1, {}, [], '', 'x'.repeat(201)]) {
    await assert.rejects(repo.setInk('c1', 'l1', 's26-001', 'a1#p1', { ...index, on }, null, 50), TypeError);
  }
  assert.equal(writes(calls), before);
});

test('PDF の目録: 不正な場所・ページ・目録・削除時刻を落とし、写真と欄も残す', async () => {
  const index = { fileId: 'page-ink', bytes: 42, strokes: 1, on: 'pdf', updatedAt: 20 };
  const bad = [null, [], {}, { ...index, on: undefined }, { ...index, on: 1 }, { ...index, on: '' },
    { ...index, on: 'x'.repeat(201) }, { ...index, bytes: '42' }, { ...index, updatedAt: Infinity },
    { ...index, strokes: 0 }, { ...index, fileId: '' }];
  for (const value of bad) {
    const pages = { a1: { p1: index, p2: value, p0: index, p01: index, p1000: index, 1: index, 'p1\n': index },
      Abc123Def456: { p999: index }, memo: { p1: index }, a7: { p1: index }, 'a1#p1': { p1: index }, a2: [], a3: 1 };
    const record = { ink: { a4: index, memo: index }, inkCleared: { a5: 10 }, inkPages: pages,
      inkPagesCleared: { a1: { p1: 0, p2: '30', p3: Infinity, p0: 30, p01: 30, p1000: 30, 1: 30 },
        Abc123Def456: { p999: 30 }, memo: { p1: 30 }, a7: { p1: 30 }, a2: [] } };
    const repo = createRepo({ get: async (path) => path.endsWith('/s26-001') ? record : { 's26-001': record } });
    for (const got of [await repo.getRecord('c1', 'l1', 's26-001'), (await repo.listRecords('c1', 'l1'))['s26-001']]) {
      assert.deepEqual(Object.keys(got.ink).sort(), ['Abc123Def456#p999', 'a1#p1', 'a4', 'memo']);
      assert.deepEqual(got.ink['a1#p1'], index);
      assert.deepEqual(got.inkCleared, { a5: 10, 'a1#p1': 0, 'Abc123Def456#p999': 30 });
    }
  }
});

test('PDF の添付削除: 全ページを一緒に消し、指定したページだけに時刻を残す', async () => {
  const { repo, calls, mem } = setup();
  const base = 'records/c1/l1/s26-001';
  await mem.set(base, { inkPages: { a1: { p1: { fileId: 'one' }, p999: { fileId: 'last' } }, a2: { p1: { fileId: 'other' } } },
    inkPagesCleared: { a1: { p3: 10 } } });
  await repo.removeAttachment('c1', 'l1', 's26-001', 'a1', 30, [1, 999, 1]);
  assert.deepEqual(calls.update.at(-1), ['', { [`${base}/attachments/a1`]: null, 'recThumbs/c1/l1/s26-001/a1': null,
    [`${base}/ink/a1`]: null, [`${base}/inkCleared/a1`]: 30, [`${base}/inkPages/a1`]: null,
    [`${base}/inkPagesCleared/a1/p1`]: 30, [`${base}/inkPagesCleared/a1/p999`]: 30 }]);
  assert.equal(await mem.get(`${base}/inkPages/a1`), null);
  assert.deepEqual(await mem.get(`${base}/inkPages/a2`), { p1: { fileId: 'other' } });
  assert.equal(await mem.get(`${base}/inkPagesCleared/a1/p3`), 10);
  await repo.removeAttachment('c1', 'l1', 's26-001', 'a1', 40, []);
  assert.equal(calls.update.at(-1)[1][`${base}/inkPages/a1`], null);
  const before = writes(calls);
  for (const pages of [null, {}, 1, '1', [0], [-1], [1.5], [1000], ['1'], ['01'], [NaN], [undefined], Array(1)]) {
    await assert.rejects(repo.removeAttachment('c1', 'l1', 's26-001', 'a1', 50, pages), TypeError);
  }
  await assert.rejects(repo.removeAttachment('c1', 'l1', 's26-001', 'a1', undefined, [1]), TypeError);
  assert.equal(writes(calls), before);
});

test('写真の手書き目録: on を保存・取得し、欄には付けず写真の画像も書かない', async () => {
  const { repo, mem, calls } = setup();
  const index = { fileId: 'ink-file', bytes: 42, strokes: 1, on: 'photo' };
  for (const field of ['a1', 'Abc123Def456', 'memo']) {
    await repo.setInk('c1', 'l1', 's26-001', field, index, 'thumb', 20);
    const expected = { fileId: 'ink-file', bytes: 42, strokes: 1, updatedAt: 20, ...(field !== 'memo' ? { on: 'photo' } : {}) };
    assert.deepEqual(calls.update.at(-1), ['', { [`records/c1/l1/s26-001/ink/${field}`]: expected,
      [`records/c1/l1/s26-001/inkCleared/${field}`]: null }]);
    assert.deepEqual((await repo.getRecord('c1', 'l1', 's26-001')).ink[field], expected);
    assert.deepEqual((await repo.listRecords('c1', 'l1'))['s26-001'].ink[field], expected);
    await repo.removeInk('c1', 'l1', 's26-001', field, 30);
    assert.equal((await repo.getRecord('c1', 'l1', 's26-001')).inkCleared[field], 30);
    assert.equal((await repo.listRecords('c1', 'l1'))['s26-001'].inkCleared[field], 30);
  }
  assert.equal(await mem.get('inkThumbs'), null);
  const before = writes(calls);
  for (const field of ['a1', 'Abc123Def456']) {
    for (const on of [undefined, null, 1, {}, []]) {
      await assert.rejects(repo.setInk('c1', 'l1', 's26-001', field, { ...index, on }, null, 40), TypeError);
    }
  }
  assert.equal(writes(calls), before);
});

test('写真の手書き目録: on の欠け・型・長さを選別し、欄の on は落とす', async () => {
  const index = { fileId: 'ink-file', bytes: 42, strokes: 1, updatedAt: 20 };
  for (const on of [undefined, null, 1, {}, [], '', 'x'.repeat(201), 'x', 'x'.repeat(200)]) {
    const value = { ink: { memo: { ...index, on }, a1: { ...index, on }, Abc123Def456: { ...index, on }, other: index },
      inkCleared: { memo: 1, a1: 0, Abc123Def456: 30, other: 40, a2: '50' } };
    const repo = createRepo({ get: async (path) => path.endsWith('/s26-001') ? value : { 's26-001': value } });
    const expected = { memo: index };
    if (typeof on === 'string' && on.length > 0 && on.length <= 200) {
      expected.a1 = { ...index, on };
      expected.Abc123Def456 = { ...index, on };
    }
    for (const record of [await repo.getRecord('c1', 'l1', 's26-001'), (await repo.listRecords('c1', 'l1'))['s26-001']]) {
      assert.deepEqual(record.ink, expected);
      assert.deepEqual(record.inkCleared, { memo: 1, a1: 0, Abc123Def456: 30 });
    }
  }
});

test('removeAttachment: 削除時刻があれば写真と書きこみを一緒に消す。省略時は以前のまま', async () => {
  for (const clearedAt of [undefined, 0, 30]) {
    const { repo, mem, calls } = setup();
    await repo.addAttachment('c1', 'l1', 's26-001', 'a1', { type: 'image', fileId: 'photo', bytes: 42 }, 'thumb', 1);
    await repo.setInk('c1', 'l1', 's26-001', 'a1', { fileId: 'ink', bytes: 42, strokes: 1, on: 'photo' }, null, 20);
    const before = calls.update.length;
    await repo.removeAttachment('c1', 'l1', 's26-001', 'a1', clearedAt);
    const patch = { 'records/c1/l1/s26-001/attachments/a1': null, 'recThumbs/c1/l1/s26-001/a1': null };
    if (clearedAt !== undefined) Object.assign(patch, { 'records/c1/l1/s26-001/ink/a1': null,
      'records/c1/l1/s26-001/inkCleared/a1': clearedAt });
    assert.deepEqual(calls.update[before], ['', patch]);
    assert.equal(calls.update.length, before + 1);
    assert.equal((await mem.get('records/c1/l1/s26-001/ink/a1')) === null, clearedAt !== undefined);
  }
  const { repo, calls } = setup();
  for (const time of [null, '30', false, NaN, Infinity, {}, []]) {
    await assert.rejects(repo.removeAttachment('c1', 'l1', 's26-001', 'a1', time), TypeError);
  }
  assert.equal(writes(calls), 0);
});

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

test('授業のリンク: 追加・順番・削除を 1 回ずつ書き、ほかの項目を残す', async () => {
  const original = { title: '確認用授業', materials: { m1: { fileId: 'TestFile' } }, terms: { t1: '光' }, createdAt: 1 };
  const { repo, mem, calls } = setup({ lessons: { c1: { l1: original } } });
  const link = { url: 'https://example.com/', title: '確認用サイト', order: 0 };
  await repo.addLessonLink('c1', 'l1', 'link1', { ...link, extra: true }, 100);
  assert.deepEqual(calls.update, [['', { 'lessons/c1/l1/links/link1': link, 'lessons/c1/l1/updatedAt': 100 }]]);
  assert.deepEqual(await mem.get('lessons/c1/l1'), { ...original, links: { link1: link }, updatedAt: 100 });
  await repo.setLinkOrders('c1', 'l1', { link1: 2 }, 200);
  assert.deepEqual(calls.update[1], ['', { 'lessons/c1/l1/links/link1/order': 2, 'lessons/c1/l1/updatedAt': 200 }]);
  assert.deepEqual((await repo.getLesson('c1', 'l1')).links, { link1: { ...link, order: 2 } });
  await repo.setLinkOrders('c1', 'l1', {}, 300);
  assert.equal(calls.update.length, 2);
  await repo.updateLesson('c1', 'l1', { date: '2026-11-20', title: '変更', unitId: '' }, 300);
  assert.deepEqual((await repo.getLesson('c1', 'l1')).links, { link1: { ...link, order: 2 } });
  await repo.removeLessonLink('c1', 'l1', 'link1', 400);
  assert.deepEqual(calls.update.at(-1), ['', { 'lessons/c1/l1/links/link1': null, 'lessons/c1/l1/updatedAt': 400 }]);
  assert.deepEqual((await repo.getLesson('c1', 'l1')).links, {});
  assert.deepEqual(await mem.get('lessons/c1/l1/materials'), original.materials);
  assert.deepEqual(await mem.get('lessons/c1/l1/terms'), original.terms);
});

test('授業のリンク: 読みこみはオブジェクトだけを残し、新規授業には写さない', async () => {
  const links = { l1: { url: 'https://example.com/', title: '', order: 0 }, broken: 1 };
  const { repo } = setup({ lessons: { c1: { good: { links }, missing: {}, array: { links: [] }, text: { links: 'x' }, nil: { links: null } } } });
  for (const lesson of await repo.listLessons('c1')) {
    assert.deepEqual(lesson.links, lesson.id === 'good' ? links : {});
    assert.deepEqual((await repo.getLesson('c1', lesson.id)).links, lesson.links);
  }
  await repo.createLessons([{ classId: 'c1', lessonId: 'new', date: '2026-11-20', title: '確認用授業', links }], 100);
  assert.deepEqual((await repo.getLesson('c1', 'new')).links, {});
});

test('授業のリンク: 不正なキーを書かず、通信の失敗を呼び出し元へ返す', async () => {
  const { repo, calls } = setup();
  const link = { url: 'https://example.com/', title: '', order: 0 };
  await assert.rejects(repo.addLessonLink('c1', 'l1', 'bad/key', link, 1), TypeError);
  await assert.rejects(repo.removeLessonLink('c1', 'l1', 'bad/key', 1), TypeError);
  await assert.rejects(repo.setLinkOrders('c1', 'l1', { 'bad/key': 0 }, 1), TypeError);
  assert.equal(calls.update.length, 0);
  const error = new Error('確認用の通信失敗');
  const failed = createRepo({ update: async () => { throw error; } });
  await assert.rejects(failed.addLessonLink('c1', 'l1', 'a', link, 1), (e) => e === error);
  await assert.rejects(failed.removeLessonLink('c1', 'l1', 'a', 1), (e) => e === error);
  await assert.rejects(failed.setLinkOrders('c1', 'l1', { a: 0 }, 1), (e) => e === error);
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
    's26-001': { ...first, attachments: [], ink: {}, inkCleared: {} },
    's26-002': { memo: '', level: null, learned: 'あ'.repeat(2000), question: '', updatedAt: 0, attachments: [], ink: {}, inkCleared: {} },
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
    's26-001': { memo: '', level: null, learned: '', question: '', updatedAt: 0, attachments: [], ink: {}, inkCleared: {} },
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
  assert.deepEqual(await repo.getRecord('c1', 'l1', 's26-001'), { ...record, updatedAt: 5000, attachments: [], ink: {}, inkCleared: {} });
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
  assert.deepEqual(await repo.getRecord('c1', 'l1', 's26-001'), { memo: '', level: null, learned: 'あ'.repeat(2000), question: '', updatedAt: 0, attachments: [], ink: {}, inkCleared: {} });
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
  assert.deepEqual(calls.update, [['', { 'lessons/c1/l1': null, 'thumbs/c1/l1': null, 'replies/c1/l1': null, 'aiSummaries/c1/l1': null }]]);
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
  assert.deepEqual(list[2], { id: 'l1', classId: 'c1', date: '2026-11-11', title: '電流', unitId: 'u1', materials, links: {}, terms: {}, createdAt: 900, updatedAt: 1000 });
  assert.deepEqual(list[3], { id: 'bad', classId: 'c1', date: '', title: '', unitId: '', materials: {}, links: {}, terms: {}, createdAt: 0, updatedAt: 0 });
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


test('手書き目録: getRecord と listRecords は不正値を落とし、境界値を返す', async () => {
  const index = { fileId: 'file-ink', bytes: 400000, strokes: 2000, updatedAt: 10 };
  const bad = [null, [], {}, { ...index, fileId: '' }, { ...index, fileId: 1 }, { ...index, fileId: 'x'.repeat(201) },
    { ...index, bytes: '1' }, { ...index, bytes: -1 }, { ...index, bytes: 400001 }, { ...index, bytes: Infinity },
    { ...index, strokes: 0 }, { ...index, strokes: 1.5 }, { ...index, strokes: 2001 }, { ...index, strokes: '1' },
    { ...index, updatedAt: '10' }, { ...index, updatedAt: NaN }];
  for (const value of bad) {
    const repo = createRepo({ get: async (p) => p.endsWith('/s26-001')
      ? { ink: { memo: index, learned: value, other: index } }
      : { 's26-001': { ink: { memo: index, learned: value, other: index } } } });
    assert.deepEqual((await repo.getRecord('c1', 'l1', 's26-001')).ink, { memo: index });
    assert.deepEqual((await repo.listRecords('c1', 'l1'))['s26-001'].ink, { memo: index });
  }
  const { repo } = setup({ records: { c1: { l1: { 's26-001': { memo: '文字' } } } } });
  assert.deepEqual((await repo.getRecord('c1', 'l1', 's26-001')).ink, {});
  assert.deepEqual((await repo.listRecords('c1', 'l1'))['s26-001'].ink, {});
});

test('手書き目録: 1 回の update で目録・削除時刻・画像を書き、undefined は画像を維持', async () => {
  const original = { memo: '文字', learned: '学び', question: '問い', level: 3, updatedAt: 5,
    attachments: { a1: { type: 'image', fileId: 'photo', bytes: 3, addedAt: 1 } } };
  const { repo, mem, calls } = setup({ records: { c1: { l1: { 's26-001': original } } }, marks: { 's26-001': { c1: { l1: 3 } } } });
  const index = { fileId: 'ink', bytes: 0, strokes: 1 };
  for (const field of ['learned', 'question']) {
    for (const thumb of ['data:image/png;base64,AQID', undefined, null]) {
      const before = calls.update.length;
      await repo.setInk('c1', 'l1', 's26-001', field, index, thumb, 20);
      const patch = { ['records/c1/l1/s26-001/ink/' + field]: { ...index, updatedAt: 20 }, ['records/c1/l1/s26-001/inkCleared/' + field]: null };
      if (thumb !== undefined) patch[`inkThumbs/c1/l1/${field}/s26-001`] = thumb;
      assert.deepEqual(calls.update[before], ['', patch]);
      assert.equal(calls.update.length, before + 1);
      assert.equal((await repo.listInkThumbs('c1', 'l1', field))['s26-001'], thumb === null ? undefined : 'data:image/png;base64,AQID');
      const { ink, inkCleared, ...record } = await mem.get('records/c1/l1/s26-001');
      assert.deepEqual(record, original);
      assert.equal(await mem.get('marks/s26-001/c1/l1'), 3);
    }
    await repo.setInk('c1', 'l1', 's26-001', field, index, 'data:image/png;base64,AQID', 20);
    await repo.removeInk('c1', 'l1', 's26-001', field, 30);
    assert.deepEqual(calls.update.at(-1), ['', {
      ['records/c1/l1/s26-001/ink/' + field]: null, ['records/c1/l1/s26-001/inkCleared/' + field]: 30, [`inkThumbs/c1/l1/${field}/s26-001`]: null,
    }]);
    assert.equal(await mem.get(`inkThumbs/c1/l1/${field}/s26-001`), null);
    assert.equal(await mem.get(`records/c1/l1/s26-001/ink/${field}`), null);
    await repo.removeInk('c1', 'l1', 's26-001', field, 30);
  }
  const before = writes(calls);
  for (const field of ['other', '', 'memo/x', undefined]) {
    await assert.rejects(repo.setInk('c1', 'l1', 's26-001', field, index, null, 20), TypeError);
    await assert.rejects(repo.removeInk('c1', 'l1', 's26-001', field, 30), TypeError);
  }
  assert.equal(writes(calls), before);
});

test('手書きの削除時刻: getRecord と listRecords は 3 欄の数だけを返す', async () => {
  for (const value of [undefined, null, [], 1, '20', { memo: 0, learned: 20, question: 30, other: 40 },
    { memo: '20', learned: Infinity, question: NaN }, { memo: false, learned: {}, question: [] }]) {
    const repo = createRepo({ get: async (path) => path.endsWith('/s26-001')
      ? { inkCleared: value } : { 's26-001': { inkCleared: value } } });
    const expected = value?.memo === 0 ? { memo: 0, learned: 20, question: 30 } : {};
    assert.deepEqual((await repo.getRecord('c1', 'l1', 's26-001')).inkCleared, expected);
    assert.deepEqual((await repo.listRecords('c1', 'l1'))['s26-001'].inkCleared, expected);
  }
});

test('手書きの削除時刻: 消すと残り、新しく保存すると同じ update で消える。不正時刻は書かない', async () => {
  const { repo, mem, calls } = setup();
  for (const field of ['memo', 'learned', 'question']) {
    await repo.removeInk('c1', 'l1', 's26-001', field, 30);
    assert.equal(await mem.get(`records/c1/l1/s26-001/inkCleared/${field}`), 30);
    await repo.setInk('c1', 'l1', 's26-001', field, { fileId: 'new', bytes: 42, strokes: 1 }, null, 40);
    assert.equal(await mem.get(`records/c1/l1/s26-001/inkCleared/${field}`), null);
    assert.equal((await repo.getRecord('c1', 'l1', 's26-001')).ink[field].updatedAt, 40);
  }
  const before = writes(calls);
  for (const now of [undefined, null, '30', NaN, Infinity, -Infinity, {}, [], false]) {
    await assert.rejects(repo.removeInk('c1', 'l1', 's26-001', 'memo', now), TypeError);
  }
  assert.equal(writes(calls), before);
});

test('手書きメモ: 画像の引数にかかわらず目録だけを保存・削除し、画像には触らない', async () => {
  const initial = {
    inkThumbs: { c1: { l1: { learned: { 's26-001': '学びの画像' }, question: { 's26-001': '問いの画像' } } } },
    recThumbs: { c1: { l1: { 's26-001': { a1: '添付の画像' } } } },
  };
  const { repo, mem, calls } = setup(initial);
  const index = { fileId: 'ink', bytes: 10, strokes: 1 };
  for (const thumb of ['data:image/png;base64,AQID', null, undefined, 42, false, {}]) {
    await repo.setInk('c1', 'l1', 's26-001', 'memo', index, thumb, 20);
    assert.deepEqual(calls.update.at(-1), ['', { 'records/c1/l1/s26-001/ink/memo': { ...index, updatedAt: 20 }, 'records/c1/l1/s26-001/inkCleared/memo': null }]);
    assert.deepEqual(await mem.get('inkThumbs'), initial.inkThumbs);
    assert.deepEqual(await mem.get('recThumbs'), initial.recThumbs);
  }
  for (let i = 0; i < 2; i++) {
    await repo.removeInk('c1', 'l1', 's26-001', 'memo', 30);
    assert.deepEqual(calls.update.at(-1), ['', { 'records/c1/l1/s26-001/ink/memo': null, 'records/c1/l1/s26-001/inkCleared/memo': 30 }]);
    assert.equal(await mem.get('records/c1/l1/s26-001/ink/memo'), null);
    assert.deepEqual(await mem.get('inkThumbs'), initial.inkThumbs);
    assert.deepEqual(await mem.get('recThumbs'), initial.recThumbs);
  }
});

test('listInkThumbs: 1 つの欄を 1 回で読み、文字以外を落とし、書きこまない', async () => {
  for (const field of ['learned', 'question']) {
    const values = { 's26-001': 'data:image/png;base64,AQID', 's26-002': 'x'.repeat(20000),
      's26-003': 3, 's26-004': {}, 's26-005': [], 's26-006': false };
    const { repo, calls } = setup({ inkThumbs: { c1: { l1: { [field]: values } } } });
    assert.deepEqual(await repo.listInkThumbs('c1', 'l1', field), { 's26-001': values['s26-001'], 's26-002': values['s26-002'] });
    assert.deepEqual(calls.get, [[`inkThumbs/c1/l1/${field}`]]);
    assert.deepEqual(await repo.listInkThumbs('c1', 'missing', field), {});
    assert.equal(writes(calls), 0);
  }
  for (const value of [null, [], 3, false, '不正な一覧']) {
    const repo = createRepo({ get: async () => value });
    assert.deepEqual(await repo.listInkThumbs('c1', 'l1', 'learned'), {});
  }
});

test('listInkThumbs: 不正な欄やキーは通信せず TypeError。読み取り失敗は呼び出し元へ返す', async () => {
  const { repo, calls } = setup();
  for (const field of ['memo', 'other', '', 'learned/x', null, undefined, 1]) {
    await assert.rejects(repo.listInkThumbs('c1', 'l1', field), TypeError);
  }
  for (const key of ['', 'bad/key', 'bad.key', null, undefined]) {
    await assert.rejects(repo.listInkThumbs(key, 'l1', 'learned'), TypeError);
    await assert.rejects(repo.listInkThumbs('c1', key, 'question'), TypeError);
  }
  assert.deepEqual(calls.get, []);
  assert.equal(writes(calls), 0);
  const error = new NetError('network');
  await assert.rejects(createRepo({ get: async () => { throw error; } }).listInkThumbs('c1', 'l1', 'learned'), (e) => e === error);
});
