// ログイン（ID かメールアドレスか）と、保存してあるログインから今だれなのかを決めることを、代役で確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signIn, resolveSession } from '../js/session.js';
import { NetError } from '../js/errors.js';
import { readFileSync } from 'node:fs';
import { createMemoryNet } from '../js/dev/memory-net.js';
import { installDom, byClass, settle } from './helpers/picture-dom.js';

const DOMAIN = 'jugyolog.invalid';

test('main: 対応が消えて none になったら、取り置きと読み直しの予約を消す', async (t) => {
  const jobs = new Map(); let serial = 0;
  const timers = { setTimeout(fn) { jobs.set(++serial, fn); return serial; }, clearTimeout(id) { jobs.delete(id); } };
  const h = await startApp(t, { offline: false, timers });
  await h.store.put('u1', 'records/c1/l1/s26-001', { memo: '確認用の記録' });
  h.ctx.offline.touch('c1', 'l1', 's26-001');
  assert.equal(jobs.size, 1);
  const pending = [...jobs.values()];
  await h.backend.net.remove('accounts/u1');
  window.fire('online'); await settle();
  assert.equal(h.ctx.session.role, 'none');
  assert.equal(jobs.size, 0);
  assert.equal(await h.store.get('u1', 'records/c1/l1/s26-001'), null);
  h.backend.net.get = async () => assert.fail('対応が消えたあとには読み直さない');
  for (const fn of pending) await fn();
  assert.equal(await h.store.get('u1', 'records/c1/l1/s26-001'), null);
});

// main の入口も実行する。画面モジュールの読みこみだけを、入力欄を持つ代役に置きかえる。
async function startApp(t, { offline = true, timers = { setTimeout, clearTimeout } } = {}) {
  const dom = installDom();
  const data = new Map([['jugyolog:session', JSON.stringify({ uid: 'u1', studentId: 's26-001' })]]);
  const storage = {
    getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key),
    get length() { return data.size; }, key: (i) => [...data.keys()][i],
  };
  const app = document.createElement('div'); app.setAttribute('id', 'app'); document.body.append(app);
  const banner = document.createElement('div'); banner.setAttribute('id', 'banner'); document.body.append(banner);
  window.localStorage = storage; window.setTimeout = timers.setTimeout; window.clearTimeout = timers.clearTimeout;
  const h = { data, storage, app, banner, user: { uid: 'u1' }, offline, time: 1000, restores: 0, mounts: 0, registration: [] };
  const net = createMemoryNet({ initial: { accounts: { u1: 's26-001' } } });
  const auth = {
    get user() { return h.user; },
    async restore() { h.restores++; if (h.offline) throw new NetError('network'); return h.user; },
    async signOut() { h.user = null; },
  };
  h.backend = { net, auth, gas: { call: async () => {} }, reset: async () => {} };
  const location = { hostname: 'localhost', search: '?demo=1&sw=1', hash: '#/', reload() {} };
  const history = { replaceState: (_, __, hash) => { location.hash = hash; }, pushState: (_, __, hash) => { location.hash = hash; } };
  const navigator = { serviceWorker: { register: async (url) => { h.registration.push(url); throw new Error('登録できない'); } } };
  let source = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  const deps = {};
  for (const match of source.matchAll(/^import \{ ([^}]+) \} from '([^']+)';$/gm)) {
    const module = await import(new URL(match[2], new URL('../js/main.js', import.meta.url)));
    for (const name of match[1].split(', ')) deps[name] = module[name];
  }
  source = source.replace(/^import .*;\r?\n/gm, '').replace('return await import(`./views/${file}.js`);', 'return testView;');
  deps.createDemoBackend = () => h.backend;
  const createStore = deps.createOfflineStore;
  deps.createOfflineStore = (args) => { h.store = createStore(args); assert.equal(args.caches, undefined); return h.store; };
  const testView = { mount(root, ctx) {
    h.mounts++; h.ctx = ctx;
    const input = document.createElement('textarea'); root.replaceChildren(input); h.input = input;
    return () => {};
  } };
  new Function(...Object.keys(deps), 'testView', 'location', 'history', 'navigator', 'Date', source)(
    ...Object.values(deps), testView, location, history, navigator, { now: () => h.time });
  t.after(() => dom.restore());
  await settle();
  return h;
}

