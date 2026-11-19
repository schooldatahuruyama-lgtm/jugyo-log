// 練習用のデータと DOM の代役で、リンクの編集・表示・後片づけを確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoBackend } from '../js/dev/demo.js';
import { createRepo } from '../js/repo.js';
import { createDrafts } from '../js/drafts.js';
import { createInkDrafts } from '../js/ink-drafts.js';
import { createRecordQueue } from '../js/record-queue.js';
import { mount as mountTeacher } from '../js/views/teacher-lesson.js';
import { mount as mountStudent } from '../js/views/student-lesson.js';
import { mount as mountRecord } from '../js/views/teacher-record.js';
import { linkPane } from '../js/views/parts/link-pane.js';
import { openVideo } from '../js/views/parts/video-player.js';
import { embedUrl } from '../js/link-logic.js';
import { closeAllDialogs, confirmDialog, registerDialog } from '../js/ui.js';
import { installDom, all, byClass, buttons, settle } from './helpers/picture-dom.js';

const ids = { classId: 'TestClass', lessonId: 'TestLesson', studentId: 's26-001' };
const watch = 'https://www.youtube.com/watch?v=Abcdef12_-3&t=90';
const sample = { a: { url: watch, title: '確認用動画', order: 0 }, b: { url: 'https://example.com/', title: '確認用サイト', order: 1 } };
const rows = (h) => byClass(h.root, 'link-row');
const section = (h) => byClass(h.root, 'lesson-links')[0];
const field = (name) => document.getElementById(`lesson-link-${name}`);
const error = (h) => byClass(section(h), 'error')[0];
const frames = () => all(document.body, (node) => node.tagName === 'iframe');
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

async function setup(t, links = {}) {
  const dom = installDom();
  // この画面で使う複合セレクターと data 属性を、代役にも足す。
  const create = dom.createElement;
  dom.createElement = (tag) => {
    const node = create(tag);
    node.querySelectorAll = (selector) => all(node, (child) => child !== node && selector.split(',').some((part) => {
      const value = part.trim();
      if (value.startsWith('.')) return child.classList.contains(value.slice(1));
      const data = value.match(/^\[data-([a-z-]+)\]$/);
      if (data) return data[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()) in child.dataset;
      return child.tagName === value;
    }));
    return node;
  };
  const items = new Map();
  const storage = { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => items.set(key, value),
    removeItem: (key) => items.delete(key), get length() { return items.size; }, key: (i) => [...items.keys()][i] };
  let time = 1000;
  let seed = 0;
  const random = () => ((seed++ * 17 + 3) % 61) / 62;
  const backend = createDemoBackend({ storage, now: () => ++time, random });
  const repo = createRepo(backend.net);
  await repo.createClass(ids.classId, { year: 2026, name: '確認用クラス' }, 1);
  await repo.createLessons([{ ...ids, title: '確認用授業', date: '2026-11-20' }], 1);
  await repo.saveMembers(ids.classId, { set: { [ids.studentId]: 1 } });
  await backend.net.set(`lessons/${ids.classId}/${ids.lessonId}/links`, structuredClone(links));
  const root = document.createElement('main'); document.body.append(root);
  const calls = { addLessonLink: [], removeLessonLink: [], setLinkOrders: [] };
  for (const name of Object.keys(calls)) {
    const fn = repo[name];
    repo[name] = (...args) => { calls[name].push(args); return fn(...args); };
  }
  const h = { root, repo, backend, calls, destroy: null, guard: null };
  const ctx = { repo, params: ids, now: () => ++time, random, session: { studentId: ids.studentId },
    recordQueue: createRecordQueue(), drafts: createDrafts({ storage }), inkDrafts: createInkDrafts({ storage }),
    timers: { setTimeout: () => 1, clearTimeout: () => {} }, thumbs: { load: async () => ({}) }, files: {},
    setLeaveGuard: (fn) => { h.guard = fn; }, navigate: async () => {}, signOutAll: async () => {} };
  h.open = (view = mountTeacher) => { h.destroy?.(); h.destroy = view(root, ctx); };
  t.after(() => { h.destroy?.(); closeAllDialogs(); root.remove(); dom.restore(); });
  return h;
}

