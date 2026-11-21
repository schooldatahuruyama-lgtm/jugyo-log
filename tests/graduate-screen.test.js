import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mount } from '../js/views/teacher-graduates.js';
import { mount as classesMount } from '../js/views/teacher-classes.js';
import { mount as rosterMount } from '../js/views/teacher-roster.js';
import { createRepo } from '../js/repo.js';
import { createMemoryNet } from '../js/dev/memory-net.js';
import { NetError } from '../js/errors.js';
import { PROBE_ID } from '../js/rules-probe.js';
import { closeAllDialogs } from '../js/ui.js';
import { installDom, all, byClass, buttons, settle } from './helpers/picture-dom.js';

const DAY = 86400000;
const now = 40 * DAY;
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const student = { id: 's26-001', uid: 'test1' };

function setup(t, { removed = {}, students = { [student.id]: { uid: student.uid } }, extra = {}, view = mount, initial = {} } = {}) {
  const dom = installDom();
  const root = document.createElement('div'); document.body.append(root);
  const mem = createMemoryNet({ initial: { students, removed, ...initial } });
  const repo = { ...createRepo(mem), ...extra };
  const h = { root, mem, repo, time: now, navigate: [], calls: [], guard: null, destroy: null };
  const ctx = { repo, files: { trashStudents: async (ids) => ({ trashed: ids.length, missing: 0, skipped: 0 }) },
    auth: {}, now: () => h.time, random: () => 0.2, params: { classId: 'c1' },
    navigate: async (name) => h.navigate.push(name), setLeaveGuard: (fn) => { h.guard = fn; } };
  h.ctx = ctx;
  h.open = () => { h.destroy?.(); h.destroy = view(root, ctx); };
  h.open();
  t.after(async () => { h.destroy?.(); closeAllDialogs(); await settle(); root.remove(); dom.restore(); });
  return h;
}
const form = (root) => all(root, (n) => n.tagName === 'form')[0];
const input = (root) => all(root, (n) => n.tagName === 'input')[0];
function year(root, value) { const field = input(root); field.value = value; field.fire('input'); }

test('使用中・消してある学年の表示、年度入力の確認と消す・もどす', async (t) => {
  const h = setup(t, { students: { 's26-001': { uid: 'test1' }, 's25-001': {}, [PROBE_ID]: {} }, removed: { 's25-001': { removedAt: now } } });
  await settle();
  assert.doesNotMatch(h.root.textContent, /2000 年度入学/);
  assert.match(h.root.textContent, /2026 年度入学生徒 1 人✓使用中/);
  assert.match(h.root.textContent, /消してあります（1 人）。あと 30 日は、もどせます。/);
  buttons(h.root, 'この学年の記録を消す')[0].click();
  assert.match(form(h.root).textContent, /ログインできなくなります。30 日の間は/);
  for (const value of ['', ' ', '2025', '20 26', '2026年']) {
    year(h.root, value); assert.equal(buttons(h.root, '消す')[0].disabled, true);
  }
  for (const value of ['2026', '２０２６', ' ２０２６　']) {
    year(h.root, value); assert.equal(buttons(h.root, '消す')[0].disabled, false);
  }
  form(h.root).fire('submit'); await settle();
  assert.deepEqual(await h.mem.get('removed/s26-001'), { uid: 'test1', removedAt: now });
  assert.equal(await h.mem.get('accounts/test1'), null);
  assert.equal(form(h.root), undefined);
  buttons(h.root, 'もどす')[0].click(); await settle();
  assert.equal(await h.mem.get('removed/s26-001'), null);
  assert.equal(await h.mem.get('accounts/test1'), student.id);
});

test('台帳に確認用の生徒だけなら、卒業の画面は生徒なしと表示する', async (t) => {
  const h = setup(t, { students: { [PROBE_ID]: { createdAt: 1 } } });
  await settle();
  assert.match(h.root.textContent, /まだ生徒がいません。/);
  assert.equal(byClass(h.root, 'graduate-row').length, 0);
  assert.equal(buttons(h.root, 'この学年の記録を消す').length, 0);
  assert.deepEqual(await h.mem.get(`students/${PROBE_ID}`), { createdAt: 1 });
});

