// 練習用 GAS・repo と DOM の代役で、先生の画面をつないで確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDemoBackend, DEMO_TEACHER_UID } from '../js/dev/demo.js';
import { createRepo } from '../js/repo.js';
import { createDrafts } from '../js/drafts.js';
import { createInkDrafts } from '../js/ink-drafts.js';
import { createRecordQueue } from '../js/record-queue.js';
import { createGas } from '../js/gas.js';
import { createFiles } from '../js/files.js';
import { requestAiSummary } from '../js/ai-summary-flow.js';
import { mount as mountReview } from '../js/views/teacher-review.js';
import { mount as mountRecord } from '../js/views/teacher-record.js';
import { mount as mountStudent } from '../js/views/student-lesson.js';
import { mount as mountHome } from '../js/views/student-home.js';
import { installDom, all, byClass, buttons, settle } from './helpers/picture-dom.js';

const ids = { classId: 'AiClass', lessonId: 'AiLesson', studentId: 's26-001' };
const views = { 't-review': mountReview, 't-record': mountRecord, lesson: mountStudent, home: mountHome };
const box = (h) => byClass(h.root, 'ai-summary-box')[0];
const confirm = (label = 'まとめる') => buttons(byClass(document.body, 'confirm')[0], label)[0].click();
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

async function setup(t) {
  const dom = installDom(); const createElement = dom.createElement;
  dom.createElement = (tag) => { const node = createElement(tag); node.select = () => {}; return node; };
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  const items = new Map();
  const storage = { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => items.set(key, value),
    removeItem: (key) => items.delete(key), get length() { return items.size; }, key: (i) => [...items.keys()][i] };
  let time = new Date(2026, 10, 18, 9, 5).getTime(); const now = () => ++time;
  const backend = createDemoBackend({ storage, now, random: () => 0.25 }); const repo = createRepo(backend.net);
  await backend.auth.signIn('teacher@example.test', '');
  await repo.createClass(ids.classId, { year: 2026, name: 'AI 確認用' }, now());
  await repo.createClass('OtherClass', { year: 2026, name: '別の確認用' }, now());
  await repo.createLessons([{ ...ids, date: '2026-11-18', title: 'AI 確認用授業' },
    { ...ids, lessonId: 'NextLesson', date: '2026-11-17', title: '次の確認用授業' },
    { classId: 'OtherClass', lessonId: 'OtherLesson', date: '2026-11-18', title: '別の授業' }], now());
  await repo.saveMembers(ids.classId, { set: { [ids.studentId]: 1, 's26-002': 2 } });
  await repo.saveRecord(ids.classId, ids.lessonId, ids.studentId, { level: 1, question: '光の進み方の見本文' }, now());
  await repo.saveRecord(ids.classId, ids.lessonId, 's26-003', { memo: '名簿外の見本文' }, now());
  await repo.setReply(ids.classId, ids.lessonId, 's26-004', { seen: true }, now());
  const root = document.createElement('main'); document.body.append(root);
  const h = { root, repo, backend, now, writes: [], reads: [], requests: 0, gate: null, destroy: null, route: null };
  const get = backend.net.get;
  backend.net.get = async (path) => {
    if (path === `teacherList/${DEMO_TEACHER_UID}`) { h.requests++; if (h.gate) await h.gate.promise; }
    return get(path);
  };
  const read = repo.getAiSummary, write = repo.setAiSummary;
  repo.getAiSummary = (...args) => { h.reads.push(args); return read(...args); };
  repo.setAiSummary = (...args) => { h.writes.push(args); return write(...args); };
  h.ctx = { repo, net: backend.net, auth: backend.auth, demo: true, now, random: () => 0.25,
    ai: { summarize: (request) => requestAiSummary({ gas: backend.gas, request }) },
    session: { studentId: ids.studentId }, drafts: createDrafts({ storage }), inkDrafts: createInkDrafts({ storage }),
    setLeaveGuard: () => {}, recordQueue: createRecordQueue(), timers: { setTimeout, clearTimeout },
    thumbs: { load: async () => ({}) }, files: { loadInk: async () => { throw new Error('確認用'); } },
    navigate: async (name, params) => { h.open(name, params); return 'moved'; } };
  h.open = (name = 't-review', params = ids) => {
    h.destroy?.(); h.destroy = null; root.replaceChildren(); h.route = { name, params };
    if (views[name]) h.destroy = views[name](root, { ...h.ctx, params });
  };
  h.select = async (id, value) => { const select = document.getElementById(id); select.value = value; select.fire('change'); await settle(); };
  h.start = async (label = 'AI でまとめる') => { buttons(box(h), label)[0].click(); confirm(); await settle(); };
  t.after(() => { h.destroy?.(); root.remove(); dom.restore();
    if (nav) Object.defineProperty(globalThis, 'navigator', nav); else delete globalThis.navigator; });
  return h;
}

