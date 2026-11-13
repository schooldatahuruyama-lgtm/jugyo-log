// 画面を離れてよいかをたずねる仕組み（js/leave-guard.js）を確かめる。DOM は使わない
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLeaveGuard, decideHashChange } from '../js/leave-guard.js';

test('guard が無ければ、たずねずに離れてよい', async () => {
  const g = createLeaveGuard();
  assert.equal(g.active, false);
  assert.equal(await g.ask(), true);
});

test('guard の答え（true / false / Promise）に従う', async () => {
  const g = createLeaveGuard();
  g.set(() => false);
  assert.equal(await g.ask(), false);
  g.set(() => true);
  assert.equal(await g.ask(), true);
  g.set(async () => false);
  assert.equal(await g.ask(), false);
  g.set(null);
  assert.equal(g.active, false);
  assert.equal(await g.ask(), true);
});

test('clear で外すと、もうたずねない', async () => {
  const g = createLeaveGuard();
  let n = 0;
  g.set(() => { n += 1; return false; });
  g.clear();
  assert.equal(await g.ask(), true);
  assert.equal(n, 0);
});

test('たずねている途中に、もう一度たずねられたら、2 回目はたずねずに false', async () => {
  const g = createLeaveGuard();
  let n = 0;
  let answer;
  g.set(() => { n += 1; return new Promise((r) => { answer = r; }); });
  const first = g.ask();
  const second = await g.ask();
  assert.equal(second, false);
  answer(true);
  assert.equal(await first, true);
  assert.equal(n, 1);
});

test('guard が例外を投げたら、閉じこめないように離れてよいとする', async () => {
  const g = createLeaveGuard();
  g.set(() => { throw new Error('こわれた'); });
  assert.equal(await g.ask(), true);
});

test('decideHashChange: 同じハッシュなら何もしない（元に戻したあと、もう一度たずねない）', async () => {
  const g = createLeaveGuard();
  let n = 0;
  g.set(() => { n += 1; return false; });
  assert.equal(await decideHashChange({ guard: g, shown: '#/t/class/A', to: '#/t/class/A' }), 'none');
  assert.equal(n, 0);
});

test('decideHashChange: 離れてよければ render、だめなら restore', async () => {
  const g = createLeaveGuard();
  g.set(() => true);
  assert.equal(await decideHashChange({ guard: g, shown: '#/t/class/A', to: '#/t' }), 'render');
  g.set(() => false);
  assert.equal(await decideHashChange({ guard: g, shown: '#/t/class/A', to: '#/t' }), 'restore');
  g.set(null);
  assert.equal(await decideHashChange({ guard: g, shown: '#/t/class/A', to: '#/t' }), 'render');
});
