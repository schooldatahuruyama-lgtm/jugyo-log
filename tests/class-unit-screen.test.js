import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mount as teacherMount } from '../js/views/teacher-classes.js';
import { mount as studentMount } from '../js/views/student-home.js';
import { installDom, all, byClass, buttons, settle } from './helpers/picture-dom.js';

const classes = [
  { id: 'c1', year: 2026, name: '確認用クラス1', number: 1 },
  { id: 'c2', year: 2025, name: '確認用クラス2', number: 2 },
  { id: 'c3', year: 2024, name: '確認用クラス3', number: 3 },
];
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

function setup(t, teacher, extra = {}) {
  const dom = installDom();
  const root = document.createElement('div'); document.body.append(root);
  const writes = [], reads = [];
  const repo = {
    listClasses: async () => classes, listStudents: async () => [],
    listClassUnits: async () => ({ c1: 'light', c3: 'unknown-unit' }),
    setClassUnit: async (...args) => { writes.push(args); },
    myClasses: async () => classes, listLessons: async () => [], listUnits: async () => [],
    getMarks: async () => ({}), getMyTerms: async () => ({}), getReplyMarks: async () => ({}),
    getClassUnit: async (id) => { reads.push(id); return { c1: 'light', c2: 'weather' }[id] ?? null; },
    ...extra,
  };
  const h = { root, repo, writes, reads, destroy: null };
  const ctx = {
    repo, auth: {}, session: { studentId: 'TestStudent' }, now: () => 1000, random: () => 0.2,
    drafts: { list: () => [] }, inkDrafts: { list: () => [] }, thumbs: { load: async () => ({}) },
    setLeaveGuard: () => {}, navigate: async (name, params) => { h.open(params); return 'moved'; },
  };
  h.open = (params = {}) => { h.destroy?.(); h.destroy = (teacher ? teacherMount : studentMount)(root, { ...ctx, params }); };
  t.after(() => { h.destroy?.(); root.remove(); dom.restore(); });
  h.open();
  return h;
}

function form(root) { return all(root, (node) => node.tagName === 'form')[0]; }
function choose(root, value) {
  const current = form(root);
  all(current, (node) => node.tagName === 'select')[0].value = value;
  current.fire('submit');
}
function unitLines(root) { return byClass(root, 'rika-entry-unit').map((node) => node.textContent); }
function checkCard(root) { assert.equal(byClass(root, 'rika-entry').length, 1); }

test('先生: 決めた単元・未設定・教材にない単元を、クラスごとに表示する', async (t) => {
  const h = setup(t, true); await settle();
  const rows = byClass(h.root, 'class-row');
  assert.equal(rows.length, 3);
  assert.match(rows[0].textContent, /理科クエストの単元: 1年 光の世界/);
  assert.match(rows[1].textContent, /理科クエストの単元: 決めていません（生徒が選びます）/);
  assert.match(rows[2].textContent, /教材にない単元です（unknown-unit）。生徒の側では、決めていないのと同じになります。/);
  assert.match(rows[2].textContent, /要確認/);
  for (let i = 0; i < rows.length; i++) assert.equal(buttons(rows[i], '単元を決める')[0].getAttribute('aria-label'),
    `${classes[i].name} の理科クエストの単元を決める`);
});

test('先生: 学年ごとの選択欄を開き、同じ値は書かず、変更・解除を行に反映する', async (t) => {
  const h = setup(t, true); await settle();
  buttons(h.root, '単元を決める')[0].click();
  const select = all(form(h.root), (node) => node.tagName === 'select')[0];
  assert.equal(select.value, 'light');
  assert.equal(all(select, (node) => node.tagName === 'option').length, 21);
  assert.deepEqual(all(select, (node) => node.tagName === 'optgroup').map((node) => node.getAttribute('label')), ['1年', '2年', '3年']);
  assert.equal(select.children[0].textContent, '決めない（生徒が選ぶ）');
  assert.match(form(h.root).textContent, /生徒は、ほかの単元も進められます。/);
  choose(h.root, 'light'); await settle();
  assert.equal(form(h.root), undefined);
  assert.deepEqual(h.writes, []);
  buttons(h.root, '単元を決める')[0].click(); choose(h.root, 'weather'); await settle();
  assert.deepEqual(h.writes, [['c1', 'weather']]);
  assert.match(byClass(h.root, 'class-row')[0].textContent, /2年 天気とその変化/);
  assert.equal(form(h.root), undefined);
  buttons(h.root, '単元を決める')[0].click(); choose(h.root, ''); await settle();
  assert.deepEqual(h.writes.at(-1), ['c1', null]);
  assert.match(byClass(h.root, 'class-row')[0].textContent, /決めていません/);
  buttons(h.root, '単元を決める')[0].click(); choose(h.root, ''); await settle();
  assert.equal(h.writes.length, 2);
});

