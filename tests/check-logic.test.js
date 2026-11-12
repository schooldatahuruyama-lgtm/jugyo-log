// 接続確認の計算（メールアドレスの形、乱数の ID、まとめ、文章）を確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMAIL_DOMAINS,
  GAS_TIMEOUT_MS,
  FIREBASE_TIMEOUT_MS,
  PARALLEL_COUNT,
  studentEmail,
  checkStudentId,
  randomPassword,
  summarizeParallel,
  formatBytes,
  reportText,
} from '../js/check-logic.js';

// 決まった並びの値を順に返す random の代役
function seq(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

test('定数が決まりどおり', () => {
  assert.equal(GAS_TIMEOUT_MS, 30000);
  assert.equal(FIREBASE_TIMEOUT_MS, 10000);
  assert.equal(PARALLEL_COUNT, 40);
});

test('生徒 ID と何回目かからメールアドレスを作る', () => {
  assert.equal(studentEmail('s26-017', 1, 'jugyolog.invalid'), 's26-017.g1@jugyolog.invalid');
  assert.equal(studentEmail('s26-017', 3, 'jugyolog.example'), 's26-017.g3@jugyolog.example');
});

test('EMAIL_DOMAINS が 3 つで、この順', () => {
  assert.deepEqual(EMAIL_DOMAINS, ['jugyolog.invalid', 'jugyolog.example', 'jugyolog.example.com']);
});

test('確認用の ID は chk- と 16 進 8 桁で、random が変わると値も変わる', () => {
  const a = checkStudentId(() => 0);
  assert.match(a, /^chk-[0-9a-f]{8}$/);
  const b = checkStudentId(seq([0.1, 0.5, 0.9, 0.3, 0.7, 0.2, 0.8, 0.4]));
  assert.match(b, /^chk-[0-9a-f]{8}$/);
  assert.notEqual(a, b);
  assert.match(checkStudentId(() => 0.999999), /^chk-[0-9a-f]{8}$/);
});

test('パスワードは 12 文字で、l・o・0・1 を含まない英小文字と数字', () => {
  for (const r of [() => 0, () => 0.999999, Math.random, seq([0.05, 0.33, 0.61, 0.87])]) {
    const p = randomPassword(r);
    assert.equal(p.length, 12);
    assert.match(p, /^[a-km-np-z2-9]+$/);
  }
  assert.notEqual(randomPassword(() => 0), randomPassword(() => 0.5));
});

test('同時に呼んだ結果をまとめる', () => {
  assert.deepEqual(
    summarizeParallel([
      { ok: true, ms: 100 },
      { ok: true, ms: 300 },
      { ok: false, ms: 9000 },
      { ok: true, ms: 200 },
    ]),
    { total: 4, ok: 3, ng: 1, medianMs: 200, maxMs: 300 },
  );
});

test('成功が 0 件なら中央と最大は null', () => {
  assert.deepEqual(summarizeParallel([]), { total: 0, ok: 0, ng: 0, medianMs: null, maxMs: null });
  assert.deepEqual(
    summarizeParallel([{ ok: false, ms: 10 }, { ok: false, ms: 20 }]),
    { total: 2, ok: 0, ng: 2, medianMs: null, maxMs: null },
  );
});

test('バイト数を GB と MB の形にする', () => {
  assert.equal(formatBytes(107374182400), '100GB');
  assert.equal(formatBytes(13207024435), '12.3GB');
  assert.equal(formatBytes(478150656), '456MB');
  assert.equal(formatBytes(0), '0MB');
});

test('結果の一覧を貼り付け用の文章にする', () => {
  const text = reportText(
    [
      { label: 'check/ping を読む', ok: true, detail: '' },
      { label: 'アカウントを作る', ok: true, detail: 'jugyolog.example' },
      { label: 'GAS に届く', ok: false, detail: '保存の仕組みにつながりませんでした' },
      { label: '写真を 1 枚保存する', ok: null, detail: '' },
    ],
    { when: '2026-11-12 22:10', userAgent: 'TestAgent/1.0', screen: '1280×800', place: '教室 3-2' },
  );
  const lines = text.split('\n');
  assert.ok(lines[0].includes('2026-11-12 22:10'), '1 行目に日時がありません');
  assert.ok(lines.some((l) => l.startsWith('○') && l.includes('check/ping を読む')));
  assert.ok(lines.some((l) => l.startsWith('○') && l.includes('アカウントを作る') && l.includes('jugyolog.example')));
  assert.ok(
    lines.some((l) => l.startsWith('×') && l.includes('GAS に届く') && l.includes('保存の仕組みにつながりませんでした')),
  );
  assert.ok(lines.some((l) => l.startsWith('－') && l.includes('写真を 1 枚保存する') && l.includes('未実施')));
  // 項目は入力の順に 1 行ずつ
  const itemLines = lines.filter((l) => /^[○×－]/.test(l));
  assert.equal(itemLines.length, 4);
  assert.ok(itemLines[0].includes('check/ping'));
  assert.ok(itemLines[3].includes('写真を 1 枚保存する'));
  // 最後に環境の情報
  const tail = lines.slice(lines.indexOf(itemLines[3]) + 1).join('\n');
  assert.ok(tail.includes('TestAgent/1.0'));
  assert.ok(tail.includes('1280×800'));
  assert.ok(tail.includes('教室 3-2'));
});