test('main: オフラインの生徒は 30 秒未満では再確認せず、境界で確かめ直す', async (t) => {
  const h = await startApp(t);
  assert.equal(h.restores, 1); assert.equal(h.ctx.session.offline, true);
  assert.deepEqual(h.registration, ['sw.js?v=dev']);
  assert.equal(byClass(h.banner, 'demo-banner').length, 1);
  assert.equal(byClass(h.banner, 'offline-banner').length, 1);
  assert.equal(byClass(h.banner, 'offline-banner')[0].getAttribute('role'), 'status');
  h.time += 29999; await h.ctx.navigate('home');
  assert.equal(h.restores, 1); assert.equal(byClass(h.banner, 'offline-banner').length, 1);
  h.time++; await h.ctx.navigate('home');
  assert.equal(h.restores, 2);
  h.time++; await h.ctx.navigate('home'); assert.equal(h.restores, 2);
});

test('main: online で同じ生徒を確認したら入力を保ち、帯だけ消す', async (t) => {
  const h = await startApp(t); const input = h.input; const mounts = h.mounts;
  input.value = '書きかけの見本'; h.offline = false;
  window.fire('online'); await settle();
  assert.equal(h.restores, 2); assert.equal(h.mounts, mounts); assert.equal(h.input, input);
  assert.equal(input.value, '書きかけの見本'); assert.equal(h.ctx.offline.down, false);
  assert.equal(byClass(h.banner, 'offline-banner').length, 0);
  assert.equal(byClass(h.banner, 'demo-banner').length, 1);
  assert.deepEqual(JSON.parse(h.data.get('jugyolog:session')), { uid: 'u1', studentId: 's26-001' });
});

test('main: 再確認も通信失敗なら同じ生徒の画面を保ち、先生・none になったら描き直す', async (t) => {
  const h = await startApp(t); const mounts = h.mounts;
  window.fire('online'); await settle(); assert.equal(h.mounts, mounts); assert.equal(h.ctx.offline.down, true);
  h.offline = false; await h.backend.net.set('teacherList/u1', true);
  window.fire('online'); await settle();
  assert.equal(h.ctx.session.role, 'teacher'); assert.ok(h.mounts > mounts); assert.equal(h.data.has('jugyolog:session'), false);
  h.user = null; window.fire('online'); await settle(); assert.equal(h.ctx.session.role, 'none');
});

test('main: ログアウトで全 scope・控え・下書きを消し、古い読み取りの応答で戻さない', async (t) => {
  const h = await startApp(t, { offline: false });
  h.ctx.drafts.put('s26-001', 'c1', 'l1', { memo: '見本' }, 1);
  h.ctx.inkDrafts.put('s26-001', 'c1', 'l1', 'memo', { ink: { v: 1, h: 400, s: [] }, editedAt: 1, key: 'test-key' });
  await h.store.put('u1', 'p', 1); await h.store.put('u2', 'p', 2);
  let release;
  h.backend.net.get = () => new Promise((resolve) => { release = resolve; });
  const pending = h.ctx.repo.getLesson('c1', 'l1');
  await h.ctx.signOutAll(); release({ title: '遅い応答' }); await pending;
  assert.equal(await h.store.get('u1', 'lessons/c1/l1'), null);
  assert.equal(await h.store.get('u1', 'p'), null); assert.equal(await h.store.get('u2', 'p'), null);
  assert.equal(h.data.has('jugyolog:session'), false); assert.equal(h.user, null);
  assert.equal(h.ctx.drafts.list('s26-001').length, 0); assert.equal(h.ctx.inkDrafts.list('s26-001').length, 0);
});

test('main: 再確認中にログアウトしても、控え・生徒の session を復活させない', async (t) => {
  const h = await startApp(t, { offline: false }); let release;
  const get = h.backend.net.get;
  h.backend.net.get = (path, opts) => path === 'accounts/u1' ? new Promise((resolve) => { release = resolve; }) : get(path, opts);
  window.fire('online'); await settle(); assert.equal(typeof release, 'function');
  await h.ctx.signOutAll(); release('s26-001'); await settle();
  assert.equal(h.data.has('jugyolog:session'), false);
  await h.ctx.navigate('login'); assert.equal(h.ctx.session.role, 'none');
});

