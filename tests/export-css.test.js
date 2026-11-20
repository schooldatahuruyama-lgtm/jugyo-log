import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const screen = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');
const print = readFileSync(new URL('../css/print.css', import.meta.url), 'utf8');
const rule = (css, selector) => css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]+)\\}`))?.[1] ?? '';

test('読み物は授業ごとに改ページし、絵と見出しの途中で切らない', () => {
  assert.match(print, /@media print\s*\{/);
  assert.match(rule(print, '.export-lesson'), /break-before:\s*page/);
  assert.match(rule(print, '.export-cover + .export-lesson'), /break-before:\s*auto/);
  const images = rule(print, '.export-reading img');
  assert.match(images, /break-inside:\s*avoid/); assert.match(images, /max-height:\s*240mm/);
  assert.match(images, /max-width:\s*100%/);
  assert.match(print, /\.export-reading h1[^{}]*\.export-reading h4\s*\{[^}]*break-after:\s*avoid/);
  assert.match(print, /\.no-print, button, \.btn\s*\{\s*display:\s*none !important/);
});

test('ID 一覧の印刷規則も残す', () => {
  assert.match(rule(print, '.sheet-table'), /border-collapse:\s*collapse/);
  assert.match(rule(print, '.sheet-table thead'), /display:\s*table-header-group/);
  assert.match(rule(print, '.sheet-table td'), /border-bottom:\s*1pt dashed/);
  assert.match(rule(print, '.sheet-table tr'), /break-inside:\s*avoid/);
  assert.match(rule(print, '.sheet-table .sheet-name'), /width:\s*40%/);
  assert.match(rule(print, '.sheet-pw'), /font-size:\s*16pt/);
});

test('読み物の幅、改行、絵の縮小、押しやすいボタン', () => {
  assert.match(rule(screen, '.export-reading'), /max-width:\s*800px/);
  assert.match(rule(screen, '.export-text'), /white-space:\s*pre-wrap/);
  assert.match(rule(screen, '.export-text'), /overflow-wrap:\s*anywhere/);
  assert.match(rule(screen, '.export-reading img'), /max-width:\s*100%/);
  assert.match(rule(screen, '.export-reading img'), /height:\s*auto/);
  assert.match(rule(screen, '.export-page button'), /min-height:\s*44px/);
});
