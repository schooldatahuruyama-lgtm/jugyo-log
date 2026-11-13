// 段階 0 用のデータベース規則と、設定ファイルの形を確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const at = (p) => join(root, p);

const { rules } = JSON.parse(readFileSync(at('docs/setup/rules-check.json'), 'utf8'));

test('根では、だれも読めず、だれも書けない', () => {
  assert.equal(rules['.read'], false);
  assert.equal(rules['.write'], false);
});

test('check/ping は、だれでも読めて、だれも書けない', () => {
  const ping = rules.check.ping;
  assert.equal(ping['.read'], true);
  assert.equal('.write' in ping, false);
});

test('check/<uid> は、その uid の本人だけが読み書きでき、数だけを置ける', () => {
  const own = rules.check.$uid;
  const cond = 'auth != null && auth.uid === $uid';
  assert.equal(own['.read'], cond);
  assert.equal(own['.write'], cond);
  assert.equal(own['.validate'], 'newData.isNumber()');
});

test('設定ファイルの形が決まりどおりで、値は文字列', async () => {
  const fb = await import(pathToFileURL(at('js/firebase-config.js')).href);
  assert.deepEqual(Object.keys(fb.FIREBASE).sort(), ['apiKey', 'databaseURL']);
  assert.equal(typeof fb.FIREBASE.databaseURL, 'string');
  assert.equal(typeof fb.FIREBASE.apiKey, 'string');

  const gas = await import(pathToFileURL(at('js/gas-config.js')).href);
  assert.deepEqual(Object.keys(gas.GAS).sort(), ['appUrl', 'url']);
  assert.equal(typeof gas.GAS.appUrl, 'string');
  assert.equal(typeof gas.GAS.url, 'string');
});
