import { test } from 'node:test';
import assert from 'node:assert/strict';
import { removeCohort, restoreCohort, purgeCohort } from '../js/graduate-flow.js';
import { cohorts } from '../js/graduate-logic.js';
import { createRepo } from '../js/repo.js';
import { createMemoryNet } from '../js/dev/memory-net.js';
import { NetError } from '../js/errors.js';

const sid = 's26-001';
const other = 's25-001';
function setup() {
  const calls = [], progress = [];
  const mem = createMemoryNet({ initial: {
    students: { [sid]: { uid: 'test1' }, 's26-002': {} },
    removed: { [sid]: { uid: 'test1', removedAt: 0 }, 's26-002': { removedAt: 0 } },
    memberOf: { [sid]: { c1: true }, [other]: { c1: true } },
    members: { c1: { [sid]: 1, [other]: 2 } },
    classes: { c1: { year: 2026 } }, lessons: { c1: { l1: { createdAt: 1 }, l2: { createdAt: 2 } } },
    records: { c1: { l1: { [sid]: { attachments: { a1: { type: 'image', fileId: 'photo', bytes: 1, addedAt: 1 } },
      ink: { learned: { fileId: 'ink', bytes: 1, strokes: 1, updatedAt: 1 } } }, [other]: { memo: '残す記録' } } } },
    replies: { c1: { l2: { [sid]: { text: '確認用', updatedAt: 1 } } } },
    aiSummaries: { c1: { l1: { overview: '確認用' }, l2: { overview: '確認用' } } },
  } });
  const repo = createRepo({ ...mem, update: async (path, patch) => { calls.push(['update', patch]); await mem.update(path, patch); } });
  const trashed = new Set();
  const files = { trashStudents: async (ids, owners) => {
    calls.push(['files', ids, owners]);
    const count = ids.filter((id) => !trashed.has(id)).length;
    ids.forEach((id) => trashed.add(id));
    return { trashed: count, missing: ids.length - count, skipped: 0 };
  } };
  const cohort = { year: 2026, purgeable: [{ id: sid, uid: 'test1' }, { id: 's26-002', uid: null }] };
  return { repo, mem, calls, files, cohort, batch: 1, progress, onProgress: (p) => progress.push(p) };
}

test('消すのは使用中の人だけ、もどすのは 30 日の境界前の人だけ', async () => {
  const calls = [];
  const repo = { removeStudents: async (...args) => calls.push(['remove', ...args]), restoreStudents: async (...args) => calls.push(['restore', ...args]) };
  const cohort = cohorts({ students: ['s26-001', 's26-002', 's26-003'].map((id) => ({ id, uid: null })),
    removed: { 's26-002': { removedAt: 0 }, 's26-003': { removedAt: 1 } }, now: 30 * 86400000, graceDays: 30 })[0];
  assert.equal(await removeCohort({ repo, cohort, now: 42 }), 1);
  assert.equal(await restoreCohort({ repo, cohort }), 1);
  assert.deepEqual(calls.map((c) => [c[0], c[1].map((s) => s.id)]), [['remove', ['s26-001']], ['restore', ['s26-003']]]);
  assert.equal(calls[0][2], 42);
});

test('消すの denied は changed にし、ほかの失敗はそのまま返す', async () => {
  for (const code of ['denied', 'network', 'auth']) {
    const error = new NetError(code);
    const repo = { removeStudents: async () => { throw error; } };
    await assert.rejects(removeCohort({ repo, cohort: { active: [{ id: sid, uid: 'test1' }] }, now: 1 }),
      (e) => code === 'denied' ? e.code === 'changed' : e === error);
  }
});