test('main: liveRepo は生の値を読み、update・set・remove は取り置きを消す', async (t) => {
  const h = await startApp(t, { offline: false });
  const { repo, liveRepo } = h.ctx;
  const recordPath = 'records/c1/l1/s26-001';
  const termPath = 'terms/s26-001/c1/l1';
  await repo.getRecord('c1', 'l1', 's26-001');
  assert.deepEqual(await h.store.get('u1', recordPath), { value: null });
  const get = h.backend.net.get;
  h.backend.net.get = async () => { throw new NetError('network'); };
  assert.equal(await repo.getRecord('c1', 'l1', 's26-001'), null);
  await assert.rejects(liveRepo.getRecord('c1', 'l1', 's26-001'), (e) => e.code === 'network');
  h.backend.net.get = get;
  await liveRepo.saveRecord('c1', 'l1', 's26-001', { memo: '見本' }, 20);
  assert.equal(await h.store.get('u1', recordPath), null);
  assert.equal((await liveRepo.getRecord('c1', 'l1', 's26-001')).memo, '見本');
  assert.equal(await h.store.get('u1', recordPath), null, 'liveRepo の読み取りは取り置かない');
  await h.store.put('u1', termPath, {});
  await liveRepo.setMyTerm('s26-001', 'c1', 'l1', 't1', '見本');
  assert.equal(await h.store.get('u1', termPath), null);
  await h.store.put('u1', termPath, { t1: '見本' });
  await liveRepo.removeMyTerm('s26-001', 'c1', 'l1', 't1');
  assert.equal(await h.store.get('u1', termPath), null);
});

test('main: touch は画面移動後も取り置き、signOutAll は待っている読み直しを全部止める', async (t) => {
  const jobs = new Map(); let serial = 0;
  const timers = {
    setTimeout(fn, ms) { jobs.set(++serial, { fn, ms }); return serial; },
    clearTimeout(id) { jobs.delete(id); },
  };
  const h = await startApp(t, { offline: false, timers });
  await h.ctx.liveRepo.saveRecord('c1', 'l1', 's26-001', { memo: '読み直す見本' }, 20);
  h.ctx.offline.touch('c1', 'l1', 's26-001');
  await h.ctx.navigate('home');
  assert.equal(jobs.size, 1);
  const [[id, job]] = jobs; jobs.delete(id);
  assert.equal(job.ms, 3000); await job.fn();
  assert.equal((await h.store.get('u1', 'records/c1/l1/s26-001')).value.memo, '読み直す見本');
  h.ctx.offline.touch('c1', 'l1', 's26-001'); h.ctx.offline.touch('c1', 'l2', 's26-001');
  assert.equal(jobs.size, 2);
  const callbacks = [...jobs.values()];
  await h.ctx.signOutAll(); assert.equal(jobs.size, 0);
  h.backend.net.get = async () => assert.fail('ログアウト後は読み直さない');
  for (const pending of callbacks) await pending.fn();
  assert.equal(await h.store.get('u1', 'records/c1/l1/s26-001'), null);
});

test('main: ログアウトして同じ uid で入り直しても、前の応答を取り置かない', async (t) => {
  const h = await startApp(t, { offline: false }); let release;
  const get = h.backend.net.get;
  h.backend.net.get = (path, opts) => path === 'records/c1/l1/s26-001'
    ? new Promise((resolve) => { release = resolve; }) : get(path, opts);
  const reading = h.ctx.repo.getRecord('c1', 'l1', 's26-001');
  await h.ctx.signOutAll();
  h.user = { uid: 'u1' }; await h.ctx.navigate('home');
  assert.equal(h.ctx.session.uid, 'u1');
  release({ memo: '前のログインの値', updatedAt: 10 }); await reading;
  assert.equal(await h.store.get('u1', 'records/c1/l1/s26-001'), null);
});

test('resolveSession: 確かめた生徒だけを memo に残し、先生・none なら消す', async () => {
  for (const role of ['student', 'teacher', 'none', 'signed-out']) {
    const calls = [];
    const memo = { put: (value) => calls.push(value), clear: () => calls.push('clear') };
    const auth = fakeAuth({ onRestore: () => role === 'signed-out' ? null : { uid: 'u1' } });
    const repo = { isTeacher: async () => role === 'teacher', getMyStudentId: async () => role === 'student' ? 's26-001' : null };
    await resolveSession({ auth, repo, memo });
    assert.deepEqual(calls, role === 'student' ? [{ uid: 'u1', studentId: 's26-001' }] : ['clear']);
  }
});