test('先生: 教材にない id は「決めない」で開き、保存すると削除する', async (t) => {
  const h = setup(t, true); await settle();
  buttons(h.root, '単元を決める')[2].click();
  assert.equal(all(form(h.root), (node) => node.tagName === 'select')[0].value, '');
  choose(h.root, ''); await settle();
  assert.deepEqual(h.writes, [['c3', null]]);
  assert.doesNotMatch(byClass(h.root, 'class-row')[2].textContent, /要確認|教材にない/);
});

test('先生: 保存失敗は form を残し、赤い文を出して再試行できる', async (t) => {
  const gate = deferred();
  const h = setup(t, true, { setClassUnit: async () => { await gate.promise; throw new Error('確認用'); } }); await settle();
  buttons(h.root, '単元を決める')[0].click();
  const current = form(h.root);
  choose(h.root, 'sound'); await settle();
  assert.ok(buttons(h.root, '単元を決める').every((button) => button.disabled));
  gate.resolve(); await settle();
  assert.equal(form(h.root), current);
  assert.ok(buttons(h.root, '単元を決める').every((button) => !button.disabled));
  const error = byClass(current, 'error')[0];
  assert.equal(error.hidden, false); assert.equal(error.getAttribute('role'), 'alert');
  assert.equal(error.textContent, 'つながりません。もう一度ためしてください。');
  assert.match(byClass(h.root, 'class-row')[0].textContent, /光の世界/);
  h.repo.setClassUnit = async (...args) => h.writes.push(args);
  choose(h.root, 'sound'); await settle();
  assert.equal(form(h.root), undefined);
  assert.deepEqual(h.writes, [['c1', 'sound']]);
});

test('先生: 保存中は全クラスの単元ボタンを止め、完了後に元の単元へ戻せる', async (t) => {
  const gate = deferred();
  const h = setup(t, true, { setClassUnit: async (...args) => { h.writes.push(args); await gate.promise; } });
  await settle();
  buttons(h.root, '単元を決める')[0].click();
  const current = form(h.root);
  choose(h.root, 'sound'); await settle();
  assert.deepEqual(h.writes, [['c1', 'sound']]);
  for (const button of buttons(h.root, '単元を決める')) {
    assert.equal(button.disabled, true);
    button.click();
    assert.equal(form(h.root), current);
  }
  buttons(current, 'やめる')[0].click();
  for (const button of buttons(h.root, '単元を決める')) {
    button.click();
    assert.equal(form(h.root), undefined);
  }
  gate.resolve(); await settle();
  assert.ok(buttons(h.root, '単元を決める').every((button) => !button.disabled));
  assert.match(byClass(h.root, 'class-row')[0].textContent, /音の世界/);
  buttons(h.root, '単元を決める')[0].click();
  assert.equal(all(form(h.root), (node) => node.tagName === 'select')[0].value, 'sound');
  choose(h.root, 'light'); await settle();
  assert.deepEqual(h.writes, [['c1', 'sound'], ['c1', 'light']]);
  assert.match(byClass(h.root, 'class-row')[0].textContent, /光の世界/);
});