test('練習モード: 自動まとめの下・一覧の上。文字の人数に返事だけの生徒は含めない', async (t) => {
  const h = await setup(t); h.open(); await settle();
  const area = byClass(h.root, 'review-summary')[0];
  assert.equal(area.children[0], byClass(h.root, 'summary-box')[0]); assert.equal(area.children[1], box(h));
  assert.equal(byClass(h.root, 'review-columns')[0].children[2], byClass(h.root, 'review-records')[0]);
  assert.match(box(h).textContent, /文字で書いた 2 人分/); assert.equal(byClass(h.root, 'review-row').length, 4);
  assert.equal(h.requests, 0); assert.equal(h.reads.length, 1);
  await h.start(); assert.equal(h.requests, 1); assert.equal(h.writes.length, 1);
  assert.match(box(h).textContent, /練習モードの見本です/);
  const stored = await h.repo.getAiSummary(ids.classId, ids.lessonId);
  assert.ok(stored.overview); assert.equal(stored.basedOn.count, 2);
  assert.deepEqual(stored.labels, { '1番': ids.studentId, '名簿外1': 's26-003' });
  h.open(); await settle(); assert.match(box(h).textContent, /練習モードの見本です/); assert.equal(h.requests, 1);
});

test('画面は GAS の接続を作る部品を読みこまない', () => {
  const screen = readFileSync(new URL('../js/views/teacher-review.js', import.meta.url), 'utf8');
  assert.doesNotMatch(screen, /\b(createGas|gasEndpoint|GAS|createDemoGas|requestAiSummary)\b/);
});

test('ctx.ai がない古い呼び出しでは案内を出し、生成ボタンを出さない', async (t) => {
  const h = await setup(t); delete h.ctx.ai; h.open(); await settle();
  assert.match(box(h).textContent, /この画面では、AI のまとめを使えません。/);
  assert.equal(buttons(box(h), 'AI でまとめる').length, 0);
  assert.equal(h.requests, 0); assert.equal(h.writes.length, 0);
  assert.equal(byClass(h.root, 'review-row').length, 4);
});

test('保存後に出席番号を入れ替えて開き直しても、元の生徒の記録へ移る', async (t) => {
  const h = await setup(t); h.open(); await settle(); await h.start();
  await h.repo.saveMembers(ids.classId, { set: { [ids.studentId]: 2, 's26-002': 1 } });
  h.open(); await settle(); buttons(box(h), '1 番')[0].click(); await settle();
  assert.equal(h.route.params.studentId, ids.studentId);
  assert.match(h.root.textContent, /光の進み方の見本文/);
});

test('名簿外の並び順が変わっても、保存した呼び名は元の生徒を開く', async (t) => {
  const h = await setup(t);
  await h.repo.saveRecord(ids.classId, ids.lessonId, 's26-003', { question: '名簿外の見本文' }, h.now());
  h.open(); await settle(); await h.start();
  await h.backend.net.set(`members/${ids.classId}/${ids.studentId}`, null);
  h.open(); await settle(); buttons(box(h), '名簿外1')[0].click(); await settle();
  assert.equal(h.route.params.studentId, 's26-003');
  assert.match(h.root.textContent, /名簿外の見本文/);
});

test('名簿から外れて返事だけが残る生徒もリンクにし、一覧から消えたら文字だけ', async (t) => {
  const h = await setup(t); h.open(); await settle(); await h.start();
  await h.repo.setReply(ids.classId, ids.lessonId, ids.studentId, { seen: true }, h.now());
  await h.backend.net.set(`members/${ids.classId}/${ids.studentId}`, null);
  await h.backend.net.set(`records/${ids.classId}/${ids.lessonId}/${ids.studentId}`, null);
  h.open(); await settle(); buttons(box(h), '1 番')[0].click(); await settle();
  assert.equal(h.route.params.studentId, ids.studentId);
  await h.backend.net.set(`replies/${ids.classId}/${ids.lessonId}/${ids.studentId}`, null);
  h.open(); await settle();
  assert.equal(buttons(box(h), '1 番').length, 0); assert.match(box(h).textContent, /1 番/);
});

test('labels のない古いまとめは、今の番号からリンクを作らない', async (t) => {
  const h = await setup(t);
  await h.repo.saveRecord(ids.classId, ids.lessonId, 's26-003', { question: '名簿外の見本文' }, h.now());
  h.open(); await settle(); await h.start();
  await h.backend.net.set(`aiSummaries/${ids.classId}/${ids.lessonId}/labels`, null);
  h.open(); await settle();
  assert.equal(byClass(box(h), 'ai-summary-person').length, 0);
  assert.match(box(h).textContent, /1 番/); assert.match(box(h).textContent, /名簿外1/);
});

