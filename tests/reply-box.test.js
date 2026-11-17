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
const stamp = (box) => buttons(box.node, 'スタンプを押す')[0] ?? buttons(box.node, 'スタンプを取り消す')[0];
const stamped = (box) => stamp(box)?.textContent === 'スタンプを取り消す';
const save = (box) => buttons(box.node, '保存する')[0];
const remove = (box) => buttons(box.node, '返事を取り消す')[0];
const status = (box) => byClass(box.node, 'reply-status')[0].textContent;
const edit = (box, value) => { input(box).value = value; input(box).fire('input'); };
const confirm = (label) => buttons(byClass(document.body, 'confirm')[0], label)[0].click();

function setup(t) {
  const dom = installDom();
  const boxes = [];
  const h = { saved: null, writes: [], removals: [], stamps: [], unstamps: [], reads: [] };
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
    async stampReplies(...args) {
      h.stamps.push(args);
      if (h.writeGate) await h.writeGate.promise;
      if (h.writeError) throw new Error('stamp');
      h.saved = { text: h.saved?.text ?? '', seen: true, updatedAt: args[3] };
    },
    async unstampReply(...args) {
      h.unstamps.push(args);
      if (h.writeGate) await h.writeGate.promise;
      if (h.writeError) throw new Error('unstamp');
      h.saved = h.saved?.text ? { ...h.saved, seen: false, updatedAt: args[3] } : null;
      return { reply: h.saved };
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
  assert.equal(stamped(box), true);
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
  assert.equal(stamp(box).disabled, true);
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

test('文を空にして保存しても、スタンプの有無は変わらない', async (t) => {
  const h = setup(t); h.saved = { text: '返事', seen: true, updatedAt: 10 };
  const box = h.mount(); await settle(); edit(box, ' \n　');
  assert.equal(box.dirty, true);
  assert.equal(save(box).disabled, false);
  save(box).click(); await settle();
  assert.deepEqual(h.saved, { text: '', seen: true, updatedAt: 123 });
  stamp(box).click(); await settle();
  assert.equal(save(box).disabled, true);
  assert.equal(h.saved, null);
});

test('保存失敗で文と印を残し、再試行できる', async (t) => {
  const h = setup(t); h.writeError = true;
  h.saved = { text: '', seen: true, updatedAt: 1 };
  const box = h.mount(); await settle(); edit(box, '残す\n返事');
  save(box).click(); await settle();
  assert.equal(input(box).value, '残す\n返事');
  assert.equal(stamped(box), true);
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
  assert.equal(stamped(box), true);
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

for (const operation of ['load', 'save', 'remove', 'stamp', 'unstamp']) {
  for (const failed of [false, true]) {
    test(`移った後の ${operation} の${failed ? '失敗' : '成功'}を次の生徒に出さない`, async (t) => {
      const h = setup(t); const gate = deferred();
      if (operation === 'load') h.loadGate = gate;
      else h.saved = { text: '前の人', seen: operation === 'unstamp', updatedAt: 1 };
      const previous = h.mount(); await settle();
      if (operation !== 'load') {
        h.writeGate = gate;
        if (operation === 'save') { edit(previous, '前の人の書きかけ'); save(previous).click(); }
        else if (operation === 'stamp' || operation === 'unstamp') stamp(previous).click();
        else { remove(previous).click(); confirm('取り消す'); await settle(); }
      }
      previous.destroy(); previous.node.remove();
      h.loadGate = h.writeGate = null;
      h.saved = { text: '次の人の返事', seen: true, updatedAt: 2 };
      const next = h.mount({ studentId: 's26-002' }); await settle();
      if (failed) gate.reject(new Error('old')); else gate.resolve({ text: '古い返事', seen: false, updatedAt: 1 });
      await settle();
      assert.equal(input(next).value, '次の人の返事');
      assert.equal(stamped(next), true);
      assert.equal(status(next), '');
      assert.equal(next.dirty, false);
    });
  }
}

test('生徒の返事: 文と日付だけ表示し、スタンプだけなら箱ごと隠す', async (t) => {
  const h = setup(t);
  h.saved = { text: '<b>確認用</b>\n二行目', seen: true, updatedAt: new Date(2026, 10, 16, 12).getTime() };
  const box = h.mount({ readOnly: true }); await settle();
  assert.equal(box.node.hidden, false);
  assert.equal(byClass(box.node, 'reply-text')[0].textContent, '<b>確認用</b>\n二行目');
  assert.match(box.node.textContent, /11\/16/);
  assert.doesNotMatch(box.node.textContent, /先生が見ました/);
  assert.equal(all(box.node, (node) => ['textarea', 'input', 'button', 'b'].includes(node.tagName)).length, 0);
  h.saved = null; await box.reload(); assert.equal(box.node.hidden, true);
  h.saved = { text: '', seen: true, updatedAt: 1 }; await box.reload();
  assert.equal(box.node.hidden, true);
  assert.equal(byClass(box.node, 'reply-text').length, 0);
});

test('スタンプをすぐ保存し、書きかけと保存済みの文を別々に保つ。連打は 1 回だけ送る', async (t) => {
  const h = setup(t); h.saved = { text: '保存済みの文', seen: false, updatedAt: 1 };
  const box = h.mount(); await settle(); edit(box, 'まだ保存しない\n書きかけ');
  h.writeGate = deferred(); stamp(box).fire('click'); stamp(box).fire('click');
  assert.deepEqual(h.stamps, [[ids.classId, ids.lessonId, [ids.studentId], 123]]);
  assert.equal(h.writes.length, 0);
  assert.equal(stamp(box).disabled, true);
  h.writeGate.resolve(); await settle();
  assert.deepEqual(h.saved, { text: '保存済みの文', seen: true, updatedAt: 123 });
  assert.equal(input(box).value, 'まだ保存しない\n書きかけ');
  assert.equal(box.dirty, true);
  assert.equal(stamped(box), true);
  assert.equal(status(box), 'スタンプを押しました（生徒に見えています）');
  const image = byClass(box.node, 'reply-stamp-image')[0];
  assert.match(image.getAttribute('src'), /^assets\/stamps\/seen-[a-f]\.svg$/);
  assert.equal(image.getAttribute('width'), '56');
  assert.equal(image.getAttribute('alt'), '');
  save(box).click(); await settle();
  assert.equal(h.saved.text, 'まだ保存しない\n書きかけ');
  assert.equal(h.saved.seen, true);
});

for (const savedText of ['', '保存済みの文']) {
  test(`スタンプの取り消しは確認なしで 1 回だけ送り、文${savedText ? 'ありなら文' : 'なしなら削除'}と書きかけを守る`, async (t) => {
    const h = setup(t); h.saved = { text: savedText, seen: true, updatedAt: 1 };
    const box = h.mount(); await settle(); edit(box, '書きかけ');
    h.writeGate = deferred(); stamp(box).fire('click'); stamp(box).fire('click');
    assert.deepEqual(h.unstamps, [[ids.classId, ids.lessonId, ids.studentId, 123]]);
    assert.equal(stamp(box).disabled, true);
    assert.equal(input(box).disabled, true);
    h.writeGate.resolve(); await settle();
    assert.equal(byClass(document.body, 'confirm').length, 0);
    assert.equal(input(box).value, '書きかけ');
    assert.equal(status(box), 'スタンプを取り消しました');
    assert.equal(stamped(box), false);
    assert.deepEqual(h.saved, savedText ? { text: savedText, seen: false, updatedAt: 123 } : null);
    assert.deepEqual(h.unstamps, [[ids.classId, ids.lessonId, ids.studentId, 123]]);
    assert.equal(h.reads.length, 1);
    assert.equal(h.writes.length, 0);
    assert.equal(h.removals.length, 0);
    stamp(box).click(); await settle();
    assert.equal(stamped(box), true);
    assert.equal(h.saved.text, savedText);
    assert.equal(input(box).value, '書きかけ');
  });
}

for (const seen of [false, true]) {
  for (const drafting of [false, true]) {
    test(`スタンプの${seen ? '取り消し' : '保存'}は別の端末で直した文を残す。書きかけ${drafting ? 'あり' : 'なし'}`, async (t) => {
      const h = setup(t); h.saved = { text: '元の文', seen, updatedAt: 1 };
      const box = h.mount(); await settle();
      if (drafting) edit(box, '書きかけ');
      h.saved = { text: '別の端末で直した文', seen, updatedAt: 2 };
      stamp(box).click(); await settle();
      assert.deepEqual(h.saved, { text: '別の端末で直した文', seen: !seen, updatedAt: 123 });
      assert.equal(input(box).value, drafting ? '書きかけ' : '別の端末で直した文');
      assert.equal(stamped(box), !seen);
      assert.equal(box.dirty, drafting);
      assert.equal(h.writes.length, 0);
      assert.equal(h.removals.length, 0);
    });
  }
}

for (const drafting of [false, true]) {
  test(`スタンプだけの返事に別の端末で追加した文を、取り消しの戻り値から表示する。書きかけ${drafting ? 'あり' : 'なし'}`, async (t) => {
    const h = setup(t); h.saved = { text: '', seen: true, updatedAt: 1 };
    const box = h.mount(); await settle();
    if (drafting) edit(box, '書きかけ');
    h.saved = { text: '別の端末で追加した文', seen: true, updatedAt: 2 };
    h.loadError = true;
    stamp(box).click(); await settle();
    assert.deepEqual(h.unstamps, [[ids.classId, ids.lessonId, ids.studentId, 123]]);
    assert.deepEqual(h.saved, { text: '別の端末で追加した文', seen: false, updatedAt: 123 });
    assert.equal(h.reads.length, 1);
    assert.equal(input(box).value, drafting ? '書きかけ' : '別の端末で追加した文');
    assert.equal(stamped(box), false);
    assert.equal(remove(box).hidden, false);
    assert.equal(box.dirty, drafting);
    assert.equal(status(box), 'スタンプを取り消しました');
    assert.equal(byClass(box.node, 'error').filter((node) => !node.hidden).length, 0);
    edit(box, '別の端末で追加した文');
    assert.equal(box.dirty, false);
    assert.equal(save(box).disabled, true);
  });

  test(`文ありの取り消し前に返事ごと消えても成功し、空の状態に合わせる。書きかけ${drafting ? 'あり' : 'なし'}`, async (t) => {
    const h = setup(t); h.saved = { text: '保存済み', seen: true, updatedAt: 1 };
    const box = h.mount(); await settle();
    if (drafting) edit(box, '書きかけ');
    h.saved = null;
    stamp(box).click(); await settle();
    assert.deepEqual(h.unstamps, [[ids.classId, ids.lessonId, ids.studentId, 123]]);
    assert.equal(h.reads.length, 1);
    assert.equal(h.saved, null);
    assert.equal(stamped(box), false);
    assert.equal(remove(box).hidden, true);
    assert.equal(input(box).value, drafting ? '書きかけ' : '');
    assert.equal(box.dirty, drafting);
    assert.equal(status(box), 'スタンプを取り消しました');
    assert.equal(byClass(box.node, 'error').filter((node) => !node.hidden).length, 0);
    stamp(box).click(); await settle();
    assert.equal(stamped(box), true);
    assert.equal(h.saved.text, '');
  });
}

test('スタンプ後の読み直しにも失敗したら、書きかけを残して再試行できる', async (t) => {
  const h = setup(t); h.saved = { text: '保存済み', seen: false, updatedAt: 1 };
  const box = h.mount(); await settle(); edit(box, '書きかけ');
  h.loadError = true;
  stamp(box).click(); await settle();
  assert.equal(input(box).value, '書きかけ');
  assert.equal(stamp(box).disabled, false);
  assert.equal(status(box), '');
  assert.match(box.node.textContent, /保存できませんでした。もう一度押してください。/);
  h.loadError = false;
  stamp(box).click(); await settle();
  assert.equal(stamped(box), true);
  assert.equal(h.saved.text, '保存済み');
  assert.equal(input(box).value, '書きかけ');
});

test('スタンプ後の読み直しを待つ間に移っても、次の生徒に結果を出さない', async (t) => {
  const h = setup(t); h.saved = { text: '前の人', seen: false, updatedAt: 1 };
  const previous = h.mount(); await settle();
  const gate = deferred(); h.loadGate = gate;
  stamp(previous).click(); await settle();
  assert.equal(stamp(previous).disabled, true);
  previous.destroy(); previous.node.remove(); h.loadGate = null;
  h.saved = { text: '次の人の返事', seen: false, updatedAt: 2 };
  const next = h.mount({ studentId: 's26-002' }); await settle();
  gate.resolve({ text: '前の人', seen: true, updatedAt: 123 }); await settle();
  assert.equal(input(next).value, '次の人の返事');
  assert.equal(stamped(next), false);
  assert.equal(status(next), '');
  assert.equal(next.dirty, false);
});

for (const seen of [false, true]) {
  test(`スタンプの${seen ? '取り消し' : '保存'}失敗でも書きかけと保存済みの状態を保ち、再試行できる`, async (t) => {
    const h = setup(t); h.saved = { text: '保存済み', seen, updatedAt: 1 }; h.writeError = true;
    const box = h.mount(); await settle(); edit(box, 'あ'.repeat(401));
    stamp(box).click(); await settle();
    assert.equal(input(box).value, 'あ'.repeat(401));
    assert.equal(stamped(box), seen);
    assert.match(box.node.textContent, /保存できませんでした。もう一度押してください。/);
    h.writeError = false; stamp(box).click(); await settle();
    assert.equal(stamped(box), !seen);
    assert.equal(h.saved.text, '保存済み');
    assert.equal(input(box).value, 'あ'.repeat(401));
    assert.equal(save(box).disabled, true);
  });
}

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
