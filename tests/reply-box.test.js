// DOM と通信の代役で、返事の入力・失敗・画面を離れた後の結果を確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replyBox } from '../js/views/parts/reply-box.js';
import { installDom, all, byClass, buttons, settle } from './helpers/picture-dom.js';

const ids = { classId: 'TestClass', lessonId: 'TestLesson', studentId: 's26-001' };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const input = (box) => all(box.node, (node) => node.tagName === 'textarea')[0];
const check = (box) => all(box.node, (node) => node.tagName === 'input')[0];
const save = (box) => buttons(box.node, '保存する')[0];
const remove = (box) => buttons(box.node, '返事を取り消す')[0];
const status = (box) => byClass(box.node, 'reply-status')[0].textContent;
const edit = (box, value) => { input(box).value = value; input(box).fire('input'); };
const confirm = (label) => buttons(byClass(document.body, 'confirm')[0], label)[0].click();

function setup(t) {
  const dom = installDom();
  const boxes = [];
  const h = { saved: null, writes: [], removals: [], reads: [] };
  h.ctx = { now: () => 123, repo: {
    async getReply(...args) {
      h.reads.push(args);
      if (h.loadGate) return h.loadGate.promise;
      if (h.loadError) throw new Error('load');
      return h.saved;
    },
    async setReply(...args) {
      h.writes.push(args);
      if (h.writeGate) await h.writeGate.promise;
      if (h.writeError) throw new Error('write');
      h.saved = { ...args[3], updatedAt: args[4] };
    },
    async removeReply(...args) {
      h.removals.push(args);
      if (h.writeGate) await h.writeGate.promise;
      if (h.writeError) throw new Error('remove');
      h.saved = null;
    },
  } };
  h.mount = (options = {}) => {
    const box = replyBox({ ctx: h.ctx, ...ids, ...options });
    document.body.append(box.node); boxes.push(box); return box;
  };
  t.after(() => { boxes.forEach((box) => box.destroy()); dom.restore(); });
  return h;
}

test('読みこみ中は入力を出さず、読めた返事を表示する。同じ中身では保存できない', async (t) => {
  const h = setup(t); h.loadGate = deferred();
  const box = h.mount();
  assert.equal(status(box), '読みこんでいます…');
  assert.equal(input(box), undefined);
  h.loadGate.resolve({ text: '確認用\nの返事', seen: true, updatedAt: 10 }); await settle();
  assert.equal(input(box).value, '確認用\nの返事');
  assert.equal(check(box).checked, true);
  assert.equal(save(box).disabled, true);
  assert.equal(remove(box).hidden, false);
  assert.equal(box.dirty, false);
  assert.deepEqual(h.reads, [[ids.classId, ids.lessonId, ids.studentId]]);
});

test('読みこみに失敗したら入力を出さず、もう一度で復旧する', async (t) => {
  const h = setup(t); h.loadError = true;
  const box = h.mount(); await settle();
  assert.match(box.node.textContent, /返事を読みこめませんでした。/);
  assert.equal(input(box), undefined);
  h.loadError = false;
  buttons(box.node, 'もう一度')[0].click(); await settle();
  assert.equal(input(box).value, '');
  assert.equal(save(box).disabled, true);
  assert.equal(remove(box).hidden, true);
});

test('保存は整えた文を 1 回だけ送り、保存中は操作を止める', async (t) => {
  const h = setup(t); const box = h.mount(); await settle();
  h.writeGate = deferred(); edit(box, ' 返事\nです ');
  assert.equal(box.dirty, true);
  save(box).fire('click'); save(box).fire('click');
  assert.equal(h.writes.length, 1);
  assert.equal(status(box), '保存しています…');
  assert.equal(input(box).disabled, true);
  assert.equal(check(box).disabled, true);
  assert.equal(save(box).disabled, true);
  h.writeGate.resolve(); await settle();
  assert.deepEqual(h.writes[0], [ids.classId, ids.lessonId, ids.studentId, { text: '返事\nです', seen: false }, 123]);
  assert.equal(input(box).value, '返事\nです');
  assert.equal(status(box), '✓ 保存しました（生徒に見えています）');
  assert.equal(box.dirty, false);
  assert.equal(save(box).disabled, true);
});