async function add(h, url, title = '') {
  field('url').value = url; field('title').value = title;
  all(section(h), (node) => node.tagName === 'form')[0].fire('submit');
  await settle();
}

function assertSafe(root) {
  for (const node of all(root, () => true)) {
    for (const attr of ['href', 'src']) assert.doesNotMatch(node.getAttribute(attr) || '', /javascript:|data:text|^http:/);
  }
}

function assertLinkControls(h, locked) {
  const controls = [field('url'), field('title'), buttons(section(h), '＋ 足す')[0],
    ...all(section(h), (node) => 'linkAction' in node.dataset)];
  assert.ok(controls.length > 3);
  for (const control of controls) {
    assert.equal(control.disabled, locked || control.dataset.edge === 'true', control.getAttribute('id') || control.textContent);
  }
}

test('先生: 正しい URL と名前を整えて足し、入力を空にする', async (t) => {
  const h = await setup(t); h.open(); await settle();
  assert.match(section(h).textContent, /まだリンクがありません。/);
  await add(h, ' HTTPS://Example.com ', '  確認用サイト  ');
  assert.equal(h.calls.addLessonLink.length, 1);
  const [cid, lid, id, link, now] = h.calls.addLessonLink[0];
  assert.equal(cid, ids.classId); assert.equal(lid, ids.lessonId); assert.match(id, /^[A-Za-z0-9]{12}$/);
  assert.deepEqual(link, { url: 'https://example.com/', title: '確認用サイト', order: 0 });
  assert.equal(typeof now, 'number');
  assert.equal(rows(h).length, 1);
  assert.equal(field('url').value, ''); assert.equal(field('title').value, '');
  assert.equal(error(h).hidden, true);
  const site = all(rows(h)[0], (node) => node.tagName === 'a')[0];
  assert.equal(site.getAttribute('href'), 'https://example.com/');
  assert.equal(site.getAttribute('target'), '_blank'); assert.equal(site.getAttribute('rel'), 'noopener noreferrer');
});

test('先生: 入力エラーと重複はフォーム直下に出し、保存しない', async (t) => {
  const h = await setup(t, sample); h.open(); await settle();
  for (const [url, title, message] of [
    [' ', '', 'アドレスを入れてください。'], ['http://example.com', '', 'https:// で始まるアドレスを入れてください。'],
    ['javascript:alert(1)', '', 'https:// で始まるアドレスを入れてください。'],
    ['https://a:b@example.com', '', 'https:// で始まるアドレスを入れてください。'],
    ['https://example.com/' + 'x'.repeat(481), '', 'アドレスが長すぎます（500 文字まで）。'],
    ['https://example.org', 'あ'.repeat(61), '名前は 60 文字までです。'],
    [' HTTPS://EXAMPLE.COM ', '別の名前', '同じアドレスが、もう入っています。'],
  ]) {
    await add(h, url, title);
    assert.equal(error(h).textContent, message); assert.equal(error(h).hidden, false);
    assert.equal(error(h).getAttribute('role'), 'alert');
    assert.equal(section(h).children.indexOf(error(h)), section(h).children.findIndex((node) => node.tagName === 'form') + 1);
    assert.equal(h.calls.addLessonLink.length, 0); assert.equal(rows(h).length, 2);
  }
  assertSafe(h.root);
});

test('先生: 8 個までは足せ、壊れた値も数えて 9 個目を止める', async (t) => {
  const links = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`broken${i}`, 3]));
  const h = await setup(t, links); h.open(); await settle();
  await add(h, 'https://example.com/' + 'x'.repeat(480), 'あ'.repeat(60));
  assert.equal(h.calls.addLessonLink.length, 1);
  await add(h, 'https://example.org');
  assert.equal(error(h).textContent, 'リンクは 8 個までです。');
  assert.equal(h.calls.addLessonLink.length, 1);
});