test('ファイル、授業の記録、生徒、removed の順。返事だけの授業も消し、ほかの生徒と授業は残す', async () => {
  const h = setup();
  assert.deepEqual(await purgeCohort(h), { students: 2, files: 2, unknownFiles: 0 });
  const positions = h.calls.map(([kind, value]) => kind === 'files' ? kind
    : Object.keys(value).some((p) => p.endsWith('/purging')) ? 'purging'
    : Object.keys(value).some((p) => p.startsWith('records/')) ? 'lesson'
      : Object.keys(value).some((p) => p.startsWith('students/')) ? 'student' : 'removed');
  assert.deepEqual(positions, ['purging', 'lesson', 'files', 'files', 'lesson', 'student', 'removed', 'student', 'removed']);
  assert.equal(await h.mem.get(`records/c1/l1/${sid}`), null);
  assert.equal(await h.mem.get(`replies/c1/l2/${sid}`), null);
  assert.equal(await h.mem.get('aiSummaries'), null);
  assert.deepEqual(await h.mem.get(`records/c1/l1/${other}`), { memo: '残す記録' });
  assert.ok(await h.mem.get('lessons/c1/l1'));
  assert.ok(await h.mem.get('classes/c1'));
  assert.deepEqual(h.progress.at(-1), { phase: 'students', doneClasses: 1, totalClasses: 1, doneLessons: 2, totalLessons: 2, doneStudents: 2, totalStudents: 2 });
  assert.equal(h.progress.length, 8);
  assert.deepEqual(await purgeCohort(h), { students: 2, files: 0, unknownFiles: 0 });
});

for (const mode of ['throw', 'skipped', 'missing']) test(`ファイルの ${mode} を扱う`, async () => {
  const h = setup();
  h.files.trashStudents = async () => {
    if (mode === 'throw') throw new NetError('network');
    return { trashed: 0, missing: mode === 'missing' ? 1 : 0, skipped: mode === 'skipped' ? 1 : 0 };
  };
  if (mode === 'missing') assert.deepEqual(await purgeCohort(h), { students: 2, files: 0, unknownFiles: 0 });
  else {
    await assert.rejects(purgeCohort(h), { code: mode === 'throw' ? 'files' : 'skipped' });
    assert.ok(await h.mem.get(`records/c1/l1/${sid}`));
    assert.ok(await h.mem.get(`students/${sid}`));
    assert.ok(await h.mem.get(`removed/${sid}`));
  }
});

test('停止は次の通信より前。再実行は missing のファイルを通って片付ける', async () => {
  const h = setup();
  const controller = new AbortController();
  const original = h.files.trashStudents;
  h.files.trashStudents = async (...args) => { const result = await original(...args); controller.abort(); return result; };
  await assert.rejects(purgeCohort({ ...h, signal: controller.signal }), { name: 'AbortError' });
  assert.ok(await h.mem.get(`records/c1/l1/${sid}`));
  h.files.trashStudents = original;
  assert.deepEqual(await purgeCohort(h), { students: 2, files: 1, unknownFiles: 0 });
});

test('開始前の停止、DB の denied、クラスなし・uid なし・空の学年', async () => {
  const h = setup();
  await assert.rejects(purgeCohort({ ...h, signal: AbortSignal.abort() }), { name: 'AbortError' });
  assert.equal(h.calls.length, 0);
  await assert.rejects(purgeCohort({ ...h, repo: { ...h.repo, markPurging: async () => { throw new NetError('denied'); } } }), { code: 'denied' });
  h.cohort = { year: 2026, purgeable: [{ id: 's26-002', uid: null }] };
  assert.deepEqual(await purgeCohort(h), { students: 1, files: 0, unknownFiles: 0 });
  assert.ok(h.calls.every(([kind]) => kind !== 'files'));
  h.cohort = { year: 2026, purgeable: [] };
  assert.deepEqual(await purgeCohort(h), { students: 0, files: 0, unknownFiles: 0 });
});

