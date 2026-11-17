// 先生の返事の整形・文字数・読み取り時の選別を確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanReply, checkReply, toReply, replyEditState, replyMarkLabel, replyDateLabel, stampKind, stampTargets } from '../js/reply-logic.js';
import { readFile } from 'node:fs/promises';
import { CONFIG } from '../js/config.js';

test('cleanReply: 改行と前後の空白を整え、中の改行・空白は残す。元の値は変えない', () => {
  const value = { text: ' \t一行目\r\n  二行目\r三行目 \n', seen: true, extra: 1 };
  const before = structuredClone(value);
  assert.deepEqual(cleanReply(value), { text: '一行目\n  二行目\n三行目', seen: true });
  assert.deepEqual(value, before);
  assert.deepEqual(cleanReply({ text: '返事' }), { text: '返事', seen: false });
  assert.deepEqual(cleanReply({ seen: true }), { text: '', seen: true });
});

test('cleanReply: 物でない値・空白だけは null。文字以外と true 以外は空として扱う', () => {
  for (const value of [null, undefined, false, 1, '文', [], ['文'], {}, { text: '' }, { text: ' \r\n\t　' }]) {
    assert.equal(cleanReply(value), null);
  }
  for (const text of [undefined, null, 1, true, [], {}]) {
    assert.equal(cleanReply({ text }), null);
    assert.deepEqual(cleanReply({ text, seen: true }), { text: '', seen: true });
  }
  for (const seen of [undefined, null, false, 'true', 1, [], {}]) {
    assert.equal(cleanReply({ seen }), null);
    assert.deepEqual(cleanReply({ text: '文', seen }), { text: '文', seen: false });
  }
});

test('checkReply: 400 文字まで、空は印があるときだけ通る。長すぎる文は切らない', () => {
  assert.equal(CONFIG.reply.textMax, 400);
  for (const text of ['あ', 'あ'.repeat(400), '😀'.repeat(200)]) {
    assert.deepEqual(checkReply({ text, seen: false }), { ok: true });
  }
  for (const text of ['あ'.repeat(401), '😀'.repeat(200) + 'あ']) {
    const reply = cleanReply({ text, seen: true });
    assert.equal(reply.text, text);
    assert.deepEqual(checkReply(reply), { ok: false, error: 'too-long' });
  }
  assert.deepEqual(checkReply({ text: '', seen: true }), { ok: true });
  for (const value of [null, undefined, {}, { text: '' }, { text: '', seen: false }, { text: '', seen: 'true' }, { text: 1 }]) {
    assert.deepEqual(checkReply(value), { ok: false, error: 'empty' });
  }
});

test('toReply: 正しい文・印と有限の時刻だけ返し、余分な項目を落とす', () => {
  const value = { text: ' 文\r\n文 ', seen: true, updatedAt: 0, extra: true };
  const before = structuredClone(value);
  assert.deepEqual(toReply(value), { text: '文\n文', seen: true, updatedAt: 0 });
  assert.deepEqual(value, before);
  assert.deepEqual(toReply({ text: 'あ'.repeat(400), updatedAt: 10 }), { text: 'あ'.repeat(400), seen: false, updatedAt: 10 });
  assert.deepEqual(toReply({ seen: true, updatedAt: 10 }), { text: '', seen: true, updatedAt: 10 });
  assert.deepEqual(toReply({ text: 1, seen: true, updatedAt: 10 }), { text: '', seen: true, updatedAt: 10 });
  assert.deepEqual(toReply({ text: '文', seen: 'true', updatedAt: 10 }), { text: '文', seen: false, updatedAt: 10 });
});

test('toReply: 形・時刻・長さが不正な値と、文も印もない値は null', () => {
  for (const value of [null, undefined, 1, '文', [], {}, { updatedAt: 10 }, { text: '文' },
    { text: ' \r\n　', updatedAt: 10 }, { seen: false, updatedAt: 10 }, { seen: 'true', updatedAt: 10 },
    { text: 'あ'.repeat(401), seen: true, updatedAt: 10 }, { text: ' '.repeat(400) + '文', updatedAt: 10 }]) {
    assert.equal(toReply(value), null);
  }
  for (const updatedAt of [undefined, null, '10', false, NaN, Infinity, -Infinity, {}, []]) {
    assert.equal(toReply({ text: '文', updatedAt }), null);
  }
});

test('replyEditState: 空白・同じ中身・通信中は保存できず、文から印だけには変えられる', () => {
  const saved = { text: '返事\nです', seen: true, updatedAt: 1 };
  for (const value of [null, { text: '' }, { text: ' \n　' }]) assert.equal(replyEditState(value, null).canSave, false);
  assert.equal(replyEditState({ text: ' 返事\r\nです ', seen: true }, saved).dirty, false);
  assert.equal(replyEditState({ text: '', seen: false }, saved).dirty, true);
  assert.equal(replyEditState({ text: '', seen: false }, saved).canSave, false);
  assert.equal(replyEditState({ text: '', seen: true }, saved).canSave, true);
  assert.equal(replyEditState({ text: '新しい返事' }, saved, true).canSave, false);
  assert.equal(replyEditState({ text: '新しい返事' }, saved).canSave, true);
});