test('練習モード: 読込の遅延・失敗でも一覧・グラフ・自動まとめを出して再試行', async (t) => {
  const h = await setup(t); const gate = deferred(); const read = h.repo.getAiSummary;
  h.repo.getAiSummary = async () => { await gate.promise; throw new Error('確認用'); };
  h.open(); await settle();
  assert.match(box(h).textContent, /読みこんでいます/); assert.equal(buttons(box(h), 'AI でまとめる').length, 0);
  assert.equal(byClass(h.root, 'review-row').length, 4); assert.ok(byClass(h.root, 'review-segment').length);
  assert.ok(byClass(h.root, 'summary-box').length); gate.resolve(); await settle();
  assert.match(box(h).textContent, /AI のまとめを読みこめませんでした。/);
  h.repo.getAiSummary = read; buttons(box(h), 'もう一度')[0].click(); await settle();
  assert.equal(buttons(box(h), 'AI でまとめる')[0].disabled, false);
});

test('練習モード: 生成中も読み直しと授業選択が使え、戻ると作りかけを出す', async (t) => {
  const h = await setup(t); h.gate = deferred(); h.open(); await settle(); await h.start();
  for (const id of ['review-year', 'review-class', 'review-lesson']) assert.equal(document.getElementById(id).disabled, false);
  assert.equal(buttons(h.root, '読み直す')[0].disabled, false);
  buttons(h.root, '読み直す')[0].click(); await settle(); assert.match(box(h).textContent, /AI がまとめています/);
  await h.select('review-lesson', 'NextLesson'); assert.equal(h.route.params.lessonId, 'NextLesson');
  assert.doesNotMatch(box(h).textContent, /AI がまとめています/);
  await h.select('review-lesson', ids.lessonId); assert.match(box(h).textContent, /AI がまとめています/);
  buttons(box(h), 'AI でまとめる')[0].fire('click'); await settle(); assert.equal(h.requests, 1);
  h.gate.resolve(); await settle(); assert.equal(h.writes.length, 1); assert.match(box(h).textContent, /練習モードの見本です/);
});

for (const switchClass of [false, true]) {
  test(`練習モード: ${switchClass ? 'クラス' : '授業'}を変えた後の結果は元の授業に保存し、今の画面に出さない`, async (t) => {
    const h = await setup(t); h.gate = deferred(); h.open(); await settle(); await h.start();
    await h.select(switchClass ? 'review-class' : 'review-lesson', switchClass ? 'OtherClass' : 'NextLesson');
    const before = h.root.textContent; h.gate.resolve(); await settle();
    assert.equal(h.root.textContent, before); assert.equal(h.writes.length, 1);
    assert.deepEqual(h.writes[0].slice(0, 2), [ids.classId, ids.lessonId]);
    if (switchClass) await h.select('review-class', ids.classId); else await h.select('review-lesson', ids.lessonId);
    assert.match(box(h).textContent, /練習モードの見本です/);
  });
}

test('練習モード: 確認中に授業を変えると送らず、確認窓を閉じる', async (t) => {
  const h = await setup(t); h.open(); await settle(); buttons(box(h), 'AI でまとめる')[0].click();
  await h.select('review-lesson', 'NextLesson'); assert.equal(byClass(document.body, 'confirm').length, 0);
  assert.equal(h.requests, 0); await h.select('review-lesson', ids.lessonId);
  assert.equal(buttons(box(h), 'AI でまとめる')[0].disabled, false);
});

for (const afterSwitch of [false, true]) {
  test(`練習モード: ${afterSwitch ? '切替先で' : ''}別ページへ離れた結果は保存しない`, async (t) => {
    const h = await setup(t); h.gate = deferred(); h.open(); await settle(); await h.start();
    if (afterSwitch) await h.select('review-lesson', 'NextLesson');
    h.open('lesson'); await settle(); const before = h.root.textContent;
    h.gate.resolve(); await settle(); assert.equal(h.writes.length, 0); assert.equal(h.root.textContent, before);
    h.open(); await settle(); assert.equal(buttons(box(h), 'AI でまとめる')[0].disabled, false);
  });
}

test('練習モード: 呼び名から個人の記録へ移り、生徒の授業と一覧には出さず読まない', async (t) => {
  const h = await setup(t); h.open(); await settle(); await h.start();
  buttons(box(h), '1 番')[0].click(); await settle();
  assert.equal(h.route.name, 't-record'); assert.equal(h.route.params.studentId, ids.studentId);
  assert.match(h.root.textContent, /光の進み方の見本文/);
  const reads = h.reads.length;
  for (const name of ['lesson', 'home']) {
    h.open(name); await settle(); assert.equal(box(h), undefined);
    assert.doesNotMatch(h.root.textContent, /AI のまとめ/); assert.equal(h.reads.length, reads);
  }
});