test('400 文字は保存でき、401 文字の貼りつけは切らずに止める', async (t) => {
  const h = setup(t); const box = h.mount(); await settle();
  edit(box, '😀'.repeat(200) + 'あ');
  assert.equal(input(box).value.length, 401);
  assert.equal(save(box).disabled, true);
  assert.equal(document.getElementById('reply-limit').hidden, false);
  assert.equal(document.getElementById('reply-limit').getAttribute('role'), 'alert');
  assert.equal(document.getElementById('reply-count').textContent, '401 / 400');
  assert.equal(input(box).getAttribute('maxlength'), null);
  save(box).fire('click'); await settle(); assert.equal(h.writes.length, 0);
  edit(box, '😀'.repeat(200));
  assert.equal(document.getElementById('reply-limit').hidden, true);
  save(box).click(); await settle(); assert.equal(h.writes.length, 1);
});

test('文も印もなくしたときは保存できず、印だけなら保存できる', async (t) => {
  const h = setup(t); h.saved = { text: '返事', seen: true, updatedAt: 10 };
  const box = h.mount(); await settle(); edit(box, ' \n　');
  check(box).checked = false; check(box).fire('change');
  assert.equal(save(box).disabled, true);
  assert.equal(box.dirty, true);
  check(box).checked = true; check(box).fire('change');
  assert.equal(save(box).disabled, false);
  save(box).click(); await settle();
  assert.deepEqual(h.saved, { text: '', seen: true, updatedAt: 123 });
});

test('保存失敗で文と印を残し、再試行できる', async (t) => {
  const h = setup(t); h.writeError = true;
  const box = h.mount(); await settle(); edit(box, '残す\n返事');
  check(box).checked = true; check(box).fire('change');
  save(box).click(); await settle();
  assert.equal(input(box).value, '残す\n返事');
  assert.equal(check(box).checked, true);
  assert.equal(box.dirty, true);
  const error = all(box.node, (node) => node.getAttribute('role') === 'alert' && !node.hidden)[0];
  assert.equal(error.textContent, '保存できませんでした。もう一度押してください。');
  assert.equal(save(box).disabled, false);
  h.writeError = false; save(box).click(); await settle();
  assert.equal(box.dirty, false);
});

test('取り消しは確認後だけ送り、成功したら空欄と状態を表示する', async (t) => {
  const h = setup(t); h.saved = { text: '返事', seen: false, updatedAt: 1 };
  const box = h.mount(); await settle(); remove(box).click();
  const dialog = byClass(document.body, 'confirm')[0];
  assert.match(dialog.textContent, /返事を取り消しますか？生徒の画面から、この返事が消えます。/);
  assert.equal(buttons(dialog, '取り消す')[0].classList.contains('btn-danger'), true);
  confirm('やめる'); await settle(); assert.equal(h.removals.length, 0);
  remove(box).click(); confirm('取り消す'); await settle();
  assert.deepEqual(h.removals, [[ids.classId, ids.lessonId, ids.studentId]]);
  assert.equal(status(box), '返事を取り消しました');
  assert.equal(input(box).value, '');
  assert.equal(box.dirty, false);
  assert.equal(remove(box).hidden, true);
});

test('取り消し失敗でも書きかけの文を残す', async (t) => {
  const h = setup(t); h.saved = { text: '保存済み', seen: true, updatedAt: 1 }; h.writeError = true;
  const box = h.mount(); await settle(); edit(box, '書きかけ');
  remove(box).click(); confirm('取り消す'); await settle();
  assert.equal(input(box).value, '書きかけ');
  assert.equal(check(box).checked, true);
  assert.equal(remove(box).hidden, false);
  assert.equal(box.dirty, true);
  assert.match(box.node.textContent, /保存できませんでした。もう一度押してください。/);
});

