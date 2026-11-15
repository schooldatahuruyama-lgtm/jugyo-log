// 練習モードの repo と DOM の代役で、先生・生徒の画面をつないで確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoBackend } from '../js/dev/demo.js';
import { createRepo } from '../js/repo.js';
import { createDrafts } from '../js/drafts.js';
import { createInkDrafts } from '../js/ink-drafts.js';
import { createRecordQueue } from '../js/record-queue.js';
import { createLeaveGuard } from '../js/leave-guard.js';
import { mount as mountTeacher } from '../js/views/teacher-record.js';
import { mount as mountReview } from '../js/views/teacher-review.js';
import { mount as mountStudent } from '../js/views/student-lesson.js';
import { mount as mountHome } from '../js/views/student-home.js';
import { installDom, all, byClass, buttons, settle, draw } from './helpers/picture-dom.js';

const ids = { classId: 'TestClass', lessonId: 'TestLesson', studentId: 's26-001' };
const second = 's26-002';
const outside = 's26-003';
const views = { 't-record': mountTeacher, 't-review': mountReview, lesson: mountStudent, home: mountHome };
const reply = (h) => byClass(h.root, 'reply-box')[0];
const replyInput = (h) => all(reply(h), (node) => node.tagName === 'textarea')[0];
const editReply = (h, text) => { replyInput(h).value = text; replyInput(h).fire('input'); };
const saveReply = async (h) => { buttons(reply(h), '保存する')[0].click(); await settle(); };
const confirm = (label) => buttons(byClass(document.body, 'confirm')[0], label)[0].click();

async function setup(t) {
  const dom = installDom();
  const createElement = dom.createElement;
  dom.createElement = (tag) => {
    const node = createElement(tag);
    if (tag === 'textarea') node.select = () => {};
    return node;
  };
  const items = new Map();
  const storage = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, value), removeItem: (key) => items.delete(key),
    get length() { return items.size; }, key: (i) => [...items.keys()][i],
  };
  let time = new Date(2026, 10, 16, 12).getTime();
  const now = () => ++time;
  const backend = createDemoBackend({ storage, now, random: () => 0.25 });
  const repo = createRepo(backend.net);
  await repo.createClass(ids.classId, { year: 2026, name: '確認用クラス' }, now());
  await repo.createLessons([{ ...ids, date: '2026-11-16', title: '確認用授業' }], now());
  await repo.saveMembers(ids.classId, { set: { [ids.studentId]: 1, [second]: 2 } });
  await repo.saveRecord(ids.classId, ids.lessonId, outside, { memo: '確認用メモ', question: '確認用の疑問' }, now());
  const timers = new Map();
  let timerId = 0;
  const leave = createLeaveGuard();
  const inkFiles = new Map();
  const root = document.createElement('main'); document.body.append(root);
  const h = { root, repo, backend, guard: leave, route: null, destroy: null, signouts: 0 };
  const ctx = {
    repo, now, random: () => 0.25, session: { studentId: ids.studentId },
    recordQueue: createRecordQueue(), drafts: createDrafts({ storage }), inkDrafts: createInkDrafts({ storage }),
    timers: { setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); } },
    thumbs: { load: async () => ({}) },
    files: {
      async uploadInk({ text }) { const fileId = `TestInk${inkFiles.size}`; inkFiles.set(fileId, text); return { fileId, bytes: text.length }; },
      loadInk: async (id) => inkFiles.get(id), trashStudent: async () => true,
    },
    setLeaveGuard: (fn) => leave.set(fn),
    signOutAll: async () => { h.signouts++; },
    async navigate(name, params = {}, { confirmed = false } = {}) {
      if (!confirmed && !await leave.ask()) return 'stayed';
      h.open(name, params); return 'moved';
    },
  };
  h.open = (name, params = ids) => {
    h.destroy?.(); h.destroy = null; leave.clear(); root.replaceChildren();
    h.route = { name, params };
    if (views[name]) h.destroy = views[name](root, { ...ctx, params });
  };
  h.advance = async () => { const jobs = [...timers.values()]; timers.clear(); jobs.forEach((fn) => fn()); await settle(); };
  t.after(() => { h.destroy?.(); root.remove(); dom.restore(); });
  return h;
}