for (const [name, view] of [['卒業', mount], ['クラス', classesMount]]) {
  for (const inStudents of [true, false]) test(`${name}: 30 日をすぎた確認用の生徒は表示も完全削除もしない（台帳 ${inStudents}）`, async (t) => {
    const calls = [];
    const h = setup(t, { view, students: inStudents ? { [PROBE_ID]: { createdAt: 1 } } : {},
      removed: { [PROBE_ID]: { removedAt: 0 } } });
    for (const method of ['markPurging', 'purgeStudent']) {
      const original = h.repo[method];
      h.repo[method] = async (...args) => { calls.push(method); return original(...args); };
    }
    h.ctx.files.trashStudents = async () => { calls.push('file'); return { trashed: 0, missing: 0, skipped: 0 }; };
    const before = h.mem.dump();
    await settle();
    assert.doesNotMatch(h.root.textContent, /2000 年度入学|消してから 30 日をすぎた学年があります|完全に消しています/);
    assert.equal(buttons(h.root, '卒業の画面へ').length, 0);
    assert.equal(buttons(h.root, '続きから消す').length, 0);
    assert.equal(buttons(h.root, 'この学年の記録を消す').length, 0);
    if (view === mount) assert.match(h.root.textContent, /まだ生徒がいません。/);
    assert.deepEqual(calls, []);
    assert.deepEqual(h.mem.dump(), before);
  });
}

test('読み取り後の出し直しで消せなければ名簿を読み直して案内し、押し直すと新しい uid で消す', async (t) => {
  const h = setup(t, { initial: { accounts: { test1: student.id } } });
  await settle();
  const remove = h.repo.removeStudents, listStudents = h.repo.listStudents;
  const attempts = [];
  let reads = 0, reissued;
  h.repo.listStudents = async () => { reads++; return listStudents(); };
  h.repo.removeStudents = async (list, time) => {
    attempts.push(list.map((s) => s.uid));
    if (attempts.length === 1) {
      await h.repo.linkAccount(student.id, { uid: 'test2', generation: 2, password: 'test-value' }, 'test1');
      reissued = h.mem.dump();
      throw new NetError('denied');
    }
    return remove(list, time);
  };
  buttons(h.root, 'この学年の記録を消す')[0].click(); year(h.root, '2026');
  form(h.root).fire('submit'); await settle();
  assert.equal(reads, 2);
  assert.deepEqual(h.mem.dump(), reissued);
  assert.equal(await h.mem.get('removed'), null);
  assert.equal(await h.mem.get('accounts/test2'), student.id);
  assert.match(h.root.textContent, /名簿が変わっていたので、消しませんでした。もう一度『この学年の記録を消す』を押してください。/);
  assert.equal(form(h.root), undefined);
  buttons(h.root, 'この学年の記録を消す')[0].click();
  assert.equal(input(h.root).value, '');
  year(h.root, '2026'); form(h.root).fire('submit'); await settle();
  assert.deepEqual(attempts, [['test1'], ['test2']]);
  assert.equal(await h.mem.get('accounts/test2'), null);
  assert.deepEqual(await h.mem.get(`removed/${student.id}`), { uid: 'test2', removedAt: now });
  assert.doesNotMatch(h.root.textContent, /名簿が変わっていたので/);
});

test('アカウント未発行の生徒も年度を確かめて消せる', async (t) => {
  const h = setup(t, { students: { [student.id]: { createdAt: 1 } } });
  await settle(); buttons(h.root, 'この学年の記録を消す')[0].click(); year(h.root, '2026');
  form(h.root).fire('submit'); await settle();
  assert.deepEqual(await h.mem.get(`removed/${student.id}`), { removedAt: now });
  assert.equal(await h.mem.get('accounts'), null);
  assert.match(h.root.textContent, /消してあります（1 人）/);
});

test('開いたときに新しい学年から順に消す。写真より先に記録を消さず、通信中は止めるだけ押せる', async (t) => {
  const gate = deferred(), calls = [];
  const h = setup(t, { students: { 's26-001': { uid: 'test1' }, 's25-001': {} },
    removed: { 's26-001': { removedAt: 0, uid: 'test1' }, 's25-001': { removedAt: 0 } },
    initial: { classes: { c1: { year: 2026 } }, memberOf: { 's26-001': { c1: true } }, lessons: { c1: { l1: { createdAt: 1 } } },
      records: { c1: { l1: { 's26-001': { attachments: { a1: { type: 'image', fileId: 'photo', bytes: 1, addedAt: 1 } } } } } } } });
  h.ctx.files.trashStudents = async () => { calls.push('file'); await gate.promise; return { trashed: 1, missing: 0, skipped: 0 }; };
  const purge = h.repo.purgeStudent;
  h.repo.purgeStudent = async (...args) => { calls.push(args[0].id); return purge(...args); };
  await settle();
  assert.match(h.root.textContent, /30 日をすぎました。完全に消しています… 授業 0 \/ 1、生徒 0 \/ 1 人/);
  assert.ok(all(h.root, (n) => n.tagName === 'button' && n.textContent !== '止める').every((n) => n.disabled));
  assert.ok(await h.mem.get('records/c1/l1/s26-001'));
  gate.resolve(); await settle();
  assert.deepEqual(calls, ['file', 's26-001', 's25-001']);
  assert.equal(await h.mem.get('removed'), null);
  assert.match(h.root.textContent, /まだ生徒がいません。/);
});