test('resolveSession: restore・repo の通信失敗で、控えと現在の uid が一致する場合だけ生徒で入る', async () => {
  for (const stage of ['restore', 'teacher', 'student']) {
    for (const uid of ['u1', 'different', null]) {
      const auth = fakeAuth({ onRestore: () => stage === 'restore' ? new NetError('network') : { uid: 'u1' } });
      auth.user = uid ? { uid } : null;
      const repo = {
        isTeacher: async () => { if (stage === 'teacher') throw new NetError('network'); return false; },
        getMyStudentId: async () => { throw new NetError('network'); },
      };
      const memo = { get: () => ({ uid: 'u1', studentId: 's26-001' }) };
      assert.deepEqual(await resolveSession({ auth, repo, memo }), uid === 'u1'
        ? { role: 'student', uid, studentId: 's26-001', offline: true } : { role: 'offline' });
    }
  }
});

test('resolveSession: denied は控えを使わず、消して none にする', async () => {
  const auth = fakeAuth({ onRestore: () => ({ uid: 'u1' }) }); auth.user = { uid: 'u1' };
  let cleared = false;
  const memo = { get: () => ({ uid: 'u1', studentId: 's26-001' }), clear: () => { cleared = true; } };
  assert.deepEqual(await resolveSession({ auth, repo: { isTeacher: async () => { throw new NetError('denied'); } }, memo }), { role: 'none' });
  assert.equal(cleared, true);
});

// auth の代役。onSignIn(email, password) の戻り値が signIn の結果（Error を返すと投げる）。
// restore は onRestore() の戻り値（Error を返すと投げる）。signOut の回数を数える
function fakeAuth({ onSignIn = (email) => ({ uid: 'u1', email }), onRestore = () => null } = {}) {
  const a = {
    signOuts: 0,
    signInCalls: [],
    async signIn(email, password) {
      a.signInCalls.push([email, password]);
      const r = await onSignIn(email, password);
      if (r instanceof Error) throw r;
      a.user = r; // 本物と同じく、ログインした人を覚える
      return r;
    },
    async restore() {
      const r = await onRestore();
      if (r instanceof Error) throw r;
      return r;
    },
    user: null,
    signOut() { a.signOuts += 1; a.user = null; },
  };
  return a;
}

// 呼ばれたら失敗にする関数（呼ばれてはいけないところで使う）
const never = (name) => async () => { throw new Error(`${name} を呼んではいけない`); };

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (e) => {
    assert.ok(e instanceof NetError, `NetError のはず: ${e}`);
    assert.equal(e.code, code);
    return true;
  });
}

// ---- signIn: 生徒 ----

test('生徒: ID から何回目かを読み、そのメールアドレスでログインする', async () => {
  const calls = [];
  const auth = fakeAuth({ onSignIn: (email) => { calls.push(email); return { uid: 'u2', email }; } });
  const repo = { getGeneration: async () => 2, getMyStudentId: async () => 's26-017', isTeacher: async () => false };
  const r = await signIn({ input: ' Ｓ26-017 ', password: 'pw', auth, repo, domain: 'jugyolog.invalid' });
  assert.deepEqual(r, { role: 'student', studentId: 's26-017' });
  assert.deepEqual(calls, ['s26-017.g2@jugyolog.invalid']);
});

test('生徒: 全角の英数字とハイフン・大文字でも、同じ ID として読む', async () => {
  const seen = [];
  const auth = fakeAuth({ onSignIn: (email) => ({ uid: 'u2', email }) });
  const repo = {
    getGeneration: async (id) => { seen.push(id); return 1; },
    getMyStudentId: async () => 's26-017',
    isTeacher: never('isTeacher'),
  };
  for (const input of ['ｓ２６－０１７', 'S26-017', '  s26-017\t']) {
    const r = await signIn({ input, password: 'pw', auth, repo, domain: DOMAIN });
    assert.deepEqual(r, { role: 'student', studentId: 's26-017' }, input);
  }
  assert.deepEqual(seen, ['s26-017', 's26-017', 's26-017']);
  assert.deepEqual(auth.signInCalls.map(([e]) => e), Array(3).fill('s26-017.g1@jugyolog.invalid'));
  assert.equal(auth.signInCalls[0][1], 'pw');
});