test('練習モード: 未記入の生徒へ保存 → 一覧の返事ずみ → 生徒の箱とタイル → 取り消し', async (t) => {
  const h = await setup(t);
  h.open('t-record'); await settle();
  assert.match(h.root.textContent, /この生徒は、まだ何も書いていません。/);
  editReply(h, '確認用の返事\n次の行'); await saveReply(h);
  assert.equal(await h.repo.getRecord(ids.classId, ids.lessonId, ids.studentId), null);
  buttons(h.root, '‹ 一覧へ')[0].click(); await settle();
  assert.equal(h.route.name, 't-review');
  assert.equal(byClass(h.root, 'reply-mark')[0].textContent, '💬 返事ずみ');
  h.open('lesson'); await settle();
  assert.equal(byClass(reply(h), 'reply-text')[0].textContent, '確認用の返事\n次の行');
  assert.equal(byClass(reply(h), 'reply-date')[0].textContent, '11/16');
  assert.equal(all(reply(h), (node) => ['textarea', 'input', 'button'].includes(node.tagName)).length, 0);
  buttons(h.root, '‹ 一覧へ')[0].click(); await settle();
  assert.equal(h.route.name, 'home');
  assert.equal(byClass(h.root, 'reply-mark')[0].textContent, '💬 先生から');
  h.open('t-record'); await settle();
  buttons(reply(h), '返事を取り消す')[0].click(); confirm('取り消す'); await settle();
  h.open('lesson'); await settle(); assert.equal(reply(h).hidden, true);
  h.open('home'); await settle(); assert.equal(byClass(h.root, 'reply-mark').length, 0);
  h.open('t-review'); await settle(); assert.equal(byClass(h.root, 'reply-mark').length, 0);
});

test('練習モード: 印だけを保存し、先生の一覧と生徒の箱に表示する', async (t) => {
  const h = await setup(t); h.open('t-record'); await settle();
  const seen = all(reply(h), (node) => node.tagName === 'input')[0];
  seen.checked = true; seen.fire('change'); await saveReply(h);
  buttons(h.root, '‹ 一覧へ')[0].click(); await settle();
  assert.equal(byClass(h.root, 'reply-mark')[0].textContent, '✓ 見ました');
  h.open('lesson'); await settle();
  assert.match(reply(h).textContent, /✓ 先生が見ました/);
  assert.equal(byClass(reply(h), 'reply-text').length, 0);
});

test('練習モード: 次の人で確認し、戻って保存できる。移った後は別の返事を読む', async (t) => {
  const h = await setup(t);
  await h.repo.setReply(ids.classId, ids.lessonId, second, { text: '次の生徒への返事' }, 1);
  h.open('t-record'); await settle(); editReply(h, '書きかけ');
  assert.equal(window.fire('beforeunload').defaultPrevented, true);
  buttons(h.root, '次の人')[0].click(); await settle();
  assert.match(byClass(document.body, 'confirm')[0].textContent, /保存していない返事があります/);
  confirm('もどって保存する'); await settle();
  assert.equal(h.route.params.studentId, ids.studentId);
  assert.equal(replyInput(h).value, '書きかけ');
  buttons(h.root, '次の人')[0].click(); await settle(); confirm('移る'); await settle();
  assert.equal(h.route.params.studentId, second);
  assert.equal(replyInput(h).value, '次の生徒への返事');
  assert.equal(window.fire('beforeunload').defaultPrevented, false);
  assert.equal(await h.repo.getReply(ids.classId, ids.lessonId, ids.studentId), null);
});

for (const label of ['前の人', '‹ 一覧へ', 'クラス', '単元', '授業', '記録', 'ログアウト']) {
  test(`練習モード: 書きかけで「${label}」を押すと既存の移動確認を通る`, async (t) => {
    const h = await setup(t); h.open('t-record', { ...ids, studentId: second }); await settle();
    editReply(h, '残す返事'); buttons(h.root, label)[0].click(); await settle();
    assert.match(byClass(document.body, 'confirm')[0].textContent, /保存していない返事があります/);
    confirm('もどって保存する'); await settle();
    assert.equal(h.route.name, 't-record');
    assert.equal(h.route.params.studentId, second);
    assert.equal(replyInput(h).value, '残す返事');
    assert.equal(h.signouts, 0);
  });
}

