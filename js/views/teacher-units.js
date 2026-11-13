// 先生の単元の画面（#/t/units）。単元は消さず、名前と並び順を変えて使う。
import { el, confirmDialog, toast, statusChip } from '../ui.js';
import { CONFIG } from '../config.js';
import { newId } from '../ids.js';
import { schoolYear } from '../roster-logic.js';
import { checkUnitName, sortUnits, moveInOrder } from '../lesson-logic.js';
import { teacherNav } from './parts/teacher-nav.js';

export function mount(root, ctx) {
  let alive = true;
  let loading = false;
  let busy = false;
  let classesReady = false;
  let ready = false;
  const currentYear = schoolYear(ctx.now());
  let year = currentYear;
  let units = [];
  let editor = null;
  let orderButtons = [];
  const dirty = () => editor !== null && editor.dirty();

  async function okToLeave() {
    if (busy) { toast('保存しています。終わるまで待ってください。'); return false; }
    if (!dirty()) return true;
    return confirmDialog({
      title: '保存していない変更があります',
      body: '単元の名前が、まだ保存されていません。保存しないで進むと、変更は消えます。進みますか？',
      okLabel: '保存しないで進む', cancelLabel: 'この画面に残る',
    });
  }
  if (ctx.setLeaveGuard) ctx.setLeaveGuard(okToLeave);
  const onBeforeUnload = (ev) => {
    if (!dirty() && !busy) return;
    ev.preventDefault();
    ev.returnValue = '';
  };
  window.addEventListener('beforeunload', onBeforeUnload);

  const yearSelect = el('select', { id: 'unit-year', onchange: changeYear });
  const createBtn = el('button', { type: 'button', class: 'btn btn-primary', text: '単元を作る', onclick: () => showForm() });
  const formArea = el('div', { class: 'form-area' });
  const progress = el('div', { class: 'page-message', role: 'status', 'aria-live': 'polite' });
  const listArea = el('div');
  root.replaceChildren(teacherNav({ ...ctx, okToLeave }, 'units'),
    el('main', { class: 'page-main' },
      el('h1', { text: '単元' }),
      el('div', { class: 'lesson-filters' }, el('div', { class: 'field' },
        el('label', { class: 'label', for: 'unit-year', text: '年度' }), yearSelect)),
      el('div', { class: 'page-actions' }, createBtn), formArea, progress, listArea));

  function syncControls() {
    if (!alive) return;
    const locked = loading || busy;
    for (const control of root.querySelectorAll('button, input, select')) control.disabled = locked;
    yearSelect.disabled = locked || !classesReady;
    createBtn.disabled = locked || !ready;
    for (const { button, edge } of orderButtons) button.disabled = locked || edge;
  }

  function closeForm() {
    editor = null;
    formArea.replaceChildren();
  }

  async function changeYear() {
    const next = Number(yearSelect.value);
    yearSelect.value = String(year);
    if (loading || !(await okToLeave()) || !alive) return;
    closeForm();
    year = next;
    yearSelect.value = String(year);
    await load();
  }

  async function showForm(unit = null) {
    if (loading || !ready || !(await okToLeave()) || !alive) return;
    const initial = unit ? unit.name : '';
    const input = el('input', { id: 'unit-name', type: 'text', value: initial, autocomplete: 'off' });
    const error = el('div', { class: 'error', role: 'alert', hidden: true });
    const showError = (text) => { error.textContent = text; error.hidden = false; };
    const save = el('button', { type: 'submit', class: 'btn btn-primary', text: unit ? '変える' : '作る' });
    const cancel = el('button', {
      type: 'button', class: 'btn', text: 'やめる',
      onclick: async () => { if (await okToLeave() && alive) closeForm(); },
    });
    // 応答だけが失われても、同じ入力のやり直しで単元を増やさない。
    const id = unit ? unit.id : newId(ctx.random, CONFIG.idLength);
    const form = el('form', { class: 'card inline-form', novalidate: true, 'aria-label': unit ? '名前を変える' : '単元を作る' },
      el('h2', { text: unit ? '名前を変える' : '単元を作る' }),
      el('div', { class: 'field' },
        el('label', { class: 'label', for: 'unit-name', text: '単元の名前' }),
        el('p', { class: 'small muted field-hint', text: `${CONFIG.unitNameMax} 文字まで` }), input),
      error, el('div', { class: 'dialog-actions' }, cancel, save));
    editor = { dirty: () => input.value !== initial };
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (busy || loading) return;
      error.hidden = true;
      const name = input.value.trim();
      const code = checkUnitName(name, { max: CONFIG.unitNameMax });
      if (code) {
        showError(code === 'empty' ? '単元の名前を入れてください。' : `単元の名前は ${CONFIG.unitNameMax} 文字までです。`);
        return;
      }
      busy = true;
      syncControls();
      progress.replaceChildren(statusChip('info', '保存しています…'));
      try {
        if (unit) await ctx.repo.renameUnit(id, name);
        else await ctx.repo.createUnit(id, { year, name, order: Math.max(-1, ...units.map((u) => u.order)) + 1 });
        if (!alive) return;
        closeForm();
        toast(unit ? '名前を変えました。' : '単元を作りました。');
        await load();
      } catch {
        if (alive) showError('つながりません。もう一度ためしてください。');
      } finally {
        busy = false;
        if (alive) { progress.replaceChildren(); syncControls(); }
      }
    });
    formArea.replaceChildren(form);
    input.focus();
  }

  async function move(unit, dir) {
    if (busy || loading) return;
    const orders = moveInOrder(units, unit.id, dir);
    if (Object.keys(orders).length === 0) return;
    busy = true;
    syncControls();
    progress.replaceChildren(statusChip('info', '保存しています…'));
    try {
      await ctx.repo.setUnitOrders(orders);
      if (!alive) return;
      toast('並び順を変えました。');
      await load();
    } catch {
      if (alive) toast('つながりません。もう一度ためしてください。');
    } finally {
      busy = false;
      if (alive) { progress.replaceChildren(); syncControls(); }
    }
  }

  function renderUnits() {
    orderButtons = [];
    if (units.length === 0) {
      listArea.replaceChildren(el('p', { class: 'home-empty', text: 'まだ単元がありません。「単元を作る」で作ってください。' }));
      return;
    }
    listArea.replaceChildren(el('ul', { class: 'unit-rows' }, units.map((unit, index) => {
      const arrows = [[-1, '上へ'], [1, '下へ']].map(([dir, label]) => {
        const button = el('button', {
          type: 'button', class: 'btn', text: label,
          'aria-label': `「${unit.name}」を${label}`, onclick: () => move(unit, dir),
        });
        orderButtons.push({ button, edge: dir === -1 ? index === 0 : index === units.length - 1 });
        return button;
      });
      return el('li', { class: 'unit-row' },
        el('span', { class: 'unit-name', text: unit.name }),
        el('div', { class: 'unit-actions' },
          el('button', {
            type: 'button', class: 'btn', text: '名前を変える',
            'aria-label': `「${unit.name}」の名前を変える`, onclick: () => showForm(unit),
          }), arrows));
    })));
  }

  async function load() {
    loading = true;
    ready = false;
    listArea.replaceChildren(el('p', { class: 'loading', role: 'status', text: '読みこんでいます…' }));
    syncControls();
    try {
      if (!classesReady) {
        const classes = await ctx.repo.listClasses();
        if (!alive) return;
        const years = [...new Set([currentYear, ...classes.map((c) => c.year)])].sort((a, b) => b - a);
        yearSelect.replaceChildren(...years.map((y) => el('option', { value: String(y), text: `${y} 年度` })));
        yearSelect.value = String(year);
        classesReady = true;
      }
      const loaded = await ctx.repo.listUnits(year);
      if (!alive) return;
      units = sortUnits(loaded);
      ready = true;
      renderUnits();
    } catch {
      if (alive) listArea.replaceChildren(
        el('p', { class: 'error', role: 'alert', text: 'つながりません。もう一度ためしてください。' }),
        el('button', { type: 'button', class: 'btn', text: 'もう一度ためす', onclick: () => load() }));
    } finally {
      loading = false;
      syncControls();
    }
  }

  load();
  return () => {
    alive = false;
    window.removeEventListener('beforeunload', onBeforeUnload);
  };
}
