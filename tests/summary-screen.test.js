// 練習モードの repo と既存の DOM の代役で、先生のまとめを確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoBackend } from '../js/dev/demo.js';
import { createRepo } from '../js/repo.js';
import { mount as mountReview } from '../js/views/teacher-review.js';
import { mount as mountRecord } from '../js/views/teacher-record.js';
import { installDom, all, byClass, buttons, settle } from './helpers/picture-dom.js';

const ids = { classId: 'SummaryClass', lessonId: 'SummaryLesson', studentId: 's26-001' };
const box = (h) => byClass(h.root, 'summary-box')[0];
const details = () => document.getElementById('review-summary-details');
const termRows = (h) => all(byClass(box(h), 'summary-table')[0], (node) => node.tagName === 'tbody')[0].children;

async function setup(t, { records = true, members = true } = {}) {
  const dom = installDom();
  const createElement = dom.createElement;
  dom.createElement = (tag) => {
    const node = createElement(tag);
    if (tag === 'textarea') node.select = () => { node.selectedText = true; };
    return node;
  };
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  const saved = new Map();
  const storage = { getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value), removeItem: (key) => saved.delete(key) };
  let time = new Date(2026, 10, 16, 12).getTime();
  const now = () => ++time;
  const backend = createDemoBackend({ storage, now, random: () => 0.25 });
  const repo = createRepo(backend.net);
  await repo.createClass(ids.classId, { year: 2026, name: 'まとめ確認用' }, now());
  await repo.createLessons([{ ...ids, date: '2026-11-16', title: 'まとめ確認用授業' },
    { ...ids, lessonId: 'NextLesson', date: '2026-11-15', title: '次の確認用授業' }], now());
  if (members) await repo.saveMembers(ids.classId, { set: { 's26-001': 1, 's26-002': 2, 's26-003': 3, 's26-004': 4 } });
  for (const [index, term] of ['反射', '屈折', '未登場'].entries()) await repo.addLessonTerm(ids.classId, ids.lessonId, `Term${index}`, term, now());
  if (records) {
    for (const [studentId, record] of Object.entries({
      's26-001': { level: 1, question: '反射とガラス\n<x>', learned: '屈折とガラス' },
      's26-002': { level: 3, question: '反射とガラス', learned: '屈折' },
      's26-003': { level: 2 },
      's26-005': { level: 2, question: 'ガラス' },
    })) await repo.saveRecord(ids.classId, ids.lessonId, studentId, record, now());
    await repo.setInk(ids.classId, ids.lessonId, 's26-003', 'question', { fileId: 'TestInk', bytes: 100, strokes: 1 }, null, now());
    await repo.setReply(ids.classId, ids.lessonId, 's26-006', { seen: true }, now());
  }
  const calls = [];
  for (const name of ['listClasses', 'listLessons', 'getLesson', 'getMembers', 'listRecords', 'listReplies', 'listInkThumbs']) {
    const original = repo[name];
    repo[name] = (...args) => { calls.push(name); return original(...args); };
  }
  const root = document.createElement('main'); document.body.append(root);
  const h = { root, repo, calls, now, destroy: null, route: null };
  const ctx = { repo, now, thumbs: { load: async () => ({}) },
    files: { loadInk: async () => { throw new Error('確認用'); } },
    navigate: async (name, params) => { h.open(name, params); return 'moved'; } };
  h.open = (name = 't-review', params = ids) => {
    h.destroy?.(); root.replaceChildren(); h.route = { name, params };
    h.destroy = (name === 't-record' ? mountRecord : mountReview)(root, { ...ctx, params });
  };
  t.after(() => {
    h.destroy?.(); root.remove(); dom.restore();
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  });
  return h;
}

test('練習モードのまとめ: グラフと一覧の間に出し、返事だけの生徒を人数から除く', async (t) => {
  const h = await setup(t); h.open(); await settle();
  const columns = byClass(h.root, 'review-columns')[0];
  assert.equal(columns.hidden, false);
  assert.ok(columns.children[0].classList.contains('review-chart'));
  assert.equal(columns.children[1].children[0], box(h));
  assert.ok(columns.children[2].classList.contains('review-records'));
  assert.match(box(h).textContent, /文字で書いた記録を、このアプリの中で数えたものです。手書きは入っていません。/);
  assert.match(box(h).textContent, /疑問: 文字 3 人・手書き 1 人・まだ 1 人/);
  assert.match(box(h).textContent, /分かったこと: 文字 2 人・手書き 0 人・まだ 3 人/);
  assert.deepEqual(termRows(h).map((row) => row.textContent), ['反射2 人0 人', '屈折0 人2 人', '未登場0 人0 人']);
  assert.match(box(h).textContent, /ほかに、手書きの人が 1 人います。/);
  assert.equal(byClass(h.root, 'review-row').length, 6);
  assert.equal(byClass(h.root, 'reply-mark').length, 1);
  assert.doesNotMatch(box(h).textContent, /s26-/);
});

