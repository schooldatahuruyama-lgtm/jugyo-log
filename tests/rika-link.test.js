import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../js/config.js';
import { rikaEntryUrl } from '../js/rika-link.js';

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