test('生徒: 形の違う ID は、通信をせずに bad-credentials', async () => {
  const auth = fakeAuth({ onSignIn: never('signIn') });
  const repo = { getGeneration: never('getGeneration'), getMyStudentId: never('getMyStudentId'), isTeacher: never('isTeacher') };
  for (const input of ['abc', '', '   ', 's26-17', 's26-0170', 's2a-017']) {
    await rejectsCode(signIn({ input, password: 'pw', auth, repo, domain: DOMAIN }), 'bad-credentials');
  }
  assert.equal(auth.signInCalls.length, 0);
});

test('生徒: 発行されていない ID（何回目かが null）は bad-credentials で、ログインを試さない', async () => {
  const auth = fakeAuth({ onSignIn: never('signIn') });
  const repo = { getGeneration: async () => null, getMyStudentId: never('getMyStudentId'), isTeacher: never('isTeacher') };
  await rejectsCode(signIn({ input: 's26-099', password: 'pw', auth, repo, domain: DOMAIN }), 'bad-credentials');
  assert.equal(auth.signInCalls.length, 0);
});

test('生徒: パスワードが違う（auth が bad-credentials）はそのまま伝える', async () => {
  const auth = fakeAuth({ onSignIn: () => new NetError('bad-credentials') });
  const repo = { getGeneration: async () => 1, getMyStudentId: never('getMyStudentId'), isTeacher: never('isTeacher') };
  await rejectsCode(signIn({ input: 's26-017', password: 'x', auth, repo, domain: DOMAIN }), 'bad-credentials');
});

test('生徒: 何回目かを読めない（network）はそのまま伝える', async () => {
  const auth = fakeAuth({ onSignIn: never('signIn') });
  const repo = { getGeneration: async () => { throw new NetError('network'); }, getMyStudentId: never('getMyStudentId'), isTeacher: never('isTeacher') };
  await rejectsCode(signIn({ input: 's26-017', password: 'x', auth, repo, domain: DOMAIN }), 'network');
});

test('生徒: 出し直したあとの古いアカウント（対応が null）は、ログアウトしてから bad-credentials', async () => {
  const order = [];
  const auth = fakeAuth({ onSignIn: (email) => ({ uid: 'old', email }) });
  auth.signOut = () => { order.push('signOut'); };
  const repo = { getGeneration: async () => 1, getMyStudentId: async () => { order.push('getMyStudentId'); return null; }, isTeacher: never('isTeacher') };
  await assert.rejects(
    signIn({ input: 's26-017', password: 'pw', auth, repo, domain: DOMAIN }),
    (e) => { order.push('rejected'); return e instanceof NetError && e.code === 'bad-credentials'; },
  );
  assert.deepEqual(order, ['getMyStudentId', 'signOut', 'rejected']);
});

test('生徒: ログインできても、対応する生徒 ID が入力と違えば、ログアウトしてから bad-credentials', async () => {
  const auth = fakeAuth({ onSignIn: (email) => ({ uid: 'u9', email }) });
  const repo = { getGeneration: async () => 1, getMyStudentId: async () => 's26-018', isTeacher: never('isTeacher') };
  await rejectsCode(signIn({ input: 's26-017', password: 'pw', auth, repo, domain: DOMAIN }), 'bad-credentials');
  assert.equal(auth.signOuts, 1);
});

test('生徒: ログインのあと対応を読めない（network）は、ログアウトしてから network', async () => {
  const auth = fakeAuth({ onSignIn: (email) => ({ uid: 'u9', email }) });
  const repo = { getGeneration: async () => 1, getMyStudentId: async () => { throw new NetError('network'); }, isTeacher: never('isTeacher') };
  await rejectsCode(signIn({ input: 's26-017', password: 'pw', auth, repo, domain: DOMAIN }), 'network');
  assert.equal(auth.signOuts, 1);
});

// ---- signIn: 先生 ----

test('先生: @ を含む入力は、そのメールアドレスでログインし、先生かを確かめる', async () => {
  const seen = [];
  const auth = fakeAuth({ onSignIn: (email) => ({ uid: 't1', email }) });
  const repo = { getGeneration: never('getGeneration'), getMyStudentId: never('getMyStudentId'), isTeacher: async (uid) => { seen.push(uid); return true; } };
  const r = await signIn({ input: '  Teacher@School.example ', password: 'secret', auth, repo, domain: DOMAIN });
  assert.deepEqual(r, { role: 'teacher' });
  assert.deepEqual(auth.signInCalls, [['Teacher@School.example', 'secret']]);
  assert.deepEqual(seen, ['t1']);
  assert.equal(auth.signOuts, 0);
});

