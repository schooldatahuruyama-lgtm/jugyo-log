// 確認ページ（check.html）と入口（index.html）を文字として読んで確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// 画面に出す項目の名前（指示書の表のとおり）
const LABELS = [
  'データベースを読む',
  '生徒用のアカウントを作る',
  '作ったアカウントでログインする',
  'データベースに書いて読む',
  'ログインを更新する',
  '保存の仕組みに届く',
  '写真を 1 枚保存する',
  '保存した写真を取り出して表示する',
  '同時に 40 回取り出す',
  'Drive の容量を見る',
  '端末の中に保存できる',
  '後片付け',
];

test('check.html に innerHTML が無い', () => {
  assert.ok(!read('check.html').includes('innerHTML'), 'innerHTML を使っています');
});

test('check.html が必要なモジュールを import している', () => {
  const html = read('check.html');
  for (const m of ['./js/check-steps.js', './js/check-logic.js', './js/firebase-config.js', './js/gas-config.js']) {
    assert.match(html, new RegExp(`import\\s[^;]*from\\s+['"]${m.replace(/[.\/]/g, '\\$&')}['"]`), `${m} を import していません`);
  }
});

test('check.html に 12 個の項目の名前がすべてある', () => {
  const html = read('check.html');
  for (const label of LABELS) {
    assert.ok(html.includes(label), `「${label}」がありません`);
  }
});

test('check.html は外から読み込まない', () => {
  const html = read('check.html');
  assert.ok(!/(src|href)\s*=\s*["']?http:\/\//i.test(html), 'http:// の読み込みがあります');
  assert.ok(!/@import\s+(url\()?["']?http:\/\//i.test(html), 'http:// の @import があります');
  assert.ok(!html.includes('<script src='), '<script src= があります');
  assert.ok(!html.includes('<link rel="stylesheet"'), '<link rel="stylesheet" があります');
});

test('check.html に viewport の指定がある', () => {
  assert.ok(read('check.html').includes('<meta name="viewport"'));
});

test('check.html の写真は hidden で隠れる（.photo[hidden] の規則がある）', () => {
  assert.match(read('check.html'), /\.photo\[hidden\]\s*\{\s*display:\s*none/);
});

test('報告の場所は、確認を始めたときの値を使う', () => {
  const html = read('check.html');
  assert.match(html, /lastPlace\s*=\s*\$\('place'\)\.value/, '確認を始めたときに場所を覚えていません');
  assert.match(html, /place:\s*lastPlace/, '報告に覚えた場所を使っていません');
  assert.ok(!/place:\s*\$\('place'\)\.value/.test(html), 'コピーするときの選択を報告に使っています');
});

test('IndexedDB の時間切れも終わりの処理（finish）に通す', () => {
  const html = read('check.html');
  assert.match(html, /setTimeout\(\(\)\s*=>\s*finish\(false\),\s*STORE_TIMEOUT_MS\)/);
});

test('Cache と localStorage の確認は、途中で失敗しても finally で消す', () => {
  const html = read('check.html');
  assert.match(html, /finally\s*\{\s*try\s*\{\s*await caches\.delete\(name\);/, 'Cache を finally で消していません');
  assert.match(html, /finally\s*\{\s*try\s*\{\s*window\.localStorage\.removeItem\(key\);/, 'localStorage を finally で消していません');
});

test('index.html に check.html へのリンクがある', () => {
  const html = read('index.html');
  assert.match(html, /<a\s[^>]*href\s*=\s*["']\.?\/?check\.html["']/);
  assert.ok(html.includes('授業ログは準備中です'));
});
