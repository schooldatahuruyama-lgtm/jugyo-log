import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiSummaryBox, createAiSummarySession } from '../js/views/parts/ai-summary-box.js';
import { installDom, all, byClass, buttons, settle } from './helpers/picture-dom.js';

const ids = { classId: 'AiClass', lessonId: 'AiLesson' };
const now = new Date(2026, 10, 18, 9, 5).getTime();
const value = (overview = '全体の見本') => ({ overview,
  questionGroups: [{ topic: '<話題>', numbers: ['1番', '2番'], example: '<b>代表の文</b>' }],
  misconceptions: [{ number: '1番', quote: '引用', note: '気になる所' }],
  nextLesson: ['次の見本'], followUp: [{ number: '2番', reason: '理由の見本' }] });
const saved = (overview) => ({ ...value(overview), v: 1, model: 'demo', createdAt: now, basedOn: { count: 2, latest: 10 },
  labels: { '1番': 's26-001', '2番': 's26-002' } });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const confirm = (label = 'まとめる') => buttons(byClass(document.body, 'confirm')[0], label)[0].click();
const alerts = (root) => all(root, (node) => node.getAttribute('role') === 'alert').map((node) => node.textContent);

function setup(t, options = {}) {
  const dom = installDom();
  const createElement = dom.createElement;
  dom.createElement = (tag) => { const node = createElement(tag); node.select = () => { node.selectedText = true; }; return node; };
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  const h = { calls: [], writes: [], routes: [], stored: options.saved ?? null };
  h.repo = { getAiSummary: async () => h.stored, setAiSummary: async (...args) => {
    h.writes.push(args); h.stored = { ...args[2].summary, labels: args[2].labels };
  } };
  h.request = async (request) => { h.calls.push(request); return { summary: value(), model: 'demo' }; };
  h.session = createAiSummarySession({ repo: h.repo, request: (request) => h.request(request), now: () => now });
  const count = options.count ?? 2;
  h.students = Array.from({ length: count }, (_, i) => ({ studentId: `s26-${String(i + 1).padStart(3, '0')}`, number: i + 1, inRoster: true }));
  h.records = Object.fromEntries(h.students.map((student) => [student.studentId, { memo: '確認用の文', updatedAt: 10 }]));
  h.open = (extra = {}) => {
    h.box?.destroy(); h.box?.node.remove();
    h.box = aiSummaryBox({ session: h.session, ...ids, lesson: { title: '確認用授業' }, students: h.students,
      records: h.records, navigate: (...args) => h.routes.push(args), ...extra });
    document.body.append(h.box.node);
  };
  h.start = async (label = 'AI でまとめる') => { buttons(h.box.node, label)[0].click(); confirm(); await settle(); };
  t.after(() => { h.box?.destroy(); h.session.destroy(); dom.restore();
    if (nav) Object.defineProperty(globalThis, 'navigator', nav); else delete globalThis.navigator; });
  return h;
}

test('保存したまとめの読込中は作成できず、完了後はボタンと人数', async (t) => {
  const h = setup(t); const read = deferred(); h.repo.getAiSummary = () => read.promise; h.open();
  assert.match(h.box.node.textContent, /読みこんでいます…/);
  assert.equal(buttons(h.box.node, 'AI でまとめる').length, 0);
  read.resolve(null); await settle();
  assert.equal(buttons(h.box.node, 'AI でまとめる')[0].disabled, false);
  assert.match(h.box.node.textContent, /（文字で書いた 2 人分）/);
  assert.equal(all(h.box.node, (node) => node.tagName === 'p')[0].textContent,
    '文字で書いた記録を OpenAI に送り、AI がまとめます。名前や ID の欄は送りません。手書きは入りません。');
});

test('文字が 0 人では押せない。手書き・理解度だけも含めない', async (t) => {
  const h = setup(t); h.records = { 's26-001': { level: 4, ink: { memo: {} } }, 's26-002': { memo: ' \n ' } };
  h.open(); await settle();
  const button = buttons(h.box.node, 'AI でまとめる')[0]; assert.equal(button.disabled, true);
  button.fire('click'); await settle();
  assert.equal(h.calls.length, 0); assert.equal(byClass(document.body, 'confirm').length, 0);
  assert.match(h.box.node.textContent, /（文字で書いた記録がありません）/);
});