test('止めると次の通信に進まず、続きから消せる。混在学年の使用中・復元可能な生徒は残す', async (t) => {
  const gate = deferred();
  const h = setup(t, { students: { 's26-001': { uid: 'test1' }, 's26-002': { createdAt: 1 }, 's26-003': { createdAt: 1 } },
    removed: { 's26-001': { removedAt: 0, uid: 'test1' }, 's26-002': { removedAt: now } },
    extra: { listMemberOf: async () => { await gate.promise; return {}; } } });
  await settle(); buttons(h.root, '止める')[0].click();
  assert.equal(buttons(h.root, '止める')[0].disabled, true);
  gate.resolve(); await settle();
  assert.ok(await h.mem.get('students/s26-001'));
  assert.match(h.root.textContent, /完全に消すのを止めました/);
  assert.equal(buttons(h.root, 'もどす').length, 1);
  assert.equal(buttons(h.root, 'この学年の記録を消す').length, 1);
  buttons(h.root, '続きから消す')[0].click(); await settle();
  assert.equal(await h.mem.get('students/s26-001'), null);
  assert.ok(await h.mem.get('students/s26-002')); assert.ok(await h.mem.get('students/s26-003'));
});

test('離れる確認で取り消せる。画面を離れたら止め、開き直しは前の通信が終わるのを待つ', async (t) => {
  const gate = deferred();
  let reads = 0;
  const h = setup(t, { removed: { 's26-001': { removedAt: 0, uid: 'test1' } },
    extra: { listMemberOf: async () => { reads++; await gate.promise; return {}; } } });
  await settle();
  const asked = h.guard();
  assert.match(document.body.textContent, /離れると止まります（次に開くと、続きから消します）/);
  buttons(document.body, 'この画面に残る')[0].click(); assert.equal(await asked, false);
  h.open(); await settle(); assert.equal(reads, 1);
  gate.resolve(); await settle();
  assert.equal(reads, 2);
  assert.equal(await h.mem.get('students/s26-001'), null);
});

const errors = [
  ['files', '写真・PDF を消せなかったので、止めました。学校の回線では消せないことがあります。家などの回線で、この画面をもう一度開いてください。'],
  ['skipped', '消してよい生徒かどうかを確かめられなかったファイルがあったので、止めました。もう一度ためしても同じときは、Claude Code に伝えてください。'],
  ['denied', 'データベースの規則が古いため、消せませんでした。規則を入れ直してください。'],
  ['network', 'つながりません。電波を確かめて、もう一度ためしてください。'],
];
for (const [code, message] of errors) test(`完全な削除が ${code} で失敗した理由を表示する`, async (t) => {
  const h = setup(t, { removed: { 's26-001': { removedAt: 0 } }, extra: { listMemberOf: async () => { throw new NetError(code); } } });
  await settle();
  assert.ok(h.root.textContent.includes(message));
  assert.equal(buttons(h.root, '続きから消す')[0].disabled, false);
  assert.ok(await h.mem.get('students/s26-001'));
});

test('消す・もどすの通信中はほかの操作を押せない', async (t) => {
  const gate = deferred();
  const h = setup(t, { extra: { removeStudents: async () => gate.promise } });
  await settle(); buttons(h.root, 'この学年の記録を消す')[0].click(); year(h.root, '2026');
  form(h.root).fire('submit'); await settle();
  assert.ok(all(h.root, (n) => n.tagName === 'button').every((n) => n.disabled));
  gate.resolve(); await settle();
  await h.mem.set('removed/s26-001', { removedAt: now, uid: 'test1' });
  h.open(); await settle();
  const restoreGate = deferred(); h.repo.restoreStudents = async () => restoreGate.promise;
  buttons(h.root, 'もどす')[0].click(); await settle();
  assert.ok(all(h.root, (n) => n.tagName === 'button').every((n) => n.disabled));
  restoreGate.resolve(); await settle();
});