test('練習モード: 名簿にいない生徒の記録にも返事を書け、記録とコピーの中身は変わらない', async (t) => {
  const h = await setup(t);
  const before = await h.repo.getRecord(ids.classId, ids.lessonId, outside);
  h.open('t-record', { ...ids, studentId: outside }); await settle();
  assert.match(h.root.textContent, /名簿にいない生徒/);
  editReply(h, 'コピーに含めない返事'); await saveReply(h);
  assert.deepEqual(await h.repo.getRecord(ids.classId, ids.lessonId, outside), before);
  h.open('t-review'); await settle();
  const row = byClass(h.root, 'review-row').find((node) => node.textContent.includes('名簿にいない'));
  assert.match(row.textContent, /💬 返事ずみ/);
  // Node の代役ではクリップボードがないため、手でコピーする欄の文章を確かめる。
  buttons(h.root, '全員分をコピー')[0].click(); await settle();
  assert.equal(document.getElementById('review-copy-text').value, '確認用の疑問');
});

test('練習モード: 未記入への返事は名簿から外しても開いて書き直し・取り消しができ、集計とコピーは変わらない', async (t) => {
  const h = await setup(t);
  await h.repo.saveRecord(ids.classId, ids.lessonId, outside, { level: 2, question: '確認用の疑問' }, 1);
  h.open('t-record'); await settle();
  editReply(h, '名簿から外した後も残る返事'); await saveReply(h);
  await h.repo.saveMembers(ids.classId, { remove: [ids.studentId] });
  buttons(h.root, '‹ 一覧へ')[0].click(); await settle();
  const row = byClass(h.root, 'review-row').find((node) => node.textContent.includes(ids.studentId));
  assert.ok(row);
  assert.match(row.textContent, /名簿にいない/);
  assert.match(row.textContent, /💬 返事ずみ/);
  assert.match(row.textContent, /まだ入力なし/);
  assert.match(row.textContent, /（まだ書いていません）/);
  const chart = () => byClass(h.root, 'review-segment').map((node) => [node.getAttribute('aria-label'), node.style.flexGrow]);
  const expectedChart = [['あまり分からなかった 50%', '1'], ['まだ入力なし 50%', '1']];
  assert.deepEqual(chart(), expectedChart);
  byClass(h.root, 'review-segment').find((node) => node.getAttribute('aria-label').startsWith('まだ入力なし')).click();
  assert.match(byClass(h.root, 'review-filter-status')[0].textContent, /『まだ入力なし』の 1 人/);
  assert.equal(byClass(h.root, 'review-row').length, 2);
  buttons(h.root, '全員を出す')[0].click();
  buttons(h.root, '全員分をコピー')[0].click(); await settle();
  assert.equal(document.getElementById('review-copy-text').value, '確認用の疑問');
  byClass(h.root, 'review-row').find((node) => node.textContent.includes(ids.studentId)).click(); await settle();
  assert.equal(h.route.params.studentId, ids.studentId);
  assert.match(h.root.textContent, /名簿にいない生徒の記録/);
  assert.match(h.root.textContent, /この生徒は、まだ何も書いていません。/);
  assert.match(h.root.textContent, /まだ入力なし/);
  assert.match(h.root.textContent, /（まだ書いていません）/);
  assert.equal(replyInput(h).value, '名簿から外した後も残る返事');
  editReply(h, '書き直した返事'); await saveReply(h);
  assert.equal((await h.repo.getReply(ids.classId, ids.lessonId, ids.studentId)).text, '書き直した返事');
  const box = reply(h);
  buttons(box, '返事を取り消す')[0].click(); confirm('取り消す'); await settle();
  assert.equal(h.route.name, 't-record');
  assert.equal(reply(h), box);
  assert.equal(replyInput(h).value, '');
  assert.match(box.textContent, /返事を取り消しました/);
  assert.equal(await h.repo.getReply(ids.classId, ids.lessonId, ids.studentId), null);
  assert.equal(await h.repo.getRecord(ids.classId, ids.lessonId, ids.studentId), null);
  buttons(h.root, '‹ 一覧へ')[0].click(); await settle();
  assert.equal(byClass(h.root, 'review-row').length, 2);
  assert.ok(byClass(h.root, 'review-row').every((node) => !node.textContent.includes(ids.studentId)));
  assert.deepEqual(chart(), expectedChart);
  buttons(h.root, '全員分をコピー')[0].click(); await settle();
  assert.equal(document.getElementById('review-copy-text').value, '確認用の疑問');
});