test('未保存の移動を確認し、もどると文を残す。破棄された確認は移動させない', async (t) => {
  const h = setup(t); const box = h.mount(); await settle();
  assert.equal(await box.okToLeave(), true); edit(box, '書きかけ');
  const pending = box.okToLeave();
  assert.match(byClass(document.body, 'confirm')[0].textContent, /保存していない返事がありますこのまま移ると、書いた返事は消えます。/);
  assert.equal(await box.okToLeave(), false);
  confirm('もどって保存する'); assert.equal(await pending, false);
  assert.equal(input(box).value, '書きかけ');
  const leaving = box.okToLeave(); confirm('移る'); assert.equal(await leaving, true);
  const aborted = box.okToLeave(); box.destroy(); assert.equal(await aborted, false);
  assert.equal(byClass(document.body, 'confirm').length, 0);
});

for (const operation of ['load', 'save', 'remove']) {
  for (const failed of [false, true]) {
    test(`移った後の ${operation} の${failed ? '失敗' : '成功'}を次の生徒に出さない`, async (t) => {
      const h = setup(t); const gate = deferred();
      if (operation === 'load') h.loadGate = gate;
      else h.saved = { text: '前の人', seen: false, updatedAt: 1 };
      const previous = h.mount(); await settle();
      if (operation !== 'load') {
        h.writeGate = gate;
        if (operation === 'save') { edit(previous, '前の人の書きかけ'); save(previous).click(); }
        else { remove(previous).click(); confirm('取り消す'); await settle(); }
      }
      previous.destroy(); previous.node.remove();
      h.loadGate = h.writeGate = null;
      h.saved = { text: '次の人の返事', seen: true, updatedAt: 2 };
      const next = h.mount({ studentId: 's26-002' }); await settle();
      if (failed) gate.reject(new Error('old')); else gate.resolve({ text: '古い返事', seen: false, updatedAt: 1 });
      await settle();
      assert.equal(input(next).value, '次の人の返事');
      assert.equal(check(next).checked, true);
      assert.equal(status(next), '');
      assert.equal(next.dirty, false);
    });
  }
}

test('生徒の返事: 文・印・日付だけ表示し、無いときは箱ごと隠す', async (t) => {
  const h = setup(t);
  h.saved = { text: '<b>確認用</b>\n二行目', seen: true, updatedAt: new Date(2026, 10, 16, 12).getTime() };
  const box = h.mount({ readOnly: true }); await settle();
  assert.equal(box.node.hidden, false);
  assert.equal(byClass(box.node, 'reply-text')[0].textContent, '<b>確認用</b>\n二行目');
  assert.match(box.node.textContent, /✓ 先生が見ました11\/16/);
  assert.equal(all(box.node, (node) => ['textarea', 'input', 'button', 'b'].includes(node.tagName)).length, 0);
  h.saved = null; await box.reload(); assert.equal(box.node.hidden, true);
  h.saved = { text: '', seen: true, updatedAt: 1 }; await box.reload();
  assert.equal(box.node.hidden, false);
  assert.equal(byClass(box.node, 'reply-text').length, 0);
});

test('生徒の読み直し: 失敗後に再試行でき、遅い古い結果は表示しない', async (t) => {
  const h = setup(t); h.loadError = true;
  const box = h.mount({ readOnly: true }); await settle();
  assert.match(box.node.textContent, /先生からの返事を読みこめませんでした。/);
  h.loadError = false; h.saved = { text: '新しい返事', seen: false, updatedAt: 1 };
  buttons(box.node, 'もう一度')[0].click(); await settle();
  assert.match(box.node.textContent, /新しい返事/);
  h.loadGate = deferred(); const old = box.reload(); const gate = h.loadGate;
  h.loadGate = null; h.saved = null; await box.reload();
  gate.resolve({ text: '古い返事', seen: false, updatedAt: 1 }); await old;
  assert.equal(box.node.hidden, true);
});
