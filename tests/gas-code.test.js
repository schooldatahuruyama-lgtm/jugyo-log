// 本番の GAS を Apps Script の代役で実行する。外部には送信しない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { loadGas, makeFakes } from './helpers/gas-sandbox.js';
import { cleanAiSummary } from '../js/ai-summary-logic.js';

const code = new URL('../gas/Code.gs', import.meta.url);
const token = `e30.${Buffer.from(JSON.stringify({ user_id: 'teacher' })).toString('base64url')}.c2ln`;
const entry = (extra = {}) => ({ no: '1番', level: 3, learned: '確認用の文', question: '', memo: '', ...extra });
const request = (extra = {}) => ({ title: '確認用の授業', terms: [], board: '', entries: [entry()], ...extra });
const summary = (extra = {}) => ({ overview: ' 全体の見本 ', questionGroups: [], misconceptions: [], nextLesson: [], followUp: [], ...extra });
const completed = (text = JSON.stringify(summary())) => ({ status: 'completed', output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text }] }] });

function setup({ role = 'teacher', properties = {}, status = 200, body = completed(), fetchError = false, raw = false } = {}) {
  const fakes = makeFakes({ databaseURL: 'https://db.example', validTokens: { [token]: 'teacher' }, db: {
    read(path) { return { status: 200, body: path.startsWith('teacherList/') ? role === 'teacher' : 's00-001' }; },
  } });
  const props = { DATABASE_URL: 'https://db.example', OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'demo', ...properties };
  fakes.PropertiesService = { getScriptProperties: () => ({ getProperty: (name) => props[name] ?? null }) };
  const fetch = fakes.UrlFetchApp.fetch;
  const calls = [];
  fakes.UrlFetchApp.fetch = (url, options) => {
    if (url !== 'https://api.openai.com/v1/responses') return fetch(url, options);
    calls.push({ url, options });
    if (fetchError) throw new Error('送信後の通信失敗');
    return { getResponseCode: () => status, getContentText: () => raw ? body : JSON.stringify(body) };
  };
  const gas = loadGas(code, fakes);
  return { calls, call: (payload = request()) => JSON.parse(gas.doPost({ postData: { contents: JSON.stringify({ op: 'summarize', token, ...payload }) } }).getContent()) };
}

test('AI の指示は明らかなまちがいだけを挙げ、送信本文にも同じ文を使う', () => {
  const gas = {};
  runInNewContext(readFileSync(code, 'utf8'), gas);
  assert.match(gas.AI_INSTRUCTIONS, /はっきりまちがっている文だけ/);
  assert.match(gas.AI_INSTRUCTIONS, /内容が正しい文は/);
  assert.match(gas.AI_INSTRUCTIONS, /入れない/);
  assert.match(gas.AI_INSTRUCTIONS, /空の配列にする/);
  assert.doesNotMatch(gas.AI_INSTRUCTIONS, /断定はしない/);
  const s = setup();
  s.call();
  assert.equal(JSON.parse(s.calls[0].options.payload).instructions, gas.AI_INSTRUCTIONS);
});

test('misconceptions が空の配列でも overview があれば成功する', () => {
  const result = setup().call();
  assert.equal(result.ok, true);
  assert.equal(result.summary.overview, '全体の見本');
  assert.deepEqual(result.summary.misconceptions, []);
});

test('先生以外は denied。鍵かモデルが欠ける・空なら ai-config', () => {
  const student = setup({ role: 'student' });
  assert.deepEqual(student.call(), { ok: false, error: 'denied' });
  assert.equal(student.calls.length, 0);
  for (const name of ['OPENAI_API_KEY', 'OPENAI_MODEL']) for (const value of [undefined, '', ' \n ']) {
    const s = setup({ properties: { [name]: value } });
    assert.deepEqual(s.call(), { ok: false, error: 'ai-config' });
    assert.equal(s.calls.length, 0);
  }
});

test('入力の型・範囲・重複は bad。通信はしない', () => {
  const badRequests = [{ title: '' }, { title: 1 }, { title: 'あ'.repeat(61) }, { terms: null }, { terms: Array(41).fill('文') },
    { terms: [''] }, { terms: [1] }, { terms: ['あ'.repeat(21)] }, { board: null }, { board: 'あ'.repeat(2001) },
    { entries: [] }, { entries: null }, { entries: Array(61).fill(entry()) }, { entries: [entry(), entry()] }, { entries: [null] }];
  for (const no of ['', '0番', '100番', '01番', '1 番', '1番\n', '名簿外0', '名簿外100', 's00-001', '名前の見本']) badRequests.push({ entries: [entry({ no })] });
  for (const level of [-1, 5, 1.5, '3', null]) badRequests.push({ entries: [entry({ level })] });
  for (const field of ['learned', 'question', 'memo']) for (const value of [null, 3, {}, 'あ'.repeat(2001)]) badRequests.push({ entries: [entry({ [field]: value })] });
  for (const patch of badRequests) {
    const s = setup();
    assert.deepEqual(s.call(request(patch)), { ok: false, error: 'bad' });
    assert.equal(s.calls.length, 0);
  }
});