test('先生: 同じ名前でも URL が違えば足せ、最大の順番の次にする', async (t) => {
  const h = await setup(t, { a: { ...sample.a, order: 5 } }); h.open(); await settle();
  await add(h, 'https://example.org', sample.a.title);
  assert.equal(h.calls.addLessonLink[0][3].order, 6);
  assert.equal(rows(h).length, 2);
});

test('先生: 上下の移動、削除の取り消しと実行、1 個の端では移動しない', async (t) => {
  const h = await setup(t, sample); h.open(); await settle();
  assert.equal(buttons(rows(h)[0], '上へ')[0].disabled, true);
  buttons(rows(h)[0], '下へ')[0].click(); await settle();
  assert.deepEqual(h.calls.setLinkOrders[0].slice(0, 3), [ids.classId, ids.lessonId, { b: 0, a: 1 }]);
  assert.match(rows(h)[0].textContent, /確認用サイト/);
  buttons(rows(h)[1], '上へ')[0].click(); await settle();
  assert.match(rows(h)[0].textContent, /確認用動画/);
  buttons(rows(h)[0], '消す')[0].click();
  let dlg = byClass(document.body, 'confirm')[0];
  assert.match(dlg.textContent, /リンクを消しますか？この授業から外します。/);
  buttons(dlg, 'やめる')[0].click(); await settle(); assert.equal(h.calls.removeLessonLink.length, 0);
  buttons(rows(h)[0], '消す')[0].click();
  dlg = byClass(document.body, 'confirm')[0]; buttons(dlg, '消す')[0].click(); await settle();
  assert.deepEqual(h.calls.removeLessonLink[0].slice(0, 3), [ids.classId, ids.lessonId, 'a']);
  assert.equal(rows(h).length, 1);
  for (const text of ['上へ', '下へ']) { const button = buttons(rows(h)[0], text)[0]; assert.equal(button.disabled, true); button.fire('click'); }
  assert.equal(h.calls.setLinkOrders.length, 2);
});

test('先生: 開けない保存データには印と「消す」だけを出す', async (t) => {
  const h = await setup(t, { bad: { url: 'javascript:alert(1)', title: '壊れたリンク', order: 0 },
    title: { ...sample.a, title: null }, order: { ...sample.a, order: -1 } });
  h.open(); await settle();
  assert.equal(rows(h).length, 3);
  for (const row of rows(h)) {
    assert.match(row.textContent, /開けないリンクです（生徒には出ません）/);
    assert.equal(byClass(row, 'chip-warn').length, 1);
    assert.deepEqual(all(row, (node) => node.tagName === 'button').map((node) => node.textContent), ['消す']);
    assert.equal(all(row, (node) => node.tagName === 'a').length, 0);
  }
  assertSafe(h.root);
  buttons(rows(h)[0], '消す')[0].click(); buttons(byClass(document.body, 'confirm')[0], '消す')[0].click(); await settle();
  assert.equal(rows(h).length, 2);
});

test('先生: 通信失敗なら追加・並べ替え・削除の一覧を変えず、追加の入力も残す', async (t) => {
  const h = await setup(t, sample); h.open(); await settle();
  const before = rows(h).map((row) => row.textContent);
  const fail = async () => { throw new Error('確認用の通信失敗'); };
  h.repo.addLessonLink = fail; h.repo.setLinkOrders = fail; h.repo.removeLessonLink = fail;
  await add(h, 'https://example.org', '残す名前');
  assert.equal(error(h).textContent, '足せませんでした。もう一度ためしてください。');
  assert.equal(field('url').value, 'https://example.org'); assert.equal(field('title').value, '残す名前');
  buttons(rows(h)[0], '下へ')[0].click(); await settle();
  assert.match(document.body.textContent, /順番を変えられませんでした。もう一度ためしてください。/);
  buttons(rows(h)[0], '消す')[0].click(); buttons(byClass(document.body, 'confirm')[0], '消す')[0].click(); await settle();
  assert.equal(error(h).textContent, '消せませんでした。もう一度ためしてください。');
  assert.deepEqual(rows(h).map((row) => row.textContent), before);
});