test('先生: 先生として登録されていなければ、ログアウトしてから not-teacher', async () => {
  const auth = fakeAuth({ onSignIn: (email) => ({ uid: 'x1', email }) });
  const repo = { getGeneration: never('getGeneration'), getMyStudentId: never('getMyStudentId'), isTeacher: async () => false };
  await rejectsCode(signIn({ input: 'someone@example.com', password: 'pw', auth, repo, domain: DOMAIN }), 'not-teacher');
  assert.equal(auth.signOuts, 1);
});

test('先生: 登録を確かめられない（network）は、ログアウトしてから network', async () => {
  const auth = fakeAuth({ onSignIn: (email) => ({ uid: 't1', email }) });
  const repo = { getGeneration: never('getGeneration'), getMyStudentId: never('getMyStudentId'), isTeacher: async () => { throw new NetError('network'); } };
  await rejectsCode(signIn({ input: 't@example.com', password: 'pw', auth, repo, domain: DOMAIN }), 'network');
  assert.equal(auth.signOuts, 1);
});

test('先生: パスワードが違う（auth が bad-credentials）はそのまま伝え、登録を読まない', async () => {
  const auth = fakeAuth({ onSignIn: () => new NetError('bad-credentials') });
  const repo = { getGeneration: never('getGeneration'), getMyStudentId: never('getMyStudentId'), isTeacher: never('isTeacher') };
  await rejectsCode(signIn({ input: 't@example.com', password: 'x', auth, repo, domain: DOMAIN }), 'bad-credentials');
});

// ---- resolveSession ----

test('resolveSession: 保存したログインが無ければ none', async () => {
  const auth = fakeAuth({ onRestore: () => null });
  const repo = { isTeacher: never('isTeacher'), getMyStudentId: never('getMyStudentId') };
  assert.deepEqual(await resolveSession({ auth, repo }), { role: 'none' });
  assert.equal(auth.signOuts, 0);
});

test('resolveSession: 先生なら teacher', async () => {
  const auth = fakeAuth({ onRestore: () => ({ uid: 't1', email: 't@example.com' }) });
  const repo = { isTeacher: async (uid) => uid === 't1', getMyStudentId: async () => null };
  assert.deepEqual(await resolveSession({ auth, repo }), { role: 'teacher', uid: 't1' });
});

test('resolveSession: 生徒なら student（生徒 ID つき）', async () => {
  const auth = fakeAuth({ onRestore: () => ({ uid: 'u2', email: 's26-017.g1@jugyolog.invalid' }) });
  const repo = { isTeacher: async () => false, getMyStudentId: async (uid) => (uid === 'u2' ? 's26-017' : null) };
  assert.deepEqual(await resolveSession({ auth, repo }), { role: 'student', uid: 'u2', studentId: 's26-017' });
  assert.equal(auth.signOuts, 0);
});

test('resolveSession: 先生でも生徒でもない（出し直した古いアカウントなど）は、ログアウトして none', async () => {
  const auth = fakeAuth({ onRestore: () => ({ uid: 'old' }) });
  const repo = { isTeacher: async () => false, getMyStudentId: async () => null };
  assert.deepEqual(await resolveSession({ auth, repo }), { role: 'none' });
  assert.equal(auth.signOuts, 1);
});

test('resolveSession: restore が network なら offline（ログアウトしない）', async () => {
  const auth = fakeAuth({ onRestore: () => new NetError('network') });
  const repo = { isTeacher: never('isTeacher'), getMyStudentId: never('getMyStudentId') };
  assert.deepEqual(await resolveSession({ auth, repo }), { role: 'offline' });
  assert.equal(auth.signOuts, 0);
});

