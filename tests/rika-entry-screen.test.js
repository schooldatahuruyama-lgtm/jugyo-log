// DOM と通信の代役で、授業の読みこみ状態にかかわらず入口が残ることを確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../js/config.js';
import { mount } from '../js/views/student-home.js';
import { installDom, all, byClass, buttons, settle } from './helpers/picture-dom.js';

const classes = [{ id: 'TestClass', year: 2026, name: '確認用クラス', number: 1 }];
const lessons = [{ id: 'TestLesson', classId: 'TestClass', date: '2026-11-19', title: '確認用授業' }];
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

function setup(t, extra = {}) {
  const dom = installDom();
  const root = document.createElement('div'); document.body.append(root);
  const repo = {
    myClasses: async () => classes, listLessons: async () => lessons, listUnits: async () => [],
    getMarks: async () => ({}), getMyTerms: async () => ({}), getReplyMarks: async () => ({}), ...extra,
  };
  const h = { root, repo, destroy: null };
  const ctx = {
    repo, session: { studentId: 'TestStudent' }, now: () => new Date(2026, 10, 19, 12).getTime(),
    drafts: { list: () => [] }, inkDrafts: { list: () => [] }, thumbs: { load: async () => ({}) },
    setLeaveGuard: () => {},
    navigate: async (name, params) => { h.open(params); return 'moved'; },
  };
  h.open = (params = {}) => { h.destroy?.(); h.destroy = mount(root, { ...ctx, params }); };
  t.after(() => { h.destroy?.(); root.remove(); dom.restore(); });
  return h;
}

function entry(root) {
  const cards = byClass(root, 'rika-entry');
  assert.equal(cards.length, 1);
  const card = cards[0];
  assert.equal(card.tagName, 'section');
  assert.equal(card.getAttribute('aria-label'), '理科クエスト');
  assert.equal(card.hidden, false);
  assert.equal(byClass(root, 'page-main')[0].children[0], card);
  const links = all(card, (node) => node.tagName === 'a');
  assert.equal(links.length, 1);
  assert.equal(links[0].getAttribute('href'), new URL(CONFIG.rika.url).href);
  assert.equal(links[0].textContent, 'ひらく');
  assert.equal(links[0].getAttribute('target'), null);
  assert.equal(links[0].getAttribute('aria-disabled'), null);
  assert.equal(links[0].getAttribute('disabled'), null);
  return card;
}

test('理科の入口: 画面を作った直後から読みこみ完了後まで、先頭に 1 つだけ出る', async (t) => {
  const gate = deferred();
  const h = setup(t, { listLessons: () => gate.promise });
  h.open();
  const card = entry(h.root);
  assert.match(h.root.textContent, /読みこんでいます…/);
  assert.equal(all(card, (node) => node.tagName === 'h2')[0].textContent, '理科クエスト');
  assert.equal(all(card, (node) => node.tagName === 'p')[0].textContent, '理科の問題に、自分のペースで取り組めます。');
  await settle();
  assert.equal(entry(h.root), card);
  assert.equal(byClass(h.root, 'lesson-tile').length, 0);
  gate.resolve(lessons); await settle();
  assert.equal(byClass(h.root, 'lesson-tile').length, 1);
  assert.equal(entry(h.root), card);
});

test('理科の入口: クラスが 0 件でも出る', async (t) => {
  const h = setup(t, { myClasses: async () => [] });
  h.open(); const card = entry(h.root); await settle();
  assert.match(h.root.textContent, /まだクラスに入っていません/);
  assert.equal(entry(h.root), card);
});

test('理科の入口: 授業が 0 件でも出る', async (t) => {
  const h = setup(t, { listLessons: async () => [] });
  h.open(); const card = entry(h.root); await settle();
  assert.match(h.root.textContent, /まだ授業がありません/);
  assert.equal(entry(h.root), card);
});

test('理科の入口: 授業の読みこみ失敗とやり直しでも、増えたり消えたりしない', async (t) => {
  const h = setup(t, { listLessons: async () => { throw new Error('確認用の通信失敗'); } });
  h.open(); const card = entry(h.root); await settle();
  assert.match(h.root.textContent, /つながりません/);
  assert.equal(entry(h.root), card);
  const gate = deferred(); h.repo.listLessons = () => gate.promise;
  buttons(h.root, 'もう一度ためす')[0].click(); await settle();
  assert.match(h.root.textContent, /読みこんでいます…/);
  assert.equal(entry(h.root), card);
  gate.resolve(lessons); await settle();
  assert.equal(byClass(h.root, 'lesson-tile').length, 1);
  assert.equal(entry(h.root), card);
});

test('理科の入口: 年度を変えて画面を作り直しても、先頭に 1 つだけ出る', async (t) => {
  const other = { id: 'OtherClass', year: 2025, name: '別の確認用クラス', number: 2 };
  const h = setup(t, { myClasses: async () => [...classes, other] });
  h.open(); await settle(); entry(h.root);
  const select = all(h.root, (node) => node.tagName === 'select' && node.getAttribute('aria-label') === '年度')[0];
  select.value = other.id; select.fire('change'); entry(h.root);
  await settle(); entry(h.root);
  assert.match(byClass(h.root, 'topbar-sub')[0].textContent, /別の確認用クラス/);
});

for (const [label, rika] of [['設定なし', undefined], ['URL なし', {}], ['不正な URL', { url: 'http://example.com/' }]]) {
  test(`理科の入口: ${label}のときは空の箱も出さない`, async (t) => {
    const original = CONFIG.rika;
    t.after(() => { CONFIG.rika = original; });
    if (rika === undefined) delete CONFIG.rika; else CONFIG.rika = rika;
    const h = setup(t); h.open();
    const check = () => {
      assert.equal(byClass(h.root, 'rika-entry').length, 0);
      assert.equal(byClass(h.root, 'rika-entry-link').length, 0);
      assert.equal(byClass(h.root, 'page-main')[0].children[0], byClass(h.root, 'student-filters')[0]);
    };
    check(); await settle(); check();
    assert.equal(byClass(h.root, 'lesson-tile').length, 1);
  });
}