for (const retryPending of [false, true]) {
  test(`先生: 単元の読みこみ${retryPending ? '再試行中' : '失敗後'}は決定を止め、読み直せたら解除できる`, async (t) => {
    const read = deferred(), retry = deferred();
    const h = setup(t, true, { renameClass: async () => {} }); await settle();
    h.repo.listClassUnits = async () => { await read.promise; throw new Error('確認用'); };
    buttons(h.root, '名前を変える')[0].click(); form(h.root).fire('submit'); await settle();
    buttons(h.root, '単元を決める')[0].click();
    const current = form(h.root);
    read.resolve(); await settle();
    assert.equal(form(h.root), current);
    assert.equal(byClass(h.root, 'class-unit').length, 0);
    assert.equal(buttons(h.root, '単元を決める').length, 0);
    const message = byClass(h.root, 'class-unit-message')[0];
    h.repo.listClassUnits = () => retry.promise;
    if (retryPending) { buttons(message, 'もう一度')[0].click(); await settle(); }
    for (const selected of ['', 'sound']) {
      choose(h.root, selected); await settle();
      assert.deepEqual(h.writes, []);
      assert.equal(form(h.root), current);
      const error = byClass(current, 'error')[0];
      assert.equal(error.hidden, false); assert.equal(error.getAttribute('role'), 'alert');
      assert.equal(error.textContent, '理科クエストの単元を読みこめていません。この窓をとじて、「もう一度」を押してください。');
    }
    buttons(current, 'やめる')[0].click();
    assert.equal(form(h.root), undefined);
    if (!retryPending) { buttons(message, 'もう一度')[0].click(); await settle(); }
    assert.equal(byClass(h.root, 'class-unit').length, 0);
    assert.equal(buttons(h.root, '単元を決める').length, 0);
    retry.resolve({ c1: 'light' }); await settle();
    assert.equal(message.textContent, '');
    assert.equal(buttons(h.root, '単元を決める').length, 3);
    buttons(h.root, '単元を決める')[0].click(); choose(h.root, ''); await settle();
    assert.deepEqual(h.writes, [['c1', null]]);
    assert.equal(form(h.root), undefined);
    assert.match(byClass(h.root, 'class-row')[0].textContent, /決めていません/);
  });
}

for (const selected of ['light', 'sound']) {
  test(`先生: 窓を開いたあとに単元が変わったら、決定時の値と ${selected} を比べる`, async (t) => {
    const gate = deferred();
    const h = setup(t, true, { renameClass: async () => {} }); await settle();
    h.repo.listClassUnits = () => gate.promise;
    buttons(h.root, '名前を変える')[0].click(); form(h.root).fire('submit'); await settle();
    buttons(h.root, '単元を決める')[0].click();
    const current = form(h.root);
    assert.equal(all(current, (node) => node.tagName === 'select')[0].value, 'light');
    gate.resolve({ c1: 'sound' }); await settle();
    assert.equal(form(h.root), current);
    assert.match(byClass(h.root, 'class-row')[0].textContent, /音の世界/);
    choose(h.root, selected); await settle();
    assert.deepEqual(h.writes, selected === 'light' ? [['c1', 'light']] : []);
    assert.equal(form(h.root), undefined);
  });
}

for (const readFirst of [true, false]) {
  test(`先生: 保存${readFirst ? '中' : '後'}の古い読みこみで、送った単元を戻さない`, async (t) => {
    const read = deferred(), save = deferred();
    const h = setup(t, true, { renameClass: async () => {}, setClassUnit: () => save.promise }); await settle();
    h.repo.listClassUnits = () => read.promise;
    buttons(h.root, '名前を変える')[0].click(); form(h.root).fire('submit'); await settle();
    buttons(h.root, '単元を決める')[0].click(); choose(h.root, 'sound'); await settle();
    if (readFirst) {
      read.resolve({ c1: 'light' }); await settle();
      assert.ok(buttons(h.root, '単元を決める').every((button) => button.disabled));
    }
    save.resolve(); await settle();
    read.resolve({ c1: 'light' }); await settle();
    assert.match(byClass(h.root, 'class-row')[0].textContent, /音の世界/);
    assert.ok(buttons(h.root, '単元を決める').every((button) => !button.disabled));
  });
}