for (const members of [true, false]) {
  test(`練習モードのまとめ: 記録なし・名簿${members ? 'あり' : 'なし'}では空の案内だけ`, async (t) => {
    const h = await setup(t, { records: false, members }); h.open(); await settle();
    assert.equal(box(h).textContent, 'まとめ（自動）まだ記録がありません。');
    assert.equal(all(box(h), (node) => node.tagName === 'button').length, 0);
  });
}

test('練習モードのまとめ: 用語の行で開閉し、別の言葉に切りかえ、文章を文字のまま表示', async (t) => {
  const h = await setup(t); h.open(); await settle();
  const row = termRows(h)[0];
  const term = buttons(row, '反射')[0];
  assert.equal(term.getAttribute('aria-expanded'), 'false');
  row.fire('click', { target: row.children[1] });
  assert.equal(term.getAttribute('aria-expanded'), 'true');
  assert.equal(details().hidden, false);
  assert.match(details().textContent, /疑問1 番反射とガラス\n<x>2 番反射とガラス分かったこと（ありません）/);
  assert.equal(all(details(), (node) => node.tagName === 'x').length, 0);
  term.click();
  assert.equal(term.getAttribute('aria-expanded'), 'false');
  assert.equal(details().hidden, true);
  term.click();
  const word = buttons(box(h), 'ガラス（3 人）')[0]; word.click();
  assert.equal(term.getAttribute('aria-expanded'), 'false');
  assert.equal(word.getAttribute('aria-expanded'), 'true');
  assert.match(details().textContent, /名簿にいないガラス分かったこと1 番屈折とガラス/);
  assert.doesNotMatch(details().textContent, /s26-/);
  buttons(box(h), '未登場')[0].click();
  assert.equal(word.getAttribute('aria-expanded'), 'false');
  assert.equal(details().textContent, '「未登場」を書いた生徒疑問（ありません）分かったこと（ありません）');
});

test('練習モードのまとめ: 既存の絞りこみで変わらず、通信を追加しない', async (t) => {
  const h = await setup(t); h.open(); await settle();
  assert.deepEqual([...h.calls].sort(), ['listClasses', 'listLessons', 'getLesson', 'getMembers', 'listRecords', 'listReplies', 'listInkThumbs'].sort());
  const before = box(h).textContent;
  byClass(h.root, 'review-segment')[0].click();
  buttons(h.root, '出席番号順')[0].click();
  assert.equal(box(h).textContent, before);
  buttons(box(h), '反射')[0].click();
  buttons(box(h), 'ガラス（3 人）')[0].click();
  buttons(box(h), 'まとめをコピー')[0].click(); await settle();
  assert.equal(h.calls.length, 7);
});

test('練習モードのまとめ: 読み直すまでは同じ内容で、読み直しで集計と開閉を初期化', async (t) => {
  const h = await setup(t); h.open(); await settle();
  const term = buttons(box(h), '反射')[0]; term.click();
  await h.repo.saveRecord(ids.classId, ids.lessonId, ids.studentId, { question: '電流', level: 2 }, h.now());
  assert.match(details().textContent, /反射とガラス/);
  buttons(h.root, '読み直す')[0].click();
  assert.equal(box(h), undefined);
  await settle();
  assert.equal(details().hidden, true);
  assert.equal(buttons(box(h), '反射')[0].getAttribute('aria-expanded'), 'false');
  assert.equal(termRows(h)[0].textContent, '反射1 人0 人');
  assert.match(box(h).textContent, /1 番電流/);
});

test('練習モードのまとめ: 授業とクラスの切りかえで、用語と集計を作り直す', async (t) => {
  const h = await setup(t);
  await h.repo.addLessonTerm(ids.classId, 'NextLesson', 'Term0', '電流', h.now());
  await h.repo.saveRecord(ids.classId, 'NextLesson', ids.studentId, { question: '電流' }, h.now());
  await h.repo.createClass('OtherClass', { year: 2026, name: '別の確認用' }, h.now());
  await h.repo.createLessons([{ classId: 'OtherClass', lessonId: 'OtherLesson', date: '2026-11-16', title: '別の授業' }], h.now());
  h.open(); await settle(); buttons(box(h), '反射')[0].click();
  const lesson = document.getElementById('review-lesson'); lesson.value = 'NextLesson'; lesson.fire('change'); await settle();
  assert.equal(h.route.params.lessonId, 'NextLesson');
  assert.deepEqual(termRows(h).map((row) => row.textContent), ['電流1 人0 人']);
  assert.equal(details().hidden, true);
  buttons(box(h), '電流')[0].click();
  const cls = document.getElementById('review-class'); cls.value = 'OtherClass'; cls.fire('change'); await settle();
  assert.equal(h.route.params.classId, 'OtherClass');
  assert.equal(box(h).textContent, 'まとめ（自動）まだ記録がありません。');
});