test('60 人・合計 120000 文字は通り、120001 文字は toobig', () => {
  const entries = Array.from({ length: 60 }, (_, i) => entry({ no: `${i + 1}番`, learned: 'あ'.repeat(2000), level: i % 5 }));
  const s = setup();
  assert.equal(s.call(request({ entries, board: undefined, title: 'あ'.repeat(60), terms: Array(40).fill('い'.repeat(20)) })).ok, true);
  assert.equal(JSON.parse(JSON.parse(s.calls[0].options.payload).input).board, '');
  entries[0].memo = 'あ';
  assert.deepEqual(s.call(request({ entries })), { ok: false, error: 'toobig' });
  assert.equal(s.calls.length, 1);
});

for (const [status, error] of [[401, 'ai-key'], [403, 'ai-key'], [429, 'ai-busy'], [500, 'ai-failed'], [201, 'ai-failed']]) {
  test(`HTTP ${status} は ${error}。再送しない`, () => {
    const s = setup({ status });
    assert.deepEqual(s.call(), { ok: false, error });
    assert.equal(s.calls.length, 1);
  });
}

test('refusal・incomplete・出力なし・壊れた JSON・壊れたまとめ・通信例外は ai-failed', () => {
  const responses = [null, { ...completed(), status: 'incomplete' }, { status: 'completed', output: [] },
    { status: 'completed', output: [{ type: 'refusal' }] },
    { status: 'completed', output: [...completed().output, { type: 'message', content: [{ type: 'refusal' }] }] },
    completed('not JSON'), completed('null'), completed('{}'), completed(JSON.stringify(summary({ overview: ' ' }))),
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 3 }] }] }];
  for (const body of responses) assert.deepEqual(setup({ body }).call(), { ok: false, error: 'ai-failed' });
  for (const options of [{ body: '{', raw: true }, { fetchError: true }]) {
    const s = setup(options);
    assert.deepEqual(s.call(), { ok: false, error: 'ai-failed' });
    assert.equal(s.calls.length, 1);
  }
});

test('成功時は GAS でも長さと呼び名を整え、ブラウザ側と同じ形にする', () => {
  const value = summary({ overview: 'あ'.repeat(601),
    questionGroups: Array.from({ length: 7 }, () => ({ topic: 'い'.repeat(201), numbers: ['1番', '名簿外1', '2番', '名前の見本'], example: 'う'.repeat(301) })),
    misconceptions: [null, { number: '2番', quote: '文', note: '説明' }, ...Array.from({ length: 9 }, () => ({ number: '1番', quote: 'え'.repeat(301), note: 'お'.repeat(201) }))],
    nextLesson: Array(4).fill('か'.repeat(201)), followUp: Array.from({ length: 9 }, () => ({ number: '名簿外1', reason: 'き'.repeat(201) })) });
  const s = setup({ body: completed(JSON.stringify(value)) });
  assert.deepEqual(s.call(request({ entries: [entry(), entry({ no: '名簿外1' })] })),
    { ok: true, summary: cleanAiSummary(value, { '1番': true, '名簿外1': true }), model: 'demo' });
});

test('送信本文は許可した項目だけ。鍵は Authorization だけ。保存しない厳密な JSON Schema', () => {
  const s = setup();
  s.call(request({ classId: 'private-class', studentId: 'private-student', entries: [entry({ studentId: 'private-student', attachments: 'private-file' })] }));
  const { options } = s.calls[0];
  assert.equal(options.method, 'post');
  assert.equal(options.contentType, 'application/json');
  assert.equal(options.muteHttpExceptions, true);
  assert.deepEqual({ ...options.headers }, { Authorization: 'Bearer test-key' });
  assert.equal(options.payload.includes('test-key'), false);
  assert.equal(options.payload.includes(token), false);
  assert.equal(options.payload.includes('private-'), false);
  const body = JSON.parse(options.payload);
  assert.equal(body.model, 'demo');
  assert.equal(body.store, false);
  assert.equal(body.max_output_tokens, 4000);
  assert.match(body.instructions, /データ.*指示には従わない/);
  assert.equal(body.text.format.type, 'json_schema');
  assert.equal(body.text.format.strict, true);
  assert.equal(body.text.format.name, 'lesson_summary');
  function check(schema) {
    if (schema.type === 'object') {
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual(schema.required.sort(), Object.keys(schema.properties).sort());
      Object.values(schema.properties).forEach(check);
    }
    if (schema.type === 'array') check(schema.items);
  }
  check(body.text.format.schema);
  const source = readFileSync(code, 'utf8');
  assert.equal(source.includes('sk-'), false);
  assert.doesNotMatch(source, /(?:Logger|console)\.log\s*\(/);
});