test('resolveSession: repo が network なら offline（ログアウトしない）', async () => {
  const auth = fakeAuth({ onRestore: () => ({ uid: 'u2' }) });
  const repo1 = { isTeacher: async () => { throw new NetError('network'); }, getMyStudentId: async () => 's26-017' };
  assert.deepEqual(await resolveSession({ auth, repo: repo1 }), { role: 'offline' });
  const repo2 = { isTeacher: async () => false, getMyStudentId: async () => { throw new NetError('network'); } };
  assert.deepEqual(await resolveSession({ auth, repo: repo2 }), { role: 'offline' });
  assert.equal(auth.signOuts, 0);
});

// ---- 離れた画面のログイン（isCurrent が false）は、あとから入った人のログインをこわさない ----

test('生徒: 何回目かを待っている間に画面を離れたら、ログインの通信を送らない', async () => {
  let alive = true;
  const auth = fakeAuth({ onSignIn: never('signIn') });
  const repo = { getGeneration: async () => { alive = false; return 1; }, getMyStudentId: never('getMyStudentId'), isTeacher: never('isTeacher') };
  await rejectsCode(signIn({ input: 's26-017', password: 'pw', auth, repo, domain: DOMAIN, isCurrent: () => alive }), 'auth');
  assert.equal(auth.signInCalls.length, 0);
  assert.equal(auth.signOuts, 0);
});

test('ログインの通信の間に画面を離れたら、自分が入れた分だけ外す', async () => {
  let alive = true;
  const auth = fakeAuth({ onSignIn: (email) => { alive = false; return { uid: 'uA', email }; } });
  const repo = { getGeneration: async () => 1, getMyStudentId: never('getMyStudentId'), isTeacher: never('isTeacher') };
  await rejectsCode(signIn({ input: 's26-017', password: 'pw', auth, repo, domain: DOMAIN, isCurrent: () => alive }), 'auth');
  assert.equal(auth.signOuts, 1);
});

test('確認を待っている間に別の人がログインしていたら、その人を外さない', async () => {
  let alive = true;
  const auth = fakeAuth({ onSignIn: (email) => ({ uid: 'uA', email }) });
  const repo = {
    getGeneration: async () => 1,
    // 確認の間に画面が替わり、別の人（uB）がログインした
    getMyStudentId: async () => { alive = false; auth.user = { uid: 'uB' }; return 's26-017'; },
    isTeacher: never('isTeacher'),
  };
  await rejectsCode(signIn({ input: 's26-017', password: 'pw', auth, repo, domain: DOMAIN, isCurrent: () => alive }), 'auth');
  assert.equal(auth.signOuts, 0);
  assert.deepEqual(auth.user, { uid: 'uB' });
});

test('先生: 確認の失敗でも、別の人に替わっていたら外さない', async () => {
  const auth = fakeAuth({ onSignIn: (email) => ({ uid: 'uT', email }) });
  const repo = { isTeacher: async () => { auth.user = { uid: 'uB' }; throw new NetError('network'); } };
  await rejectsCode(signIn({ input: 't@example.com', password: 'pw', auth, repo, domain: DOMAIN }), 'network');
  assert.equal(auth.signOuts, 0);
});

test('同じ人がログインし直したあと、古い試みの確認が終わっても、新しいログインを外さない（成功・失敗の両方）', async () => {
  for (const mode of ['ok', 'fail']) {
    const auth = fakeAuth({ onSignIn: (email) => ({ uid: 'uSame', email }) });
    let aliveA = true;
    let releaseA;
    const gateA = new Promise((r) => { releaseA = r; });
    let first = true;
    const repo = {
      getGeneration: async () => 1,
      getMyStudentId: async () => {
        if (first) { first = false; await gateA; if (mode === 'fail') throw new NetError('network'); }
        return 's26-017';
      },
      isTeacher: never('isTeacher'),
    };
    // A: 確認（getMyStudentId）で待つ
    const a = signIn({ input: 's26-017', password: 'pw', auth, repo, domain: DOMAIN, isCurrent: () => aliveA });
    await new Promise((r) => setTimeout(r, 0));
    // 画面を離れ、同じ人が B でログインし直す
    aliveA = false;
    const b = await signIn({ input: 's26-017', password: 'pw', auth, repo, domain: DOMAIN });
    assert.deepEqual(b, { role: 'student', studentId: 's26-017' });
    // A の確認が終わる
    releaseA();
    await assert.rejects(a);
    assert.equal(auth.signOuts, 0, `${mode}: 新しいログインを外してはいけない`);
    assert.equal(auth.user && auth.user.uid, 'uSame');
  }
});
