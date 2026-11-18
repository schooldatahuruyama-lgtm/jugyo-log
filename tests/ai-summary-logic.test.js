import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskText, buildSummaryRequest, cleanAiSummary, isSummaryStale, aiSummaryText,
  aiSummaryDate, aiSummaryError, aiSummarySections, aiSummaryStudent } from '../js/ai-summary-logic.js';
import { requestAiSummary } from '../js/ai-summary-flow.js';

const lesson = { title: '確認用の授業', terms: { t2: ' 用語乙 ', t1: '用語甲' }, classId: 'private-class' };
const record = (extra = {}) => ({ level: null, learned: '', question: '', memo: '確認用の文', updatedAt: 10, ...extra });
const summary = (extra = {}) => ({ overview: ' 全体の見本 ', questionGroups: [], misconceptions: [], nextLesson: [], followUp: [], ...extra });
const input = (n) => ({ lesson, students: Array.from({ length: n }, (_, i) => ({ studentId: `private-${i}`, number: i + 1 })),
  records: Object.fromEntries(Array.from({ length: n }, (_, i) => [`private-${i}`, record({ updatedAt: i + 1 })])) });

test('伏せ字: ID・メール・番号は文の端・連続・大文字・全角でも伏せる', () => {
  for (const [text, expected] of [
    ['s26-001S26-002', '（ID）（ID）'],
    ['ｓ２６－００１Ｓ２６－００２', '（ID）（ID）'],
    ['前s２６-０01後', '前（ID）後'],
    ['sample+tag@example.test,other@example.test', '（メール）,（メール）'],
    ['ＳＡＭＰＬＥ＋ＴＡＧ＠ＥＸＡＭＰＬＥ．ＴＥＳＴ', '（メール）'],
    ['s26-001@example.test', '（メール）'],
    ['0000000000', '（番号）'],
    ['000-000-0000', '（番号）'],
    ['前000 0000 0000後', '前（番号）後'],
    ['０００－０００－００００', '（番号）'],
    ['０００　０００　００００', '（番号）'],
    ['0000000000、００００００００００', '（番号）、（番号）'],
    ['s26-001、sample@example.test、0000000000', '（ID）、（メール）、（番号）'],
  ]) assert.equal(maskText(text), expected, text);
});

test('伏せ字: 9 けた以下・通常の文・全角の表記を残し、文字でない入力は空にする', () => {
  for (const text of ['', '123456789', '１２３４５６７８９', '123-456-789', '１２３　４５６　７８９',
    '340', '2026', '３４０ｍ', '名前の見本と光の進み方', 'ＡＢＣ ① ｶﾀｶﾅ']) assert.equal(maskText(text), text);
  for (const text of [null, undefined, 1234567890, true, [], {}, new String('s26-001')]) assert.equal(maskText(text), '');
});

test('送る 3 欄を伏せてから 2000 文字で切り、元の記録は変えない', () => {
  const value = input(1);
  value.records['private-0'] = record({ learned: 's26-001、Ｓ２６－００２', question: 'sample@example.test',
    memo: '０００－０００－００００' });
  const before = structuredClone(value);
  assert.deepEqual(buildSummaryRequest(value).request.entries[0],
    { no: '1番', level: 0, learned: '（ID）、（ID）', question: '（メール）', memo: '（番号）' });
  assert.deepEqual(value, before);
  value.records['private-0'] = record({ learned: 'あ'.repeat(1995) + 's26-001末余分',
    question: 'い'.repeat(1994) + 'sample@example.test末余分', memo: 'う'.repeat(1995) + '000-000-0000末余分' });
  const entry = buildSummaryRequest(value).request.entries[0];
  assert.equal(entry.learned, 'あ'.repeat(1995) + '（ID）末');
  assert.equal(entry.question, 'い'.repeat(1994) + '（メール）末');
  assert.equal(entry.memo, 'う'.repeat(1995) + '（番号）末');
});

test('文字のある人だけ選び、名簿の番号と名簿外の並び順で呼ぶ。ID・画像は送らない', () => {
  const value = input(5);
  value.students[3].inRoster = false;
  value.students[4].inRoster = false;
  value.records['private-0'] = record({ memo: ' \n ', level: 4 });
  value.records['private-1'] = record({ memo: '', ink: { learned: { fileId: 'private-file' } } });
  value.records['private-2'] = record({ memo: '', learned: '分かったことの見本', level: 3 });
  value.records['private-3'] = record({ memo: '', question: '疑問の見本' });
  const result = buildSummaryRequest(value);
  assert.deepEqual(result.request.entries.map((e) => [e.no, e.level]), [['3番', 3], ['名簿外1', 0], ['名簿外2', 0]]);
  assert.deepEqual(result.labels, { '3番': 'private-2', '名簿外1': 'private-3', '名簿外2': 'private-4' });
  assert.deepEqual(result.request.terms, ['用語甲', '用語乙']);
  assert.equal(result.request.board, '');
  assert.equal(result.count, 3);
  assert.equal(result.latest, 10);
  assert.equal(JSON.stringify(result.request).includes('private-'), false);
  assert.deepEqual(Object.keys(result.request), ['title', 'terms', 'board', 'entries']);
});

