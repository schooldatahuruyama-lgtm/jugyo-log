import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanLinkUrl, checkLink, youtubeId, youtubeStart, embedUrl, linkHost, linkLabel, linkList, nextLinkOrder } from '../js/link-logic.js';

const id = 'Abcdef12_-3';
const watch = `https://www.youtube.com/watch?v=${id}`;
const limits = { urlMax: 500, titleMax: 60 };

test('リンク: https だけを受け取り、空白・ホスト名・末尾をそろえる', () => {
  for (const value of ['http://example.com', 'javascript:alert(1)', 'data:text/plain,test', 'ftp://example.com',
    '//example.com', ' ', '', 123, null, undefined, {}, [], 'https://', 'https://a:b@example.com', 'https://a@example.com']) {
    assert.equal(cleanLinkUrl(value), null, String(value));
  }
  assert.equal(cleanLinkUrl('https://example.com'), 'https://example.com/');
  assert.equal(cleanLinkUrl('  https://example.com/a  '), 'https://example.com/a');
  assert.equal(cleanLinkUrl('HTTPS://Example.com/a'), 'https://example.com/a');
});

test('リンク: 入力エラーを順に返し、500 文字・60 文字までは受け取る', () => {
  const check = (url, title = '') => checkLink({ url, title }, limits);
  for (const value of ['', ' ', null, 3, {}]) assert.equal(check(value), 'no-url');
  assert.equal(check('http://example.com'), 'bad-url');
  assert.equal(check('https://a:b@example.com'), 'bad-url');
  assert.equal(check('https://example.com', null), 'bad-title');
  const url = 'https://example.com/' + 'a'.repeat(480);
  assert.equal(url.length, 500);
  assert.equal(check(` ${url} `, ` ${'あ'.repeat(60)} `), null);
  assert.equal(check(url + 'a'), 'long-url');
  assert.equal(check(url, 'あ'.repeat(61)), 'long-title');
  assert.equal(check(url, '  '), null);
});

test('YouTube: 対応するホストとパスから 11 文字の ID だけを取る', () => {
  for (const url of [watch, `https://youtube.com/watch?v=${id}`, `https://m.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}`, `https://www.youtube-nocookie.com/embed/${id}`,
    ...['shorts', 'embed', 'live'].map((path) => `https://youtube.com/${path}/${id}`)]) {
    assert.equal(youtubeId(url), id, url);
  }
  for (const bad of ['a'.repeat(10), 'a'.repeat(12), 'abc!ef12_-3']) assert.equal(youtubeId(`https://youtube.com/watch?v=${bad}`), null);
  for (const url of [`https://evil-youtube.com/watch?v=${id}`, `https://youtube.com.example.org/watch?v=${id}`,
    `https://www.youtube-nocookie.com/watch?v=${id}`, 'https://youtube.com/watch', `http://youtube.com/watch?v=${id}`,
    `https://youtube.com/embed/${id}/extra`, null]) assert.equal(youtubeId(url), null);
});

test('YouTube: 時刻の形・優先順位・0 と 86400 秒の境界を確かめる', () => {
  for (const [query, seconds] of [['t=90', 90], ['t=90s', 90], ['t=1m30s', 90], ['t=1h2m3s', 3723],
    ['start=15', 15], ['t=abc', 0], ['t=-5', 0], ['t=999999', 0], ['t=86400', 86400], ['t=86401', 0],
    ['t=0', 0], ['t=&start=15', 0], ['t=5&start=15', 5], ['t=1.5', 0], ['t=1m30', 0]]) {
    assert.equal(youtubeStart(`${watch}&${query}`), seconds, query);
  }
  assert.equal(youtubeStart('invalid'), 0);
  assert.equal(youtubeStart(watch), 0);
});

test('YouTube: 埋めこみ先は nocookie に固定し、開始秒があるときだけ付ける', () => {
  const src = `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1`;
  assert.equal(embedUrl(watch), src);
  assert.equal(embedUrl(`${watch}&t=1m30s`), `${src}&start=90`);
  assert.equal(embedUrl('https://example.com/'), null);
});

test('リンク一覧: 順番と ID で並べ、不正な項目のアドレスは外へ出さない', () => {
  const good = { url: ' HTTPS://Example.com ', title: '', order: 1 };
  const links = { b: good, a: { ...good }, video: { ...good, url: watch, order: 0 },
    bad: { ...good, url: 'javascript:alert(1)', order: 2 }, badTitle: { ...good, title: 3, order: 3 },
    badOrder: { ...good, order: '4' }, negative: { ...good, order: -1 }, infinite: { ...good, order: Infinity },
    nan: { ...good, order: NaN }, text: 'ignored', number: 5, array: [], empty: null };
  const list = linkList(links);
  assert.deepEqual(list.slice(0, 6).map((link) => link.id), ['negative', 'video', 'a', 'b', 'bad', 'badTitle']);
  assert.equal(list.find((link) => link.id === 'a').url, 'https://example.com/');
  assert.equal(list.find((link) => link.id === 'video').video, true);
  assert.equal(list.find((link) => link.id === 'a').video, false);
  for (const name of ['bad', 'badTitle', 'badOrder', 'negative', 'infinite', 'nan']) {
    const link = list.find((link) => link.id === name);
    assert.equal(link.ok, false); assert.equal(link.video, false); assert.equal(link.url, '');
  }
  assert.equal(list.find((link) => link.id === 'badTitle').title, '');
  assert.equal(list.find((link) => link.id === 'badOrder').order, Number.MAX_SAFE_INTEGER);
  assert.equal(list.length, 9);
  for (const value of [null, undefined, 1, 'text', []]) assert.deepEqual(linkList(value), []);
});

test('リンク: 表示名とホスト名、次の順番を求める', () => {
  assert.equal(linkHost('https://www.example.com/a'), 'example.com');
  assert.equal(linkHost('bad'), '');
  for (const url of [watch, `https://youtu.be/${id}`]) {
    assert.equal(linkLabel({ title: '  動画  ', url }), '動画');
    for (const title of ['', ' ', undefined]) assert.equal(linkLabel({ title, url }), 'YouTube の動画');
  }
  assert.equal(linkLabel({ title: '  サイト  ', url: 'https://www.example.com/a' }), 'サイト');
  assert.equal(linkLabel({ title: ' ', url: 'https://www.example.com/a' }), 'example.com');
  assert.equal(linkLabel({ url: 'https://youtube.com/watch' }), 'youtube.com');
  for (const link of [null, undefined, {}, { title: ' ' }]) assert.equal(linkLabel(link), '');
  assert.equal(linkLabel({ title: 1, url: 'invalid' }), '');
  assert.equal(nextLinkOrder({ a: { order: 3 }, b: { order: 6 }, c: { order: Infinity }, d: { order: -1 }, e: { order: '9' } }), 7);
  assert.equal(nextLinkOrder({ a: { order: -1 }, b: null }), 0);
  assert.equal(nextLinkOrder(null), 0);
});
