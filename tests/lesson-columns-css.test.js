import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');

test('授業の2列: 資料と記録の枠を同じ高さにのばす', () => {
  const rule = css.match(/^\s*\.student-lesson-columns\s*\{([^}]*)\}/m);
  assert.ok(rule);
  assert.match(rule[1], /(?:^|;)\s*align-items:\s*stretch\s*(?:;|$)/);
});

for (const [section, label] of [['teacher', '先生の資料'], ['mine', '自分の記録']]) {
  test(`${label}: 高さの上限と枠の中のスクロールを設けない`, () => {
    const rule = css.match(new RegExp(`^\\s*\\.student-lesson-${section}\\s*\\{([^}]*)\\}`, 'm'));
    assert.ok(rule);
    assert.doesNotMatch(rule[1], /max-height|overflow/);
  });
}

test('資料と記録のすべてのルール: 高さの上限と縦スクロールを設けない', () => {
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selector]) => /\.student-lesson-(teacher|mine)(?![\w-])/.test(selector));
  assert.ok(rules.length > 0);
  for (const [, selector, declarations] of rules) {
    assert.doesNotMatch(declarations, /(?:^|;)\s*(max-height|overflow-y)\s*:/i, selector.trim());
  }
});