test('先生: 保存中はほかの操作と移動を止め、リンクの書きかけだけでは確認しない', async (t) => {
  const h = await setup(t, sample); h.open(); await settle();
  field('url').value = 'https://example.org'; assert.equal(await h.guard(), true);
  const gate = deferred(); const original = h.repo.addLessonLink;
  h.repo.addLessonLink = async (...args) => { await gate.promise; return original(...args); };
  await add(h, 'https://example.org');
  assert.equal(field('url').disabled, true); assert.equal(buttons(h.root, '保存する')[0].disabled, true);
  assert.equal(buttons(rows(h)[0], '下へ')[0].disabled, true); assert.equal(buttons(h.root, '写真を足す')[0].disabled, true);
  assert.equal(await h.guard(), false);
  assert.equal(window.fire('beforeunload').defaultPrevented, true);
  await add(h, 'https://example.net');
  assert.equal(rows(h).length, 2);
  gate.resolve(); await settle();
  assert.equal(h.calls.addLessonLink.length, 1); assert.equal(rows(h).length, 3); assert.equal(field('url').disabled, false);
});

for (const succeeds of [false, true]) {
  test(`先生: 用語の保存中に移動を始め、${succeeds ? '保存後にこの画面に残る' : '保存に失敗する'}とリンク欄を再び使える`, async (t) => {
    const h = await setup(t, sample); h.open(); await settle();
    assertLinkControls(h, false);
    if (succeeds) document.getElementById('edit-lesson-title').value = '変更した授業名';
    const gate = deferred(); const original = h.repo.addLessonTerm;
    let calls = 0;
    h.repo.addLessonTerm = async (...args) => {
      calls += 1;
      await gate.promise;
      if (!succeeds) throw new Error('確認用の通信失敗');
      return original(...args);
    };
    const form = byClass(h.root, 'term-input-row')[0];
    const input = all(form, (node) => node.tagName === 'input')[0];
    input.value = '慣性'; form.fire('submit');
    assert.equal(calls, 1); assertLinkControls(h, true);
    const leaving = h.guard();
    let answered = false;
    leaving.then(() => { answered = true; });
    await settle();
    assert.equal(answered, false); assert.equal(byClass(document.body, 'confirm').length, 0);
    gate.resolve(); await settle();
    if (succeeds) {
      assert.equal(answered, false); assert.equal(input.value, '');
      assertLinkControls(h, true);
      const dlg = byClass(document.body, 'confirm')[0]; assert.ok(dlg);
      buttons(dlg, 'この画面に残る')[0].click();
    } else {
      assert.match(byClass(h.root, 'lesson-terms')[0].textContent, /保存できませんでした。もう一度ためしてください。/);
      assert.equal(input.value, '慣性');
    }
    assert.equal(await leaving, false);
    assert.equal(byClass(document.body, 'confirm').length, 0);
    assert.equal(input.disabled, false); assertLinkControls(h, false);
  });
}

test('先生: 移動の確認中はリンク欄を止め、この画面に残ると戻す', async (t) => {
  const h = await setup(t, sample); h.open(); await settle();
  document.getElementById('edit-lesson-title').value = '変更した授業名';
  const leaving = h.guard();
  assertLinkControls(h, true);
  buttons(byClass(document.body, 'confirm')[0], 'この画面に残る')[0].click();
  assert.equal(await leaving, false); assertLinkControls(h, false);
});

