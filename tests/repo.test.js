// リポジトリの土台（開発ルール、道具、設定）がそろっているかと、
// データベースの出し入れ（js/repo.js・js/dev/memory-net.js）を確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRepo } from '../js/repo.js';
import { createMemoryNet } from '../js/dev/memory-net.js';

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