test('0 人・対象のない入力は null。60 人はそのまま、61 人からは先頭 60 人', () => {
  assert.equal(buildSummaryRequest(), null);
  assert.equal(buildSummaryRequest(null), null);
  assert.equal(buildSummaryRequest(input(0)), null);
  assert.equal(buildSummaryRequest({ ...input(1), lesson: {} }), null);
  const sixty = buildSummaryRequest(input(60));
  assert.equal(sixty.count, 60);
  assert.equal(sixty.truncated, undefined);
  const more = buildSummaryRequest(input(61));
  assert.equal(more.count, 60);
  assert.equal(more.latest, 60);
  assert.equal(more.truncated, true);
  assert.equal(Object.keys(more.labels).length, 60);
  assert.equal('truncated' in more.request, false);
});

test('不正な生徒・重複番号・重複 ID・範囲外の理解度・文字でない欄は落とす', () => {
  for (const patch of [{ level: 5 }, { level: -1 }, { level: 1.5 }, { level: '3' }, { memo: 3 }, { learned: null }]) {
    const value = input(1);
    value.records['private-0'] = record(patch);
    assert.equal(buildSummaryRequest(value), null);
  }
  for (const number of [0, 100, -1, 1.2, '名前の見本', '1\n']) {
    const value = input(1);
    value.students[0].number = number;
    assert.equal(buildSummaryRequest(value), null);
  }
  const value = input(2);
  value.students[1].number = 1;
  value.students.push(value.students[0], null, {});
  assert.equal(buildSummaryRequest(value).count, 1);
});

test('文字は 2000、授業名は 60、用語は 40 個・20 文字で切る', () => {
  const value = input(1);
  value.lesson = { title: 'あ'.repeat(61), terms: Object.fromEntries(Array.from({ length: 41 }, (_, i) => [i, 'い'.repeat(21)])) };
  value.records['private-0'] = record({ learned: 'あ'.repeat(2000), question: 'い'.repeat(2001), memo: 'う'.repeat(2002) });
  const { request } = buildSummaryRequest(value);
  assert.equal(request.title.length, 60);
  assert.equal(request.terms.length, 40);
  assert.ok(request.terms.every((t) => t.length === 20));
  for (const field of ['learned', 'question', 'memo']) assert.equal(request.entries[0][field].length, 2000);
});

test('まとめは空・不正なら null。空配列が DB で省かれた形も読める', () => {
  for (const value of [null, [], 3, {}, { overview: '  ' }, { overview: 3 }, summary({ followUp: {} })]) assert.equal(cleanAiSummary(value), null);
  assert.deepEqual(cleanAiSummary({ overview: ' 見本 ' }), summary({ overview: '見本' }));
});

test('知らない呼び名・名前・型違いの行を落とし、文字と配列を上限で切る', () => {
  const value = summary({ overview: ' あ'.trim().repeat(601),
    questionGroups: Array.from({ length: 7 }, () => ({ topic: 'い'.repeat(201), numbers: ['1番', ' 1番 ', '2番', '名前の見本', '__proto__'], example: 'う'.repeat(301) })),
    misconceptions: [{ number: '2番', quote: '文', note: '説明' }, null, ...Array.from({ length: 9 }, () => ({ number: '1番', quote: 'え'.repeat(301), note: 'お'.repeat(201) }))],
    nextLesson: [null, ...Array(4).fill('か'.repeat(201))],
    followUp: [{ number: '名前の見本', reason: '説明' }, ...Array.from({ length: 9 }, () => ({ number: '1番', reason: 'き'.repeat(201) }))] });
  const cleaned = cleanAiSummary(value, { '1番': 'private-1' });
  assert.equal(cleaned.overview.length, 600);
  assert.equal(cleaned.questionGroups.length, 6);
  assert.deepEqual(cleaned.questionGroups[0].numbers, ['1番']);
  assert.equal(cleaned.questionGroups[0].topic.length, 200);
  assert.equal(cleaned.questionGroups[0].example.length, 300);
  assert.equal(cleaned.misconceptions.length, 8);
  assert.equal(cleaned.misconceptions[0].quote.length, 300);
  assert.equal(cleaned.misconceptions[0].note.length, 200);
  assert.equal(cleaned.nextLesson.length, 3);
  assert.equal(cleaned.nextLesson[0].length, 200);
  assert.equal(cleaned.followUp.length, 8);
  assert.equal(cleaned.followUp[0].reason.length, 200);
  const saved = cleanAiSummary(summary({ followUp: ['1番', '名簿外1', '99番', '0番', '100番', '名簿外0', '名前の見本']
    .map((number) => ({ number, reason: '見本' })) }));
  assert.deepEqual(saved.followUp.map((e) => e.number), ['1番', '名簿外1', '99番']);
  assert.deepEqual(cleanAiSummary(value, {}).followUp, []);
});