for (const [name, mount] of [['生徒', mountStudent], ['先生の記録確認', mountRecord]]) {
  test(`${name}: 動画とサイトを資料の下に出し、不正なリンクを隠す。離れると動画を外す`, async (t) => {
    const h = await setup(t, { ...sample, bad: { url: 'javascript:alert(1)', title: '出さない', order: 2 } });
    h.open(mount); await settle();
    const pane = byClass(h.root, 'link-pane')[0]; assert.ok(pane);
    assert.equal(pane.closest('.student-lesson-teacher') !== null, true);
    const area = byClass(h.root, 'lesson-section-body')[0]; assert.equal(area.children[1].children[0], pane);
    const opens = byClass(pane, 'link-open'); assert.equal(opens.length, 2);
    assert.equal(opens[0].tagName, 'button'); assert.equal(opens[0].textContent, '▶ 確認用動画');
    assert.equal(opens[1].tagName, 'a'); assert.equal(opens[1].getAttribute('href'), sample.b.url);
    assert.equal(opens[1].getAttribute('target'), '_blank'); assert.equal(opens[1].getAttribute('rel'), 'noopener noreferrer');
    assert.doesNotMatch(pane.textContent, /出さない/); assertSafe(h.root);
    opens[0].click(); assert.equal(frames().length, 1);
    h.destroy(); h.destroy = null; assert.equal(frames().length, 0);
  });

  test(`${name}: リンクが無ければ見出しを出さない`, async (t) => {
    const h = await setup(t); h.open(mount); await settle();
    assert.equal(byClass(h.root, 'link-pane').length, 0); assert.doesNotMatch(h.root.textContent, /動画・サイト/);
    assert.equal(byClass(h.root, 'lesson-section-body')[0].children[1].hidden, true);
  });
}

test('動画: iframe の属性と別タブのリンク、ボタン・Esc・close の後片づけ', async (t) => {
  await setup(t);
  for (const how of ['button', 'escape', 'api', 'native']) {
    const video = openVideo({ title: '確認用動画', src: embedUrl(watch), pageUrl: watch });
    const dlg = byClass(document.body, 'video-dialog')[0]; const frame = frames()[0];
    assert.equal(dlg.open, true); assert.equal(frame.getAttribute('src'), embedUrl(watch));
    assert.equal(frame.getAttribute('title'), '確認用動画');
    assert.equal(frame.getAttribute('sandbox'), 'allow-scripts allow-same-origin allow-presentation');
    assert.equal(frame.getAttribute('referrerpolicy'), 'strict-origin-when-cross-origin');
    assert.equal(frame.getAttribute('allow'), 'fullscreen; encrypted-media; picture-in-picture');
    assert.equal(frame.getAttribute('allowfullscreen'), ''); assert.equal(frame.getAttribute('loading'), null);
    const fallback = all(dlg, (node) => node.tagName === 'a')[0];
    assert.equal(fallback.getAttribute('href'), watch); assert.equal(fallback.getAttribute('target'), '_blank');
    assert.equal(fallback.getAttribute('rel'), 'noopener noreferrer');
    assert.equal(fallback.textContent, 'うまく再生できないときは、別のタブで開く');
    const remove = dlg.remove.bind(dlg);
    dlg.remove = () => { assert.equal(frame.parentNode, null); remove(); };
    if (how === 'button') buttons(dlg, 'とじる')[0].click();
    else if (how === 'escape') assert.equal(dlg.fire('cancel').defaultPrevented, true);
    else if (how === 'native') dlg.close(); else video.close();
    video.close(); assert.equal(frames().length, 0); assert.equal(dlg.isConnected, false);
  }
  for (const src of ['javascript:alert(1)', 'https://youtube.com/embed/Abcdef12_-3', 'https://www.youtube-nocookie.com.example.org/embed/a', null]) {
    assert.equal(openVideo({ title: '', src, pageUrl: watch }), null);
  }
  const video = openVideo({ title: '', src: embedUrl(watch), pageUrl: 'javascript:alert(1)' });
  assertSafe(document.body); video.close();
});