test('練習モード: 返事だけの生徒も ID 順と前後の移動に入り、重複と不正な ID は出さない', async (t) => {
  const h = await setup(t);
  const firstReply = 's26-000';
  const lastReply = 's26-004';
  await h.repo.saveRecord(ids.classId, ids.lessonId, ids.studentId, { level: 3, question: '確認用の記録' }, 1);
  for (const studentId of [lastReply, outside, ids.studentId, firstReply, 'invalid-name']) {
    await h.repo.setReply(ids.classId, ids.lessonId, studentId, { seen: true }, 1);
  }
  h.open('t-review'); await settle();
  const labels = ['1 番', '2 番', `名簿にいない ${firstReply}`, `名簿にいない ${outside}`, `名簿にいない ${lastReply}`]
    .map((label) => `${label}の記録を開く`);
  const rowLabels = () => byClass(h.root, 'review-row').map((node) => node.getAttribute('aria-label'));
  assert.deepEqual(rowLabels(), labels);
  assert.equal(byClass(h.root, 'reply-mark').length, 4);
  buttons(h.root, '出席番号順')[0].click();
  assert.deepEqual(rowLabels(), labels);
  byClass(h.root, 'review-row')[1].click(); await settle();
  for (const studentId of [firstReply, outside, lastReply]) {
    buttons(h.root, '次の人')[0].click(); await settle();
    assert.equal(h.route.params.studentId, studentId);
    assert.equal(all(reply(h), (node) => node.tagName === 'input')[0].checked, true);
  }
  assert.equal(buttons(h.root, '次の人')[0].disabled, true);
  for (const studentId of [outside, firstReply, second, ids.studentId]) {
    buttons(h.root, '前の人')[0].click(); await settle();
    assert.equal(h.route.params.studentId, studentId);
  }
  assert.equal(buttons(h.root, '前の人')[0].disabled, true);
  h.open('t-record', { ...ids, studentId: 'invalid-name' }); await settle();
  assert.match(h.root.textContent, /この生徒は見つかりません。/);
  assert.equal(reply(h), undefined);
});

test('練習モード: 返事だけの生徒しかいない場合は一覧に出し、グラフとコピーには含めない', async (t) => {
  const h = await setup(t);
  await h.repo.saveMembers(ids.classId, { remove: [ids.studentId, second] });
  h.repo.listRecords = async () => ({});
  await h.repo.setReply(ids.classId, ids.lessonId, ids.studentId, { seen: true }, 1);
  h.open('t-review'); await settle();
  assert.equal(byClass(h.root, 'review-row').length, 1);
  assert.equal(byClass(h.root, 'reply-mark')[0].textContent, '✓ 見ました');
  assert.equal(byClass(h.root, 'review-segment').length, 0);
  assert.match(byClass(h.root, 'review-chart')[0].textContent, /このクラスには、まだ生徒がいません。/);
  buttons(h.root, '全員分をコピー')[0].click(); await settle();
  assert.equal(document.getElementById('review-copy-text'), null);
  assert.match(document.body.textContent, /コピーする文章がありません。/);
});

