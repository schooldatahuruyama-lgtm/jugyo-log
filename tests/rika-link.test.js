import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../js/config.js';
import { rikaEntryUrl, rikaProgressUrl } from '../js/rika-link.js';

test('rikaEntryUrl: 文字列でない値や、空・空白だけの文字列は使わない', () => {
  for (const value of [undefined, null, 123, true, [], ['https://example.com/a/'], {}, '', ' \t\n ']) {
    assert.equal(rikaEntryUrl(value), null);
  }
});

test('rikaEntryUrl: HTTPS 以外・認証情報つき・読めないアドレスは使わない', () => {
  for (const value of ['http://example.com/a/', 'javascript:alert(1)', 'data:text/plain,test',
    'https://user:pass@example.com/a/', 'https://user@example.com/a/', 'https://:pass@example.com/a/',
    'not a url', '/a/', 'https://', 'https://exa mple.com/', 'x'.repeat(100000)]) {
    assert.equal(rikaEntryUrl(value), null);
  }
});

test('rikaEntryUrl: HTTPS のアドレスを正規化し、前後の空白を除く', () => {
  assert.equal(rikaEntryUrl('https://example.com/a/'), 'https://example.com/a/');
  assert.equal(rikaEntryUrl(' \t https://example.com/a/ \n '), 'https://example.com/a/');
  assert.equal(rikaEntryUrl('HTTPS://EXAMPLE.COM:443'), 'https://example.com/');
});

test('rikaEntryUrl: 長くても読める HTTPS のアドレスは使える', () => {
  const value = `https://example.com/${'a'.repeat(100000)}`;
  assert.equal(rikaEntryUrl(value), value);
});

test('rikaEntryUrl: 設定した理科クエストのアドレスを使える', () => {
  assert.equal(typeof CONFIG.rika.url, 'string');
  assert.equal(rikaEntryUrl(CONFIG.rika.url), new URL(CONFIG.rika.url).href);
});

test('rikaProgressUrl: 末尾の / の有無を保ち、先生の画面とクラスを指定する', () => {
  for (const baseUrl of ['https://example.com', 'https://example.com/', 'https://example.com/rika', 'https://example.com/rika/']) {
    assert.equal(rikaProgressUrl(baseUrl, 'Class1'), `${new URL(baseUrl).href}?teacher=1&class=Class1`);
  }
});

test('rikaProgressUrl: 元の問い合わせを残し、# より後ろを付けない', () => {
  const url = new URL(rikaProgressUrl('https://example.com/rika/?from=classes&unit=light#home', 'c2'));
  assert.equal(url.searchParams.get('from'), 'classes');
  assert.equal(url.searchParams.get('unit'), 'light');
  assert.equal(url.searchParams.get('teacher'), '1');
  assert.equal(url.searchParams.get('class'), 'c2');
  assert.equal(url.hash, '');
});

test('rikaProgressUrl: 元の teacher と class は重ねずに置きかえる', () => {
  const url = new URL(rikaProgressUrl('https://example.com/?teacher=0&teacher=2&class=old&class=other', 'NewClass3'));
  assert.deepEqual(url.searchParams.getAll('teacher'), ['1']);
  assert.deepEqual(url.searchParams.getAll('class'), ['NewClass3']);
});

test('rikaProgressUrl: 入口に使えないアドレスは使わない', () => {
  for (const value of [undefined, null, 123, '', ' ', 'http://example.com/rika/', 'not a url', 'https://',
    'https://exa mple.com/', 'https://user:pass@example.com/rika/']) {
    assert.equal(rikaProgressUrl(value, 'c1'), null);
  }
});

test('rikaProgressUrl: 空・記号つき・文字列でないクラス id は使わない', () => {
  for (const id of ['', ' ', 'c-1', 'c_1', 'c/1', 'c1&teacher=0', 'c1#home', 'クラス1', undefined, null, 123, true, [], ['c1'], {}]) {
    assert.equal(rikaProgressUrl('https://example.com/rika/', id), null);
  }
});
