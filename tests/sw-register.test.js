import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldRegister, workerUrl } from '../js/sw-register.js';

test('ローカルは sw=1 のときだけ登録する', () => {
  for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
    for (const search of ['', '?sw=0', '?other=sw=1', '?sw=10']) assert.equal(shouldRegister({ hostname, search, hasWorker: true }), false);
    for (const search of ['?sw=1', '?demo=1&sw=1']) assert.equal(shouldRegister({ hostname, search, hasWorker: true }), true);
  }
});

test('公開先は登録し、Worker が無い環境では登録しない', () => {
  assert.equal(shouldRegister({ hostname: 'school.example', search: '', hasWorker: true }), true);
  for (const hostname of ['localhost', 'school.example']) assert.equal(shouldRegister({ hostname, search: '?sw=1', hasWorker: false }), false);
  assert.equal(workerUrl('abc1234'), 'sw.js?v=abc1234');
  assert.equal(workerUrl('a &/?'), 'sw.js?v=a%20%26%2F%3F');
});