for (const synchronous of [false, true]) {
  test(`練習モード: 返事の印の${synchronous ? '同期的な' : ''}失敗でも先生の一覧は残し、通知は 1 つだけ`, async (t) => {
    const h = await setup(t); const original = h.repo.listReplies;
    const replyOnly = 's26-004';
    await h.repo.setReply(ids.classId, ids.lessonId, replyOnly, { seen: true }, 1);
    h.repo.listReplies = synchronous ? () => { throw new Error('offline'); } : async () => { throw new Error('offline'); };
    h.open('t-review'); await settle();
    assert.equal(byClass(h.root, 'review-row').length, 3);
    assert.equal(all(h.root, (node) => node.tagName === 'p' && node.textContent === '返事の印を読みこめませんでした。').length, 1);
    assert.equal(byClass(h.root, 'reply-mark').length, 0);
    h.open('t-record', { ...ids, studentId: replyOnly }); await settle();
    assert.match(h.root.textContent, /この生徒は見つかりません。/);
    assert.equal(reply(h), undefined);
    for (const studentId of [ids.studentId, outside]) {
      h.open('t-record', { ...ids, studentId }); await settle();
      assert.ok(reply(h));
      assert.doesNotMatch(h.root.textContent, /この生徒は見つかりません。|つながりません/);
    }
    h.open('t-review'); await settle();
    h.repo.listReplies = original;
    await h.repo.setReply(ids.classId, ids.lessonId, ids.studentId, { seen: true }, 1);
    buttons(h.root, '読み直す')[0].click(); await settle();
    assert.equal(byClass(h.root, 'review-row').length, 4);
    assert.equal(byClass(h.root, 'reply-mark')[0].textContent, '✓ 見ました');
    assert.doesNotMatch(h.root.textContent, /返事の印を読みこめませんでした。/);
  });
}

test('練習モード: 生徒の印だけ失敗した場合は、授業を表示して通知しない', async (t) => {
  const h = await setup(t);
  h.repo.getReplyMarks = async () => { throw new Error('offline'); };
  h.open('home'); await settle();
  assert.equal(byClass(h.root, 'lesson-tile').length, 1);
  assert.equal(byClass(h.root, 'reply-mark').length, 0);
  assert.doesNotMatch(h.root.textContent, /読みこめません|つながりません/);
});

test('練習モード: 返事の失敗は文字と手書きの保存を妨げず、画面に戻ると返事を読み直す', async (t) => {
  const h = await setup(t); const original = h.repo.getReply;
  h.repo.getReply = async () => { throw new Error('offline'); };
  h.open('lesson'); await settle();
  assert.match(reply(h).textContent, /先生からの返事を読みこめませんでした。/);
  const memo = document.getElementById('student-record-memo');
  memo.value = '保存するメモ'; memo.fire('input'); await h.advance();
  assert.equal((await h.repo.getRecord(ids.classId, ids.lessonId, ids.studentId)).memo, '保存するメモ');
  assert.match(byClass(h.root, 'student-lesson-states')[0].textContent, /保存しました/);
  buttons(h.root, '手書き')[0].click(); await settle();
  const paper = byClass(h.root, 'ink-paper')[0]; assert.ok(paper); draw(paper); await h.advance();
  assert.ok((await h.repo.getRecord(ids.classId, ids.lessonId, ids.studentId)).ink.memo);
  const saveState = byClass(h.root, 'student-lesson-states')[0].textContent;
  buttons(reply(h), 'もう一度')[0].click(); await settle();
  assert.equal(byClass(h.root, 'student-lesson-states')[0].textContent, saveState);
  h.repo.getReply = original;
  await h.repo.setReply(ids.classId, ids.lessonId, ids.studentId, { text: '戻った後の返事' }, 1);
  document.fire('visibilitychange'); await settle();
  assert.equal(byClass(reply(h), 'reply-text')[0].textContent, '戻った後の返事');
  assert.equal(document.getElementById('student-record-memo'), memo);
  await h.repo.removeReply(ids.classId, ids.lessonId, ids.studentId);
  document.fire('visibilitychange'); await settle();
  assert.equal(reply(h).hidden, true);
  assert.equal(byClass(h.root, 'student-lesson-states')[0].textContent, saveState);
});