test('動画: closeAllDialogs で iframe と窓を外し、繰り返し閉じても何も起きない', async (t) => {
  await setup(t);
  for (const how of ['all', 'api', 'button', 'escape', 'native']) {
    const video = openVideo({ title: '確認用動画', src: embedUrl(watch), pageUrl: watch });
    const dlg = byClass(document.body, 'video-dialog')[0]; const frame = frames()[0];
    assert.equal(dlg.tagName, 'dialog'); assert.equal(frames().length, 1);
    let removed = 0;
    const remove = dlg.remove.bind(dlg);
    dlg.remove = () => { removed += 1; assert.equal(frame.parentNode, null); remove(); };
    if (how === 'api') video.close();
    else if (how === 'button') buttons(dlg, 'とじる')[0].click();
    else if (how === 'escape') dlg.fire('cancel');
    else if (how === 'native') dlg.close();
    closeAllDialogs();
    assert.equal(frames().length, 0); assert.equal(byClass(document.body, 'video-dialog').length, 0);
    assert.doesNotThrow(() => { video.close(); closeAllDialogs(); });
    assert.equal(removed, 1);
  }
});

test('ダイアログ: 確認と動画を開く順番にかかわらず、closeAllDialogs で両方閉じる', async (t) => {
  await setup(t);
  for (const videoFirst of [false, true]) {
    const open = () => openVideo({ title: '確認用動画', src: embedUrl(watch), pageUrl: watch });
    let video;
    if (videoFirst) video = open();
    const confirmed = confirmDialog({ title: '確認', body: 'この画面を離れますか？' });
    if (!videoFirst) video = open();
    assert.equal(byClass(document.body, 'confirm').length, 1); assert.equal(frames().length, 1);
    closeAllDialogs();
    assert.equal(await confirmed, false);
    assert.equal(all(document.body, (node) => node.tagName === 'dialog').length, 0);
    assert.equal(frames().length, 0);
    assert.doesNotThrow(() => { video.close(); closeAllDialogs(); });
  }
});

test('ダイアログ: 関数以外は登録せず、登録解除を繰り返しても安全', async (t) => {
  await setup(t);
  for (const close of [null, undefined, false, 0, 'close', {}, []]) {
    const unregister = registerDialog(close);
    assert.equal(typeof unregister, 'function');
    assert.doesNotThrow(() => { closeAllDialogs(); unregister(); unregister(); });
  }
  const calls = [];
  const unregister = registerDialog((...args) => { calls.push(args); });
  closeAllDialogs(); assert.deepEqual(calls, [[]]);
  unregister(); unregister(); closeAllDialogs(); assert.equal(calls.length, 1);
  const unused = registerDialog(() => { calls.push('解除後は呼ばない'); });
  unused(); closeAllDialogs(); assert.equal(calls.length, 1);
});

test('リンク部品: 不正な値しかなければ空の hidden div、destroy は動画とイベントを片づける', async (t) => {
  await setup(t);
  for (const links of [null, 'bad', [], { bad: { url: 'javascript:alert(1)', title: '', order: 0 } }]) {
    const pane = linkPane({ lesson: { links } });
    assert.equal(pane.node.tagName, 'div'); assert.equal(pane.node.hidden, true); assert.equal(pane.node.children.length, 0);
    pane.destroy();
  }
  const pane = linkPane({ lesson: { links: sample } }); document.body.append(pane.node);
  const button = byClass(pane.node, 'link-open')[0]; button.click(); assert.equal(frames().length, 1);
  button.click(); assert.equal(frames().length, 1);
  pane.destroy(); pane.destroy(); assert.equal(frames().length, 0);
  button.click(); assert.equal(frames().length, 0); pane.node.remove();
});

test('先生: ためすで開いた動画は画面を離れると消える', async (t) => {
  const h = await setup(t, sample); h.open(); await settle();
  buttons(rows(h)[0], 'ためす')[0].click(); assert.equal(frames().length, 1);
  h.destroy(); h.destroy = null; assert.equal(frames().length, 0);
});