test('画面を開いてから期限を越えた人は、もどすボタンを押しても復元しない', async (t) => {
  const h = setup(t, { removed: { 's26-001': { removedAt: now - 30 * DAY + 1, uid: 'test1' } } });
  await settle(); h.time += 1;
  buttons(h.root, 'もどす')[0].click(); await settle();
  assert.equal(await h.mem.get('accounts/test1'), null);
  assert.ok(await h.mem.get('removed/s26-001'));
});

test('クラスには期限後の知らせと卒業へのボタンを出し、自動では消さない', async (t) => {
  const h = setup(t, { view: classesMount, removed: { 's26-001': { removedAt: 0 } } });
  await settle();
  assert.match(h.root.textContent, /消してから 30 日をすぎた学年があります/);
  buttons(h.root, '卒業の画面へ')[0].click(); assert.deepEqual(h.navigate, ['t-graduates']);
  assert.ok(await h.mem.get('students/s26-001'));
});

test('名簿には消してある印を出す', async (t) => {
  const h = setup(t, { view: rosterMount, removed: { 's26-001': { removedAt: now } }, initial: {
    classes: { c1: { year: 2026, name: '確認用クラス' } }, members: { c1: { 's26-001': 1 } },
  } });
  await settle(); assert.match(h.root.textContent, /消してあります/);
});

test('名簿で出し直す前に理科クエストの古い記録が消えることを知らせる', async (t) => {
  const h = setup(t, { view: rosterMount, initial: {
    classes: { c1: { year: 2026, name: '確認用クラス' } }, members: { c1: { [student.id]: 1 } },
  } });
  await settle(); buttons(h.root, 'パスワードを出し直す')[0].click(); await settle();
  assert.match(document.body.textContent, /授業ログの記録は残ります。出し直すと、前のアカウントの理科クエストの記録は消えます。/);
  buttons(document.body, 'やめる')[0].click(); await settle();
});

test('名簿の完全削除中の生徒は出し直せず、理由を表示する', async (t) => {
  const h = setup(t, { view: rosterMount, removed: { 's26-001': { removedAt: now, purging: true } }, initial: {
    classes: { c1: { year: 2026, name: '確認用クラス' } }, members: { c1: { 's26-001': 1 } },
  } });
  await settle();
  assert.match(h.root.textContent, /完全に消している途中/);
  assert.match(h.root.textContent, /完全に消している途中の生徒は、出し直せません。/);
  const button = buttons(h.root, 'パスワードを出し直す')[0];
  assert.equal(button.disabled, true);
  button.click(); await settle();
  assert.equal(buttons(document.body, '出し直す').length, 0);
  assert.equal(await h.mem.get('accounts/test1'), null);
});

test('30 日前でも削除開始済みならもどすボタンを出さず、停止後の開き直しで続ける', async (t) => {
  const gate = deferred();
  const h = setup(t, { removed: { 's26-001': { removedAt: now, uid: 'test1', purging: true } },
    extra: { listMemberOf: async () => { await gate.promise; return {}; } } });
  await settle();
  assert.equal(buttons(h.root, 'もどす').length, 0);
  assert.doesNotMatch(h.root.textContent, /30 日をすぎました/);
  buttons(h.root, '止める')[0].click(); gate.resolve(); await settle();
  assert.equal(buttons(h.root, 'もどす').length, 0);
  assert.equal(await h.mem.get('removed/s26-001/purging'), true);
  h.open(); await settle();
  assert.equal(await h.mem.get('removed'), null);
  assert.equal(await h.mem.get('students'), null);
});

function fileInitial() {
  return { classes: { c1: { year: 2026 } }, lessons: { c1: { l1: { createdAt: 1 } } },
    records: { c1: { l1: { 's26-001': { attachments: { a1: { type: 'image', fileId: 'photo', bytes: 1, addedAt: 1 } } } } } } };
}