test('生徒の台帳削除と removed の間で停止しても、次の一覧から最後まで片付けられる', async () => {
  const h = setup();
  const controller = new AbortController();
  const repo = createRepo({ ...h.mem, update: async (path, patch) => {
    await h.mem.update(path, patch);
    if (`students/${sid}` in patch) controller.abort();
  } });
  await assert.rejects(purgeCohort({ ...h, repo, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(await h.mem.get(`students/${sid}`), null);
  assert.ok(await h.mem.get(`removed/${sid}`));
  const group = cohorts({ students: await h.repo.listStudents(), removed: await h.repo.listRemoved(), now: 30 * 86400000, graceDays: 30 })[0];
  await purgeCohort({ ...h, cohort: group });
  assert.equal(await h.mem.get('removed'), null);
});

test('61 人のクラスでも GAS の上限内で分け、同じファイルは一度だけ送り、全部済むまで記録を残す', async () => {
  const students = Array.from({ length: 61 }, (_, i) => ({ id: `s26-${String(i + 1).padStart(3, '0')}`, uid: null }));
  const records = Object.fromEntries(students.map(({ id }) => [id, { attachments: [{ fileId: `file-${id}` }], ink: { memo: { fileId: `file-${id}` } } }]));
  const calls = [];
  const repo = {
    markPurging: async () => {}, listClasses: async () => [{ id: 'c1', year: 2026 }],
    listStudentIndex: async () => [],
    listRecordIds: async () => students.map((s) => s.id),
    listMemberOf: async () => Object.fromEntries(students.map(({ id }) => [id, ['c1']])),
    listLessons: async () => [{ id: 'l1' }], listRecords: async () => records,
    purgeLessonRecords: async (...args) => calls.push(['records', ...args]),
    purgeStudent: async () => {},
  };
  const files = { trashStudents: async (ids, owners) => {
    assert.ok(ids.length <= 20 && owners.length <= 60);
    assert.ok(ids.every((id) => owners.includes(id.slice(5))));
    calls.push(['files', ids]);
    return { trashed: ids.length, missing: 0, skipped: 0 };
  } };
  assert.deepEqual(await purgeCohort({ repo, files, cohort: { year: 2026, purgeable: students }, batch: 20 }), { students: 61, files: 61, unknownFiles: 0 });
  assert.deepEqual(calls.slice(0, -1).map(([, ids]) => ids.length), [20, 20, 20, 1]);
  assert.deepEqual(calls.at(-1), ['records', 'c1', 'l1', students.map((s) => s.id)]);
});

test('確認できないファイルがあれば、その授業の記録・返事を残す。明示した場合だけとばして数を返す', async () => {
  const h = setup();
  await h.mem.set(`replies/c1/l1/${sid}`, { text: '確認用', updatedAt: 1 });
  h.files.trashStudents = async () => ({ trashed: 0, missing: 0, skipped: 0, unknown: 1 });
  for (const allowUnknown of [undefined, false, 'true']) {
    await assert.rejects(purgeCohort({ ...h, allowUnknown }), { code: 'unknown-files', count: 1 });
    assert.ok(await h.mem.get(`records/c1/l1/${sid}`));
    assert.ok(await h.mem.get(`replies/c1/l1/${sid}`));
    assert.equal(await h.mem.get(`removed/${sid}/purging`), true);
    assert.equal(await h.mem.get('removed/s26-002/purging'), true);
  }
  assert.deepEqual(await purgeCohort({ ...h, allowUnknown: true }), { students: 2, files: 0, unknownFiles: 2 });
  assert.equal(await h.mem.get(`records/c1/l1/${sid}`), null);
  assert.equal(await h.mem.get(`replies/c1/l1/${sid}`), null);
});

test('開始の印は読み取りより先。印を書けなければ探索・ファイル・記録の削除へ進まない', async () => {
  const h = setup();
  const calls = [];
  const repo = { ...h.repo,
    markPurging: async (ids) => { calls.push(['purging', ids]); throw new NetError('denied'); },
    listMemberOf: async () => { calls.push(['members']); return {}; },
    listClasses: async () => { calls.push(['classes']); return []; },
  };
  await assert.rejects(purgeCohort({ ...h, repo }), { code: 'denied' });
  assert.deepEqual(calls, [['purging', [sid, 's26-002']]]);
  assert.deepEqual(h.calls, []);
});

test('名簿から外した生徒の過去の記録・ファイルと、返事だけの授業も全員分消す', async () => {
  const h = setup();
  await h.repo.saveMembers('c1', { set: {}, remove: [sid] });
  await h.mem.set('replies/c1/l2/s26-002', { seen: true, updatedAt: 1 });
  await h.mem.set('replyMarks/s26-002/c1/l2', 1);
  h.calls.length = 0;
  const reads = [];
  const repo = { ...h.repo, listRecords: async (cid, lid) => { reads.push([cid, lid]); return h.repo.listRecords(cid, lid); } };
  assert.deepEqual(await purgeCohort({ ...h, repo }), { students: 2, files: 2, unknownFiles: 0 });
  assert.deepEqual(reads, [['c1', 'l1']]);
  assert.equal(await h.mem.get(`records/c1/l1/${sid}`), null);
  assert.equal(await h.mem.get('replies'), null);
  assert.equal(await h.mem.get('replyMarks'), null);
  assert.equal(await h.mem.get('aiSummaries'), null);
  assert.deepEqual(await h.mem.get('members/c1'), { [other]: 2 });
  assert.ok(h.calls.filter(([kind]) => kind === 'files').every(([, , owners]) => owners.includes(sid)));
  assert.ok(h.calls.filter(([kind]) => kind === 'update').every(([, patch]) => !(`members/c1/${sid}` in patch)));
});

test('名簿から外れた生徒の最後の記録を消した直後に止まっても、返事だけの授業を取り残さない', async () => {
  const h = setup();
  await h.repo.saveMembers('c1', { set: {}, remove: [sid] });
  await h.mem.set('lessons/c1/l2/createdAt', 0);
  const controller = new AbortController();
  const repo = { ...h.repo, purgeLessonRecords: async (...args) => {
    await h.repo.purgeLessonRecords(...args);
    if (args[1] === 'l1') controller.abort();
  } };
  await assert.rejects(purgeCohort({ ...h, repo, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(await h.mem.get(`records/c1/l1/${sid}`), null);
  assert.equal(await h.mem.get(`replies/c1/l2/${sid}`), null);
  assert.equal(await h.mem.get('aiSummaries'), null);
  assert.equal(await h.mem.get(`removed/${sid}/purging`), true);
  await purgeCohort(h);
  assert.equal(await h.mem.get('removed'), null);
  assert.equal(await h.mem.get('replies'), null);
  assert.ok(await h.mem.get('lessons/c1/l2'));
});

test('入学年度前と年度 0 は調べず、無関係のクラスには書かない。進み具合は関係する授業だけ', async () => {
  const h = setup();
  for (const [cid, year] of [['before', 2025], ['probe', 0], ['unrelated', 2027]]) {
    await h.mem.set(`classes/${cid}`, { year });
    await h.mem.set(`lessons/${cid}/l1`, { createdAt: 1 });
    await h.mem.set(`records/${cid}/l1/${cid === 'unrelated' ? other : sid}`, { memo: '残す記録' });
    await h.mem.set(`aiSummaries/${cid}/l1`, { overview: '残すまとめ' });
    if (cid !== 'unrelated') {
      await h.mem.set(`memberOf/${sid}/${cid}`, true);
      await h.mem.set(`members/${cid}/${sid}`, 1);
    }
  }
  const reads = [];
  const repo = { ...h.repo };
  for (const method of ['listLessons', 'listRecordIds', 'listRecords']) repo[method] = async (...args) => {
    assert.equal(await h.mem.get(`removed/${sid}/purging`), true);
    reads.push([method, ...args]); return h.repo[method](...args);
  };
  await purgeCohort({ ...h, repo });
  assert.ok(reads.every(([, cid]) => !['before', 'probe'].includes(cid)));
  assert.ok(reads.some(([method, cid]) => method === 'listRecordIds' && cid === 'unrelated'));
  assert.ok(!reads.some(([method, cid]) => method === 'listRecords' && cid === 'unrelated'));
  for (const [, patch] of h.calls.filter(([kind]) => kind === 'update')) {
    assert.ok(Object.keys(patch).every((path) => !path.split('/').some((key) => ['before', 'probe', 'unrelated'].includes(key))));
  }
  assert.equal(await h.mem.get(`members/before/${sid}`), 1);
  assert.ok(await h.mem.get(`records/probe/l1/${sid}`));
  assert.deepEqual(h.progress.filter((p) => p.phase === 'scan').map((p) => [p.doneClasses, p.totalClasses]), [[0, 2], [1, 2], [2, 2]]);
  assert.equal(h.progress.at(-1).totalLessons, 2);
  assert.deepEqual([...new Set(h.progress.map((p) => p.phase))], ['scan', 'lessons', 'students']);
});

for (const kind of ['marks', 'terms', 'replyMarks']) test(`名簿と記録がなくても ${kind} からクラスを見つけ、返事と印を消す`, async () => {
  const h = setup();
  await h.repo.saveMembers('c1', { remove: [sid] });
  await h.mem.remove(`records/c1/l1/${sid}`);
  await h.mem.set(`${kind}/${sid}/c1/l2`, kind === 'terms' ? { t1: '確認用語' } : 1);
  await h.mem.set(`replies/c1/l2/${other}`, { text: '残す返事', updatedAt: 1 });
  await h.mem.set(`replyMarks/${other}/c1/l2`, 1);
  const result = await purgeCohort(h);
  assert.equal(result.students, 2);
  assert.equal(result.files, 0);
  assert.equal(await h.mem.get(`replies/c1/l2/${sid}`), null);
  assert.equal(await h.mem.get(`${kind}/${sid}`), null);
  assert.equal(await h.mem.get(`replyMarks/${sid}`), null);
  assert.deepEqual(await h.mem.get(`replies/c1/l2/${other}`), { text: '残す返事', updatedAt: 1 });
  assert.equal(await h.mem.get(`replyMarks/${other}/c1/l2`), 1);
  assert.equal(await h.mem.get('aiSummaries'), null);
});

test('全員分の印を調べ、消えたクラスは読まず、印のない添付だけの記録も走査して消す', async () => {
  const h = setup();
  await h.repo.saveMembers('c1', { remove: [sid] });
  await h.mem.set('classes/c2', { year: 2027 });
  await h.mem.set('lessons/c2/l1', { createdAt: 1 });
  await h.mem.set('replies/c2/l1/s26-002', { text: '確認用', updatedAt: 1 });
  await h.mem.set('replyMarks/s26-002', { c2: { l1: 1 }, gone: { l1: 1 } });
  const reads = [];
  const repo = { ...h.repo, listLessons: async (cid) => {
    assert.notEqual(cid, 'gone'); reads.push(cid); return h.repo.listLessons(cid);
  } };
  assert.deepEqual(await purgeCohort({ ...h, repo }), { students: 2, files: 2, unknownFiles: 0 });
  assert.deepEqual(reads, ['c2', 'c1']);
  assert.equal(await h.mem.get('replies'), null);
  assert.equal(await h.mem.get('replyMarks'), null);
  assert.equal(await h.mem.get(`records/c1/l1/${sid}`), null);
});

test('印を読み取れなければ削除を進めず、記録と台帳を残す', async () => {
  const h = setup();
  const repo = { ...h.repo, listStudentIndex: async () => { throw new NetError('network'); } };
  await assert.rejects(purgeCohort({ ...h, repo }), { code: 'network' });
  assert.ok(await h.mem.get(`records/c1/l1/${sid}`));
  assert.ok(await h.mem.get(`students/${sid}`));
  assert.equal(await h.mem.get(`removed/${sid}/purging`), true);
  assert.equal(h.calls.length, 1);
});