test('人数または更新日時が違えば古い。コピーには 5 項目の見出しと呼び名を含む', () => {
  const current = { count: 2, latest: 10 };
  assert.equal(isSummaryStale({ basedOn: current }, current), false);
  for (const saved of [null, {}, { basedOn: { count: 1, latest: 10 } }, { basedOn: { count: 2, latest: 11 } }]) assert.equal(isSummaryStale(saved, current), true);
  const text = aiSummaryText(summary({ followUp: [{ number: '1番', reason: '見本の理由' }] }));
  for (const title of ['クラス全体の様子', '疑問のまとまり', 'まちがって覚えていそうな所', '次の授業で取り上げるとよいこと', '声をかけたい生徒', '（1 番）見本の理由']) assert.ok(text.includes(title));
  assert.equal(aiSummaryText(null), '');
});

test('日時は月日・時分と人数。不正な日時は出さない', () => {
  assert.equal(aiSummaryDate({ createdAt: new Date(2026, 10, 18, 9, 5).getTime(), basedOn: { count: 2 } }),
    '11/18 09:05 に作成・2 人分の記録から');
  for (const createdAt of [undefined, null, '1', NaN, Infinity, 1e20]) assert.equal(aiSummaryDate({ createdAt }), '');
});

test('項目の文は人数・引用・理由を含み、画面とコピーで共通にする', () => {
  const value = summary({ questionGroups: [{ topic: '<話題>', numbers: ['2番', '3番'], example: '代表の文' }],
    misconceptions: [{ number: '2番', quote: '引用', note: '気になる所' }], nextLesson: ['次の話題'],
    followUp: [{ number: '3番', reason: '理由' }] });
  assert.equal(aiSummarySections(value).length, 5);
  assert.match(aiSummaryText(value), /（<話題>）（2 人: 2 番・3 番）\n代表の文/);
  assert.match(aiSummaryText(value), /（2 番）『引用』— 気になる所/);
  assert.match(aiSummaryText(value), /（3 番）理由/);
  assert.equal(aiSummarySections(value)[3].bullets, true);
});

test('呼び名は保存した対応だけを使い、番号が変わっても同じ生徒を開く', () => {
  const people = [{ studentId: 's26-001', number: 2 }, { studentId: 's26-002', number: 1 }, { studentId: 's26-003', inRoster: false }];
  const labels = { '1番': 's26-001', '名簿外2': 's26-003' };
  assert.equal(aiSummaryStudent('1番', people, labels), 's26-001');
  assert.equal(aiSummaryStudent('名簿外2', people, labels), 's26-003');
  assert.equal(aiSummaryStudent('2番', people, labels), null);
  for (const invalid of [undefined, null, [], '見本', {}, { '1番': 'invalid' }, { '1番': 's26-099' }]) {
    assert.equal(aiSummaryStudent('1番', people, invalid), null);
  }
  assert.equal(aiSummaryStudent('名前', people), null);
});

test('保存した呼び名の不正な組だけ落とし、AI の返答にある対応は使わない', () => {
  const labels = { '1番': 's26-001', '名簿外2': 's26-002', '名前の見本': 's26-003', '2番': 'invalid', '3番': 3 };
  assert.deepEqual(cleanAiSummary(summary({ labels })).labels, { '1番': 's26-001', '名簿外2': 's26-002' });
  for (const invalid of [null, [], 3, '見本']) assert.deepEqual(cleanAiSummary(summary({ labels: invalid })).labels, {});
  assert.equal(cleanAiSummary(summary({ labels }), { '1番': true }).labels, undefined);
});

test('失敗の種類を選び、知らない種類や特殊なキーは通信の案内', () => {
  assert.match(aiSummaryError('ai-config'), /docs\/setup\/ai-summary.md/);
  assert.equal(aiSummaryError('denied'), aiSummaryError('auth'));
  for (const code of ['unknown', '__proto__', 'constructor', undefined]) assert.equal(aiSummaryError(code), aiSummaryError('network'));
});

test('AI の入口は 1 回・120 秒を指定し、返答も整える。失敗は再送しない', async () => {
  const request = buildSummaryRequest(input(1)).request;
  const calls = [];
  const gas = { async call(...args) { calls.push(args); return { summary: summary(), model: 'demo' }; } };
  assert.deepEqual(await requestAiSummary({ gas, request }), { summary: cleanAiSummary(summary()), model: 'demo' });
  assert.deepEqual(calls, [['summarize', request, { maxTries: 1, timeoutMs: 120000 }]]);
  let tries = 0;
  await assert.rejects(requestAiSummary({ request, gas: { async call() { tries += 1; throw new Error('見本'); } } }));
  assert.equal(tries, 1);
  await assert.rejects(requestAiSummary({ request, gas: { async call() { return { summary: null }; } } }), { code: 'ai-failed' });
});