for (const count of [60, 61]) {
  test(`${count} 人の確認と切り詰め、取り消しでは送らない`, async (t) => {
    const h = setup(t, { count }); h.open(); await settle();
    buttons(h.box.node, 'AI でまとめる')[0].click();
    const dialog = byClass(document.body, 'confirm')[0];
    assert.match(dialog.textContent, /AI でまとめますか？/);
    assert.equal(all(dialog, (node) => node.tagName === 'p')[0].textContent,
      'この授業の、文字で書いた記録（60 人分）を、OpenAI に送ります。名前や ID の欄は送りません。生徒が文の中に書いた名前などは、そのまま送られます。'
      + (count > 60 ? '（人数が多いので、はじめの 60 人分だけ送ります）' : ''));
    assert.equal(dialog.textContent.includes('はじめの 60 人分だけ送ります'), count > 60);
    confirm('やめる'); await settle(); assert.equal(h.calls.length, 0);
    await h.start(); assert.equal(h.calls[0].entries.length, 60);
  });
}

test('確認と生成中の連打は一度だけ。生成文・保存先・匿名の送信内容', async (t) => {
  const h = setup(t); const job = deferred();
  h.request = (request) => { h.calls.push(request); return job.promise; };
  h.open(); await settle(); const button = buttons(h.box.node, 'AI でまとめる')[0];
  button.click(); button.fire('click'); assert.equal(byClass(document.body, 'confirm').length, 1);
  confirm(); await settle(); button.fire('click');
  assert.equal(h.calls.length, 1);
  assert.equal(all(h.box.node, (node) => node.getAttribute('role') === 'status')[0].textContent, 'AI がまとめています…（30 秒ほどかかります）');
  assert.equal(buttons(h.box.node, 'AI でまとめる')[0].disabled, true);
  assert.doesNotMatch(JSON.stringify(h.calls), /s26-|AiClass|AiLesson/);
  job.resolve({ summary: value(), model: 'demo' }); await settle();
  assert.equal(h.writes.length, 1); assert.deepEqual(h.writes[0].slice(0, 2), ['AiClass', 'AiLesson']);
  assert.deepEqual(h.writes[0][2].basedOn, { count: 2, latest: 10 });
  assert.deepEqual(h.writes[0][2].labels, { '1番': 's26-001', '2番': 's26-002' });
  assert.equal(h.writes[0][3], now);
  assert.match(h.box.node.textContent, /AI が作った文です。まちがいがあることがあります。/);
  assert.match(h.box.node.textContent, /11\/18 09:05 に作成・2 人分の記録から/);
  assert.match(h.box.node.textContent, /（<話題>）（2 人: 1 番・2 番）\n<b>代表の文<\/b>/);
  assert.equal(all(h.box.node, (node) => node.tagName === 'b').length, 0);
});

test('保存失敗でもまとめを残し、保存だけを重複せず再試行', async (t) => {
  const h = setup(t); h.repo.setAiSummary = async () => { throw new Error('確認用'); };
  h.open(); await settle(); await h.start();
  assert.match(h.box.node.textContent, /全体の見本/);
  assert.ok(alerts(h.box.node).includes('まとめは作れましたが、保存できませんでした。開き直すと消えます。'));
  h.open(); await settle(); assert.match(h.box.node.textContent, /全体の見本/);
  const saving = deferred(); let writes = 0; h.repo.setAiSummary = () => { writes++; return saving.promise; };
  const button = buttons(h.box.node, 'もう一度保存する')[0]; button.click(); button.fire('click');
  assert.equal(writes, 1); saving.resolve(); await settle();
  assert.equal(buttons(h.box.node, 'もう一度保存する').length, 0); assert.equal(h.calls.length, 1);
});

test('保存済みの表示と更新の知らせ。作り直したら入れ替える', async (t) => {
  const h = setup(t, { saved: saved('古い見本') }); h.open(); await settle();
  assert.match(h.box.node.textContent, /古い見本/);
  assert.doesNotMatch(h.box.node.textContent, /記録が変わっています/);
  h.records['s26-001'].updatedAt = 11; h.open(); await settle();
  assert.match(h.box.node.textContent, /このまとめを作ったあとに、記録が変わっています。/);
  await h.start('作り直す'); assert.doesNotMatch(h.box.node.textContent, /古い見本|記録が変わっています/);
  assert.match(h.box.node.textContent, /全体の見本/);
});