for (const fails of [false, true]) {
  test(`先生: 画面を離れた後の保存${fails ? '失敗' : '成功'}で画面やボタンを変えない`, async (t) => {
    const gate = deferred();
    const h = setup(t, true, { setClassUnit: async () => { await gate.promise; if (fails) throw new Error('確認用'); } });
    await settle();
    buttons(h.root, '単元を決める')[0].click(); choose(h.root, 'sound'); await settle();
    const before = h.root.textContent;
    const current = form(h.root);
    h.destroy();
    gate.resolve(); await settle();
    assert.equal(h.root.textContent, before);
    assert.equal(form(h.root), current);
    assert.equal(byClass(current, 'error')[0].hidden, true);
    assert.ok(buttons(h.root, '単元を決める').every((button) => button.disabled));
  });
}

test('先生: 単元の読みこみ失敗でもクラスを表示し、もう一度で単元とボタンが戻る', async (t) => {
  const h = setup(t, true, { listClassUnits: async () => { throw new Error('確認用'); } }); await settle();
  assert.equal(byClass(h.root, 'class-row').length, 3);
  assert.equal(byClass(h.root, 'class-unit').length, 0);
  assert.equal(buttons(h.root, '単元を決める').length, 0);
  const message = byClass(h.root, 'class-unit-message')[0];
  assert.equal(byClass(message, 'error')[0].getAttribute('role'), 'alert');
  assert.match(message.textContent, /理科クエストの単元を読みこめませんでした。/);
  h.repo.listClassUnits = async () => ({ c1: 'light' });
  buttons(message, 'もう一度')[0].click(); await settle();
  assert.equal(message.textContent, '');
  assert.equal(buttons(h.root, '単元を決める').length, 3);
});

test('先生: クラスが 0 個なら従来の案内だけを表示する', async (t) => {
  const h = setup(t, true, { listClasses: async () => [] }); await settle();
  assert.match(h.root.textContent, /まだクラスがありません/);
  assert.equal(byClass(h.root, 'class-unit').length, 0);
});

test('生徒: カードの説明の下に今の単元を表示し、年度を切りかえる', async (t) => {
  const h = setup(t, false); await settle(); checkCard(h.root);
  assert.deepEqual(unitLines(h.root), ['今の単元: 1年 光の世界']);
  const text = byClass(h.root, 'rika-entry-text')[0];
  assert.equal(text.children[2], byClass(h.root, 'rika-entry-unit')[0]);
  const select = all(h.root, (node) => node.tagName === 'select')[0];
  select.value = 'c2'; select.fire('change');
  assert.deepEqual(unitLines(h.root), []);
  await settle(); checkCard(h.root);
  assert.deepEqual(unitLines(h.root), ['今の単元: 2年 天気とその変化']);
  assert.deepEqual(h.reads, ['c1', 'c2']);
});

for (const [label, getClassUnit] of [
  ['未設定', async () => null], ['教材にない', async () => 'unknown-unit'],
  ['読めない', async () => { throw new Error('確認用'); }], ['repo に機能がない', undefined],
]) {
  test(`生徒: ${label}ときは単元行だけを出さず、カードと授業一覧は残る`, async (t) => {
    const h = setup(t, false, { getClassUnit }); await settle(); checkCard(h.root);
    assert.deepEqual(unitLines(h.root), []);
    assert.doesNotMatch(h.root.textContent, /一部を読みこめませんでした/);
    assert.match(h.root.textContent, /まだ授業がありません/);
  });
}

test('生徒: クラス未所属では単元を読まずカードだけを出す', async (t) => {
  const h = setup(t, false, { myClasses: async () => [] }); await settle(); checkCard(h.root);
  assert.deepEqual(h.reads, []); assert.deepEqual(unitLines(h.root), []);
});

test('生徒: 年度切りかえ前の遅い応答は、今の単元を戻さない', async (t) => {
  const gate = deferred();
  const h = setup(t, false, { getClassUnit: (id) => id === 'c1' ? gate.promise : Promise.resolve('weather') });
  await settle();
  const select = all(h.root, (node) => node.tagName === 'select')[0];
  select.value = 'c2'; select.fire('change'); await settle();
  assert.deepEqual(unitLines(h.root), ['今の単元: 2年 天気とその変化']);
  gate.resolve('light'); await settle(); checkCard(h.root);
  assert.deepEqual(unitLines(h.root), ['今の単元: 2年 天気とその変化']);
});