test('記録の探索中はクラスの進み具合を表示する', async (t) => {
  const gate = deferred();
  const h = setup(t, { removed: { 's26-001': { removedAt: 0 } }, initial: fileInitial(),
    extra: { listRecordIds: async () => { await gate.promise; return ['s26-001']; } } });
  await settle();
  assert.match(h.root.textContent, /記録をさがしています…（クラス 0 \/ 1）/);
  assert.equal(await h.mem.get('removed/s26-001/purging'), true);
  gate.resolve(); await settle();
  assert.equal(await h.mem.get('students'), null);
});

test('unknown のときは記録を残す。続きから消すも再確認し、とばすのは danger の「はい」だけ', async (t) => {
  const h = setup(t, { removed: { 's26-001': { removedAt: 0 } }, initial: fileInitial() });
  let calls = 0;
  h.ctx.files.trashStudents = async () => { calls++; return { trashed: 0, missing: 0, skipped: 0, unknown: 1 }; };
  await settle();
  assert.match(h.root.textContent, /Drive で確かめられなかったファイルが 1 個あったので、止めました。時間をおいて『続きから消す』を押してください。/);
  assert.equal(buttons(h.root, 'もどす').length, 0);
  buttons(h.root, '続きから消す')[0].click(); await settle();
  assert.equal(calls, 2);
  assert.ok(await h.mem.get('records/c1/l1/s26-001'));
  buttons(h.root, '確かめられないファイルをとばして続ける')[0].click(); await settle();
  assert.match(document.body.textContent, /とばしたファイルは、先生の Google ドライブの『授業ログ_生徒』のフォルダに残ることがあります。記録の方は消えるので、アプリからはたどれなくなります。/);
  assert.ok(buttons(document.body, 'はい')[0].className.includes('btn-danger'));
  buttons(document.body, 'いいえ')[0].click(); await settle();
  assert.equal(calls, 2);
  assert.ok(await h.mem.get('records/c1/l1/s26-001'));
  buttons(h.root, '確かめられないファイルをとばして続ける')[0].click(); await settle();
  buttons(document.body, 'はい')[0].click(); await settle();
  assert.equal(calls, 3);
  assert.equal(await h.mem.get('records'), null);
  assert.match(document.body.textContent, /完全に消しました。確かめられなかったファイル 1 個は、とばしました。/);
});

test('とばす許可は確かめた学年だけ。次の学年や開き直しには持ちこさない', async (t) => {
  const initial = fileInitial();
  initial.records.c1.l1['s25-001'] = { attachments: { a1: { type: 'image', fileId: 'older-photo', bytes: 1, addedAt: 1 } } };
  const h = setup(t, { students: { 's26-001': { createdAt: 1 }, 's25-001': { createdAt: 1 } },
    removed: { 's26-001': { removedAt: 0 }, 's25-001': { removedAt: 0 } }, initial });
  h.ctx.files.trashStudents = async () => ({ trashed: 0, missing: 0, skipped: 0, unknown: 1 });
  await settle();
  buttons(h.root, '確かめられないファイルをとばして続ける')[0].click(); await settle();
  buttons(document.body, 'はい')[0].click(); await settle();
  assert.equal(await h.mem.get('students/s26-001'), null);
  assert.ok(await h.mem.get('students/s25-001'));
  assert.ok(await h.mem.get('records/c1/l1/s25-001'));
  assert.match(h.root.textContent, /Drive で確かめられなかったファイルが 1 個/);
  h.open(); await settle();
  assert.ok(await h.mem.get('records/c1/l1/s25-001'));
  assert.equal(buttons(h.root, '確かめられないファイルをとばして続ける').length, 1);
});

for (const view of [classesMount, rosterMount]) test('removed の読み込み失敗でも既存画面を出す', async (t) => {
  const h = setup(t, { view, extra: { listRemoved: async () => { throw new NetError('denied'); } }, initial: {
    classes: { c1: { year: 2026, name: '確認用クラス' } }, members: { c1: { 's26-001': 1 } },
  } });
  await settle(); assert.match(h.root.textContent, /確認用クラス/);
  assert.doesNotMatch(h.root.textContent, /消してあります|消してから 30 日/);
});

test('狭い画面では入力の幅を親以内にし、ボタンと文字を折り返す', () => {
  const css = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');
  assert.match(css, /\.graduate-row input\s*\{[^}]*width: 100%;[^}]*box-sizing: border-box/);
  assert.match(css, /\.graduate-row \.btn\s*\{[^}]*max-width: 100%;[^}]*white-space: normal/);
  assert.match(css, /\.graduate-row\s*\{[^}]*min-width: 0;[^}]*overflow-wrap: anywhere/);
});