const errors = {
  'ai-config': 'AI の設定がまだです。手順書（docs/setup/ai-summary.md）のとおりに、保存の仕組みに鍵とモデルの名前を入れてください。',
  'ai-key': 'AI の鍵が正しくないか、使えなくなっています。',
  'ai-busy': 'AI が混んでいるか、使える量をこえています。少し待ってから、もう一度押してください。',
  'ai-failed': 'AI のまとめを作れませんでした。もう一度押してください。',
  bad: '保存の仕組みが古い版のようです。手順書のとおりに、保存の仕組みを貼り直してください。',
  toobig: '記録が多すぎて、送れませんでした。', denied: '先生としてログインし直してください。', auth: '先生としてログインし直してください。',
  network: '通信できませんでした。電波を確かめて、もう一度押してください。',
  unknown: '通信できませんでした。電波を確かめて、もう一度押してください。',
};
for (const [code, message] of Object.entries(errors)) {
  test(`生成失敗 ${code}: alert を出し、前のまとめを残して再試行できる`, async (t) => {
    const h = setup(t, { saved: saved('残す見本') }); h.request = async () => { throw { code }; };
    h.open(); await settle(); await h.start('作り直す');
    assert.ok(alerts(h.box.node).includes(message)); assert.match(h.box.node.textContent, /残す見本/);
    assert.equal(buttons(h.box.node, '作り直す')[0].disabled, false); assert.equal(h.writes.length, 0);
  });
}

test('保存済みの形が不正なら未作成、AI の不正な返事は失敗。空項目・不正な日時', async (t) => {
  const h = setup(t, { saved: { overview: 3 } }); h.open(); await settle();
  assert.equal(buttons(h.box.node, 'AI でまとめる').length, 1);
  h.request = async () => ({ summary: null, model: 'demo' }); await h.start();
  assert.ok(alerts(h.box.node).includes(errors['ai-failed'])); assert.equal(h.writes.length, 0);
  h.stored = { overview: '空項目の見本', createdAt: 'invalid' }; h.open(); await settle();
  assert.equal(byClass(h.box.node, 'ai-summary-date').length, 0);
  assert.equal(all(h.box.node, (node) => node.tagName === 'p' && node.textContent === '（ありません）').length, 4);
});

test('読込失敗の再試行が終わるまで生成を出さない', async (t) => {
  const h = setup(t); h.repo.getAiSummary = () => { throw new Error('確認用'); }; h.open(); await settle();
  assert.deepEqual(alerts(h.box.node), ['AI のまとめを読みこめませんでした。']);
  assert.equal(buttons(h.box.node, 'AI でまとめる').length, 0);
  h.repo.getAiSummary = async () => saved(); buttons(h.box.node, 'もう一度')[0].click(); await settle();
  assert.match(h.box.node.textContent, /全体の見本/); assert.equal(alerts(h.box.node).length, 0);
});

test('呼び名から個人の記録へ。引けない呼び名は文字だけ', async (t) => {
  const h = setup(t, { saved: saved() }); h.students = h.students.slice(0, 1); h.open(); await settle();
  buttons(h.box.node, '1 番')[0].click();
  assert.deepEqual(h.routes, [['t-record', { ...ids, studentId: 's26-001' }]]);
  assert.equal(buttons(h.box.node, '2 番').length, 0); assert.match(h.box.node.textContent, /2 番/);
});

test('再読込とセッションの開き直しで保存した対応を使い、作り直すと入れ替える', async (t) => {
  const h = setup(t); h.open(); await settle(); await h.start();
  h.session.destroy();
  h.session = createAiSummarySession({ repo: h.repo, request: (request) => h.request(request), now: () => now });
  h.students[0].number = 2; h.students[1].number = 1;
  h.open(); await settle(); buttons(h.box.node, '1 番')[0].click();
  assert.equal(h.routes.at(-1)[1].studentId, 's26-001');
  await h.start('作り直す');
  assert.deepEqual(h.writes.at(-1)[2].labels, { '2番': 's26-001', '1番': 's26-002' });
  h.open(); await settle(); buttons(h.box.node, '1 番')[0].click();
  assert.equal(h.routes.at(-1)[1].studentId, 's26-002');
});