test('練習モードのまとめ: 個人の記録から戻ると、一覧と同じ最新の内容を出す', async (t) => {
  const h = await setup(t); h.open(); await settle();
  buttons(box(h), '反射')[0].click();
  byClass(h.root, 'review-row').find((row) => row.getAttribute('aria-label') === '1 番の記録を開く').click(); await settle();
  assert.equal(h.route.name, 't-record');
  assert.equal(box(h), undefined);
  await h.repo.saveRecord(ids.classId, ids.lessonId, ids.studentId, { level: 1, question: '戻ったときの電流' }, h.now());
  buttons(h.root, '‹ 一覧へ')[0].click(); await settle();
  assert.equal(h.route.name, 't-review');
  assert.equal(details().hidden, true);
  assert.match(box(h).textContent, /1 番戻ったときの電流/);
  assert.match(byClass(h.root, 'review-row')[0].textContent, /戻ったときの電流/);
});

test('練習モードのまとめ: コピーは人数とまとめだけ、既存の全員分コピーはそのまま', async (t) => {
  const h = await setup(t); h.open(); await settle();
  const copies = []; navigator.clipboard = { writeText: async (text) => { copies.push(text); } };
  buttons(box(h), '反射')[0].click();
  buttons(box(h), 'まとめをコピー')[0].click(); await settle();
  assert.match(copies[0], /疑問: 文字 3 人・手書き 1 人・まだ 1 人/);
  assert.match(copies[0], /反射: 2 人 \/ 0 人/);
  assert.match(copies[0], /ガラス（3 人）/);
  assert.match(copies[0], /1 番: 反射とガラス\n<x>/);
  assert.match(copies[0], /名簿にいない: ガラス/);
  assert.doesNotMatch(copies[0], /s26-|「反射」を書いた生徒/);
  assert.match(document.body.textContent, /まとめをコピーしました。/);
  buttons(h.root, '全員分をコピー')[0].click(); await settle();
  assert.equal(copies[1], '反射とガラス <x>\n反射とガラス\nガラス\n（手書き 1 件は含まれていません）');
});

test('練習モードのまとめ: コピー失敗は既存と同じ案内で、手動コピーして閉じられる', async (t) => {
  const h = await setup(t); h.open(); await settle();
  navigator.clipboard = { writeText: async () => { throw new Error('確認用の失敗'); } };
  const copy = buttons(box(h), 'まとめをコピー')[0]; copy.click(); await settle();
  const textarea = document.getElementById('summary-copy-text');
  assert.match(box(h).textContent, /コピーできませんでした。下の文章を選んで、コピーしてください。/);
  assert.match(textarea.value, /理解度が低い生徒の疑問/);
  assert.doesNotMatch(textarea.value, /s26-/);
  assert.equal(document.activeElement, textarea);
  assert.equal(textarea.selectedText, true);
  assert.equal(copy.disabled, false);
  buttons(box(h), '閉じる')[0].click();
  assert.equal(document.getElementById('summary-copy-text'), null);
  assert.equal(document.activeElement, copy);
});

for (const succeeds of [true, false]) {
  test(`練習モードのまとめ: 読み直した後は、遅いコピーの${succeeds ? '成功' : '失敗'}を出さない`, async (t) => {
    const h = await setup(t); h.open(); await settle();
    let finish;
    navigator.clipboard = { writeText: () => new Promise((resolve, reject) => { finish = succeeds ? resolve : reject; }) };
    const copy = buttons(box(h), 'まとめをコピー')[0]; copy.click();
    assert.equal(copy.disabled, true);
    buttons(h.root, '読み直す')[0].click(); await settle();
    finish(); await settle();
    assert.equal(document.getElementById('summary-copy-text'), null);
    assert.doesNotMatch(document.body.textContent, /まとめをコピーしました。|コピーできませんでした。/);
    assert.equal(buttons(box(h), 'まとめをコピー')[0].disabled, false);
  });
}

test('練習モードのまとめ: 記録の読みこみ失敗でカードを出さず、再試行で復帰', async (t) => {
  const h = await setup(t); h.open(); await settle();
  const original = h.repo.listRecords;
  h.repo.listRecords = async () => { throw new Error('確認用の失敗'); };
  buttons(h.root, '読み直す')[0].click(); await settle();
  assert.equal(box(h), undefined);
  assert.match(h.root.textContent, /つながりません。もう一度ためしてください。/);
  h.repo.listRecords = original;
  buttons(h.root, 'もう一度ためす')[0].click(); await settle();
  assert.ok(box(h));
});

test('練習モードのまとめ: 用語がなければ表を出さず、長い文章もそのまま扱う', async (t) => {
  const h = await setup(t, { records: false });
  const long = '<文字>'.repeat(500);
  await h.repo.saveRecord(ids.classId, 'NextLesson', ids.studentId, { level: 1, question: long }, h.now());
  h.open('t-review', { ...ids, lessonId: 'NextLesson' }); await settle();
  assert.equal(byClass(box(h), 'summary-table').length, 0);
  assert.equal(byClass(box(h), 'summary-text')[0].textContent, long);
  assert.equal(all(box(h), (node) => node.tagName === '文字').length, 0);
});