test('練習モード: 記録を直して読み直すと古い知らせ。絞りこみで AI の内容は変えない', async (t) => {
  const h = await setup(t); h.open(); await settle(); await h.start(); const before = box(h).textContent;
  byClass(h.root, 'review-segment')[0].click(); buttons(h.root, '出席番号順')[0].click();
  assert.equal(box(h).textContent, before); assert.equal(h.requests, 1);
  await h.repo.saveRecord(ids.classId, ids.lessonId, ids.studentId, { question: '更新した確認用の文' }, h.now());
  buttons(h.root, '読み直す')[0].click(); await settle();
  assert.match(box(h).textContent, /このまとめを作ったあとに、記録が変わっています。/);
  await h.start('作り直す'); assert.equal(h.requests, 2);
  assert.doesNotMatch(box(h).textContent, /記録が変わっています/);
});

test('練習モード: 保存失敗のまとめは切りかえ後も残し、保存を再試行できる', async (t) => {
  const h = await setup(t); const write = h.repo.setAiSummary;
  h.repo.setAiSummary = async () => { throw new Error('確認用'); }; h.open(); await settle(); await h.start();
  assert.match(box(h).textContent, /まとめは作れましたが、保存できませんでした。開き直すと消えます。/);
  await h.select('review-lesson', 'NextLesson'); await h.select('review-lesson', ids.lessonId);
  assert.match(box(h).textContent, /練習モードの見本です/);
  h.repo.setAiSummary = write; buttons(box(h), 'もう一度保存する')[0].click(); await settle();
  assert.ok(await h.repo.getAiSummary(ids.classId, ids.lessonId)); assert.equal(h.requests, 1);
});

test('本番と同じ通信部品: 1 回の POST と保存。HTML らしい文字を表示しても要素にしない', async (t) => {
  const h = await setup(t); h.ctx.demo = false; h.ctx.auth.getToken = async () => 'test-token';
  await h.repo.saveRecord(ids.classId, ids.lessonId, ids.studentId,
    { learned: 'Ｓ２６－００１', question: 'sample@example.test', memo: '000-000-0000' }, h.now());
  const calls = []; const fetch = async (url, options) => {
    calls.push({ url, options });
    return { json: async () => ({ ok: true, model: 'test-model', summary: { overview: '<script>確認用</script>' } }) };
  };
  const gas = createGas({ url: 'https://example.test/gas', auth: h.ctx.auth, fetch });
  h.ctx.ai = { summarize: (request) => requestAiSummary({ gas, request }) };
  h.open(); await settle(); await h.start();
  assert.equal(calls.length, 1); assert.equal(calls[0].options.method, 'POST');
  const body = JSON.parse(calls[0].options.body); assert.equal(body.op, 'summarize');
  assert.equal(body.entries.length, 2); assert.doesNotMatch(JSON.stringify(body.entries), /s26-/);
  assert.equal(body.labels, undefined);
  assert.equal(body.entries[0].learned, '（ID）'); assert.equal(body.entries[0].question, '（メール）');
  assert.equal(body.entries[0].memo, '（番号）');
  assert.match(box(h).textContent, /<script>確認用<\/script>/);
  assert.equal(all(box(h), (node) => node.tagName === 'script').length, 0);
  assert.equal(h.writes.length, 1);
});

test('AI とファイル読込は同じ GAS の順番待ちを使い、まとめが終わってからファイルを読む', async (t) => {
  const h = await setup(t); h.ctx.auth.getToken = async () => 'test-token';
  const gate = deferred(); t.after(() => gate.resolve());
  const calls = [];
  const gas = createGas({ url: 'https://example.test/gas', auth: h.ctx.auth, fetch: async (url, options) => {
    const { op } = JSON.parse(options.body); calls.push(op);
    if (op === 'summarize') {
      await gate.promise;
      return { json: async () => ({ ok: true, model: 'test-model', summary: { overview: '順番待ちの見本' } }) };
    }
    return { json: async () => ({ ok: true, mime: 'text/plain', dataB64: 'ZGVtbw==' }) };
  } });
  h.ctx.ai = { summarize: (request) => requestAiSummary({ gas, request }) };
  const files = createFiles({ gas, cache: { get: async () => null, put: async () => {} } });
  h.open(); await settle(); await h.start();
  const loading = files.loadFile(ids.classId, ids.lessonId, { id: 'Sample', fileId: 'sample-file' });
  await settle(); assert.deepEqual(calls, ['summarize']);
  gate.resolve(); const blob = await loading; await settle();
  assert.deepEqual(calls, ['summarize', 'getFile']); assert.equal(await blob.text(), 'demo');
  assert.match(box(h).textContent, /順番待ちの見本/); assert.equal(h.writes.length, 1);
});