test('replyEditState: 入力そのものを数え、400 文字・絵文字・貼りつけの境界を守る', () => {
  assert.deepEqual(replyEditState({ text: '😀'.repeat(200) }, null), { count: 400, dirty: true, tooLong: false, canSave: true });
  for (const text of ['あ'.repeat(401), '😀'.repeat(200) + 'あ', ' '.repeat(400) + 'あ']) {
    assert.equal(replyEditState({ text, seen: true }, null).count, 401);
    assert.equal(replyEditState({ text, seen: true }, null).tooLong, true);
    assert.equal(replyEditState({ text, seen: true }, null).canSave, false);
  }
});

test('返事の印: 文を優先し、印だけ・空を区別する', () => {
  assert.equal(replyMarkLabel({ text: '文', seen: true }), '💬 返事ずみ');
  assert.equal(replyMarkLabel({ text: '文', seen: false }), '💬 返事ずみ');
  assert.equal(replyMarkLabel({ text: ' \n', seen: true }), 'スタンプ');
  assert.equal(replyMarkLabel({ text: ' \n', seen: false }), '');
  assert.equal(replyMarkLabel(null), '');
});

test('返事の日付: M/D で表示し、無効な時刻は表示しない', () => {
  assert.equal(replyDateLabel(new Date(2026, 0, 2, 12).getTime()), '1/2');
  assert.equal(replyDateLabel(new Date(2026, 10, 16, 12).getTime()), '11/16');
  for (const value of [null, undefined, '', '100', NaN, Infinity, 1e20]) assert.equal(replyDateLabel(value), '');
});

test('stampKind: 同じ入力は同じ絵になり、同時刻の 60 人で 6 種類がすべて出る', async () => {
  const kinds = new Set();
  for (let i = 1; i <= 60; i += 1) {
    const value = { studentId: `s26-${String(i).padStart(3, '0')}`, lessonId: 'TestLesson', updatedAt: 1794870000000 };
    const before = structuredClone(value);
    const kind = stampKind(value);
    assert.equal(stampKind({ ...value }), kind);
    assert.deepEqual(value, before);
    kinds.add(kind);
  }
  assert.deepEqual([...kinds].sort(), [...'abcdef']);
  for (const kind of kinds) assert.match(await readFile(new URL(`../assets/stamps/seen-${kind}.svg`, import.meta.url), 'utf8'), /<svg\b/);
});

test('stampKind: ID が文字でない・時刻が有限の数でない場合は a', () => {
  for (const value of [null, undefined, [], {}, true, 'invalid',
    { studentId: 1, lessonId: 'l1', updatedAt: 1 }, { studentId: 's26-001', lessonId: null, updatedAt: 1 }]) {
    assert.equal(stampKind(value), 'a');
  }
  for (const updatedAt of [null, undefined, '1', true, NaN, Infinity, {}]) {
    assert.equal(stampKind({ studentId: 's26-001', lessonId: 'l1', updatedAt }), 'a');
  }
});

test('stampTargets: 文字・手書き・理解度を対象にし、名簿外も含め、押してある人とメモだけは除く', () => {
  const ink = { fileId: 'TestInk', bytes: 100, strokes: 1, updatedAt: 1 };
  const value = { students: [4, 2, 3, 1, 5, 6, 7, 8, 9].map((n) => ({ studentId: `s26-00${n}` })), records: {
    's26-001': { learned: '分かったこと' }, 's26-002': { question: '疑問' },
    's26-003': { ink: { learned: ink } }, 's26-004': { level: 1 },
    's26-005': { question: '押してある' }, 's26-006': { memo: 'メモ', ink: { memo: ink } },
    's26-007': { learned: ' \n　', question: '', level: null }, 's26-008': {},
    's26-010': { ink: { question: ink } },
  }, replies: { 's26-005': { seen: true }, 's26-001': { text: '返事だけ' } } };
  const before = structuredClone(value);
  assert.deepEqual(stampTargets(value), ['s26-004', 's26-002', 's26-003', 's26-001', 's26-010']);
  assert.deepEqual(value, before);
  value.replies = Object.fromEntries(Object.keys(value.records).map((id) => [id, { seen: true }]));
  assert.deepEqual(stampTargets(value), []);
});

test('stampTargets: 不正な入力は対象にせず、重複した生徒も 1 人として数える', () => {
  for (const value of [null, undefined, {}, [], true, 'invalid', { students: {}, records: [], replies: null }]) {
    assert.deepEqual(stampTargets(value), []);
  }
  assert.deepEqual(stampTargets({ students: [null, {}, { studentId: 'invalid' }, { studentId: 's26-001' }, { studentId: 's26-001' }],
    records: { 's26-001': { level: 4 }, invalid: { question: '除く' }, 's26-002': null,
      's26-003': { learned: 123, question: {}, level: '3', ink: { question: true } },
      's26-004': { ink: { learned: { fileId: 'TestInk', bytes: 1, strokes: 0, updatedAt: 1 } } } },
    replies: null }), ['s26-001']);
});
