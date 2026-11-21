import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionMemo } from '../js/session-memo.js';

test('uid と生徒 ID だけを保存し、読める・消せる', () => {
  const data = new Map();
  const storage = { getItem: (k) => data.get(k), setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
  const memo = createSessionMemo({ storage });
  assert.equal(memo.get(), null);
  memo.put({ uid: 'u1', studentId: 's26-001', extra: '保存しない項目' });
  assert.equal(data.get('jugyolog:session'), '{"uid":"u1","studentId":"s26-001"}');
  assert.deepEqual(memo.get(), { uid: 'u1', studentId: 's26-001' });
  memo.clear(); assert.equal(memo.get(), null);
});

test('壊れた JSON・空の uid・不正な生徒 ID は無いものとして扱う', () => {
  for (const value of ['broken', 'null', '{}', '[]', ...[
    { uid: '', studentId: 's26-001' }, { uid: 1, studentId: 's26-001' },
    { uid: 'u1' }, { uid: 'u1', studentId: 's26-1' }, { uid: 'u1', studentId: 'S26-001' },
  ].map(JSON.stringify)]) {
    const memo = createSessionMemo({ storage: { getItem: () => value } });
    assert.equal(memo.get(), null, value);
  }
});

test('保存先が無い・例外でも投げず、指定したキーを使う', () => {
  for (const storage of [undefined, { getItem() { throw new Error(); }, setItem() { throw new Error(); }, removeItem() { throw new Error(); } }]) {
    const memo = createSessionMemo({ storage });
    memo.put({ uid: 'u1', studentId: 's26-001' }); assert.equal(memo.get(), null); memo.clear();
  }
  let key;
  createSessionMemo({ key: 'custom', storage: { setItem(k) { key = k; } } }).put({ uid: 'u1', studentId: 's26-001' });
  assert.equal(key, 'custom');
});