test('古いまとめ・形のおかしい対応は文字だけ。同じ作成日時でも前の対応を使わない', async (t) => {
  const h = setup(t, { saved: saved() }); h.open(); await settle();
  assert.ok(buttons(h.box.node, '1 番').length);
  const old = saved(); delete old.labels;
  for (const stored of [old, ...[null, [], '見本', { '1番': 'invalid', '2番': 2 }].map((labels) => ({ ...saved(), labels }))]) {
    h.stored = stored; h.open(); await settle();
    assert.equal(byClass(h.box.node, 'ai-summary-person').length, 0);
    assert.match(h.box.node.textContent, /1 番/); assert.match(h.box.node.textContent, /2 番/);
  }
});

test('対応の不正な組だけ文字にし、正しい組はボタンに残す', async (t) => {
  const h = setup(t, { saved: { ...saved(), labels: { '1番': 's26-001', '2番': 'invalid', '名前の見本': 's26-002' } } });
  h.open(); await settle();
  buttons(h.box.node, '1 番')[0].click(); assert.equal(h.routes[0][1].studentId, 's26-001');
  assert.equal(buttons(h.box.node, '2 番').length, 0); assert.match(h.box.node.textContent, /2 番/);
});

test('AI の入口がないときは案内を出し、生成と作り直しを出さない', async (t) => {
  const h = setup(t); h.session.destroy();
  h.session = createAiSummarySession({ repo: h.repo, now: () => now });
  for (const stored of [null, saved()]) {
    h.stored = stored; h.open(); await settle();
    assert.match(h.box.node.textContent, /この画面では、AI のまとめを使えません。/);
    assert.equal(buttons(h.box.node, 'AI でまとめる').length, 0);
    assert.equal(buttons(h.box.node, '作り直す').length, 0);
  }
  assert.equal(h.calls.length, 0);
});

test('コピーは注意・日時・5 項目、ID なし。失敗は手動コピー', async (t) => {
  const h = setup(t, { saved: saved() }); h.open(); await settle();
  let copied; navigator.clipboard = { writeText: async (text) => { copied = text; } };
  buttons(h.box.node, 'AI のまとめをコピー')[0].click(); await settle();
  for (const text of ['AI が作った文', '11/18 09:05', 'クラス全体の様子', '疑問のまとまり', 'まちがって覚えていそうな所',
    '次の授業で取り上げるとよいこと', '声をかけたい生徒', '（1 番）『引用』— 気になる所']) assert.ok(copied.includes(text));
  assert.doesNotMatch(copied, /s26-/);
  navigator.clipboard.writeText = async () => { throw new Error('確認用'); };
  buttons(h.box.node, 'AI のまとめをコピー')[0].click(); await settle();
  const text = document.getElementById('ai-summary-copy-text');
  assert.equal(text.value, copied); assert.equal(text.selectedText, true); assert.equal(document.activeElement, text);
  buttons(h.box.node, '閉じる')[0].click(); assert.equal(document.getElementById('ai-summary-copy-text'), null);
});

test('生成中に部品を作り直しても作りかけを出し、セッションを離れた結果は保存しない', async (t) => {
  const h = setup(t); const job = deferred(); h.request = () => job.promise;
  h.open(); await settle(); await h.start(); h.open(); await settle();
  assert.match(h.box.node.textContent, /AI がまとめています/);
  h.box.destroy(); h.session.destroy(); job.resolve({ summary: value(), model: 'demo' }); await settle();
  assert.equal(h.writes.length, 0);
});

for (const succeeds of [true, false]) {
  test(`部品を離れた後のコピー${succeeds ? '成功' : '失敗'}は通知しない`, async (t) => {
    const h = setup(t, { saved: saved() }); const job = deferred();
    navigator.clipboard = { writeText: () => job.promise }; h.open(); await settle();
    buttons(h.box.node, 'AI のまとめをコピー')[0].click(); h.open(); await settle();
    if (succeeds) job.resolve(); else job.reject(new Error('確認用')); await settle();
    assert.equal(document.getElementById('ai-summary-copy-text'), null);
    assert.doesNotMatch(document.body.textContent, /AI のまとめをコピーしました。/);
  });
}
