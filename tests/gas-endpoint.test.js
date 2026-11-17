import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { gasEndpoint } from '../js/gas-endpoint.js';

const directUrl = 'https://gas.example.test/exec';

test('中つぎが空・文字でないときは、今のアドレスをそのまま返す', () => {
  for (const relayUrl of ['', undefined, null, 0, 42, false, {}, []]) {
    for (const target of ['app', 'check']) assert.equal(gasEndpoint({ relayUrl, target, directUrl }), directUrl);
  }
  assert.equal(gasEndpoint({ relayUrl: '', target: 'app', directUrl: '' }), '');
});

test('HTTPS の中つぎは末尾の / をすべて取り、app・check の道を付ける', () => {
  for (const base of ['https://relay.example.test', 'https://relay.example.test/nested']) {
    for (const suffix of ['', '/', '///']) {
      for (const target of ['app', 'check']) {
        assert.equal(gasEndpoint({ relayUrl: base + suffix, target, directUrl }), base + '/gas/' + target);
      }
    }
  }
});

test('手元の localhost・127.0.0.1 は HTTP でも使える', () => {
  for (const host of ['localhost', '127.0.0.1']) {
    for (const suffix of ['', ':8792', ':8792/nested']) {
      const relayUrl = 'http://' + host + suffix;
      for (const target of ['app', 'check']) {
        assert.equal(gasEndpoint({ relayUrl: relayUrl + '///', target, directUrl }), relayUrl + '/gas/' + target);
      }
    }
  }
});

test('中つぎの不正な方式と、手元に似せた外部ホストは TypeError', () => {
  for (const relayUrl of [
    'http://example.com', '//relay.example.test', 'ftp://relay.example.test', 'javascript:void(0)', ' ',
    'http://localhost.example.test', 'http://127.0.0.1.example.test', 'http://localhost@other.example.test',
    'http://localhost:80@other.example.test', 'http://127.0.0.12',
  ]) assert.throws(() => gasEndpoint({ relayUrl, target: 'app', directUrl }), TypeError);
});

test('中つぎの送り先は app・check 以外を受けつけない', () => {
  for (const target of [undefined, null, '', 'other', 'APP', 'toString', '../app', 1]) {
    assert.throws(() => gasEndpoint({ relayUrl: 'https://relay.example.test', target, directUrl }), TypeError);
  }
});

// 本体の初期化を代役で動かし、createGas に渡る URL と練習モードの分岐を確かめる。
const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const backend = main.slice(main.indexOf('function createBackend('), main.indexOf('\nfunction showDemoBanner('));

function createBackend(relayUrl, demo = false) {
  const calls = [];
  const demoGas = {};
  const result = vm.runInNewContext(backend + '\ncreateBackend({});', {
    location: { hostname: 'localhost', search: demo ? '?demo=1' : '' },
    window: { fetch() {}, setTimeout() {}, clearTimeout() {} },
    FIREBASE: { databaseURL: 'https://db.example.test', apiKey: 'test-only-key' },
    GAS: { relayUrl, appUrl: directUrl, url: 'https://check.example.test' },
    now: () => 0, random: () => 0,
    isDemoAllowed: () => demo,
    createDemoBackend: () => ({ gas: demoGas, net: {}, auth: {} }),
    createAuth: () => ({}), createNet: () => ({}),
    createGas: (options) => { calls.push(options); return {}; },
    gasEndpoint,
  });
  return { calls, result, demoGas };
}

test('main.js は中つぎなしなら本番 URL、ありなら /gas/app を createGas に渡す', () => {
  assert.match(main, /import \{ gasEndpoint \} from '\.\/gas-endpoint\.js';/);
  for (const relayUrl of ['', 'https://relay.example.test///']) {
    const h = createBackend(relayUrl);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].url, relayUrl ? 'https://relay.example.test/gas/app' : directUrl);
  }
});

test('練習モードは中つぎの設定にかかわらず GAS を作らない', () => {
  for (const relayUrl of ['', 'https://relay.example.test', 'http://invalid.example.test']) {
    const h = createBackend(relayUrl, true);
    assert.equal(h.calls.length, 0);
    assert.equal(h.result.gas, h.demoGas);
  }
});
