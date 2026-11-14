// 先生の授業の一覧（#/t/lessons）。選んだ年度とクラスは、この画面にいる間だけ持つ。
import { el, confirmDialog, toast, statusChip } from '../ui.js';
import { CONFIG } from '../config.js';
import { newId } from '../ids.js';
import { schoolYear } from '../roster-logic.js';
import { checkLesson, sortLessons, sortUnits, materialList, todayString, dateLabel } from '../lesson-logic.js';
import { deleteLessonFlow } from '../lesson-flow.js';
import { teacherNav } from './parts/teacher-nav.js';

function lessonError(code) {
  if (code === 'bad-date') return '日付を正しく入れてください。';
  if (code === 'no-title') return '授業名を入れてください。';
  return `授業名は ${CONFIG.lessonTitleMax} 文字までです。`;
}

export function mount(root, ctx) {
  let alive = true;
  let loading = false;
  let busy = false;
  let classesReady = false;
  let ready = false;
  const currentYear = schoolYear(ctx.now());
  let year = currentYear;
  let classId = '';
  let classes = [];
  let units = [];
  let lessons = [];
  let editor = null;
  const yearClasses = () => classes.filter((c) => c.year === year);
  const dirty = () => editor !== null && editor.dirty();

  async function okToLeave() {
    if (busy) { toast('処理しています。終わるまで待ってください。'); return false; }
    if (!dirty()) return true;
    return confirmDialog({
      title: '保存していない変更があります',
      body: '授業の入力が、まだ保存されていません。保存しないで進むと、変更は消えます。進みますか？',
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

  const yearSelect = el('select', { id: 'lesson-year', onchange: () => changeSelection('year') });
  const classSelect = el('select', { id: 'lesson-class', onchange: () => changeSelection('class') });
  const createBtn = el('button', { type: 'button', class: 'btn btn-primary', text: '授業を作る', onclick: showCreateForm });
  const formArea = el('div', { class: 'form-area' });
  const progress = el('div', { class: 'page-message', role: 'status', 'aria-live': 'polite' });
  const message = el('div', { class: 'page-message', role: 'status', 'aria-live': 'polite' });
  const listArea = el('div');
  root.replaceChildren(teacherNav({ ...ctx, okToLeave }, 'lessons'),
    el('main', { class: 'page-main' },
      el('h1', { text: '授業' }),
      el('div', { class: 'lesson-filters' },
        el('div', { class: 'field' }, el('label', { class: 'label', for: 'lesson-year', text: '年度' }), yearSelect),
        el('div', { class: 'field' }, el('label', { class: 'label', for: 'lesson-class', text: 'クラス' }), classSelect)),
      el('div', { class: 'page-actions' }, createBtn), formArea, progress, message, listArea));

  function syncControls() {
    if (!alive) return;
    const locked = loading || busy;
    for (const control of root.querySelectorAll('button, input, select')) control.disabled = locked;
    yearSelect.disabled = locked || !classesReady;
    classSelect.disabled = locked || !classesReady || yearClasses().length === 0;
    createBtn.disabled = locked || !ready || !classId;
  }

  function closeForm() {
    editor = null;
    formArea.replaceChildren();
  }

  function fillClasses() {
    const choices = yearClasses();
    classId = choices[0]?.id || '';
    classSelect.replaceChildren(...(choices.length
      ? choices.map((c) => el('option', { value: c.id, text: c.name }))
      : [el('option', { value: '', text: 'クラスがありません' })]));
    classSelect.value = classId;
  }

  async function changeSelection(kind) {
    const next = kind === 'year' ? Number(yearSelect.value) : classSelect.value;
    yearSelect.value = String(year);
    classSelect.value = classId;
    if (loading || !(await okToLeave()) || !alive) return;
    closeForm();
    message.replaceChildren();
    if (kind === 'year') {
      year = next;
      yearSelect.value = String(year);
      fillClasses();
    } else {
      classId = next;
      classSelect.value = classId;
    }
    await load();
  }

  async function showCreateForm() {
    if (loading || !ready || !classId || !(await okToLeave()) || !alive) return;
    const date = el('input', { id: 'lesson-date', type: 'date', value: todayString(ctx.now()) });
    const title = el('input', { id: 'lesson-title', type: 'text', autocomplete: 'off' });
    const unit = el('select', { id: 'lesson-unit' },
      el('option', { value: '', text: '（なし）' }),
      units.map((u) => el('option', { value: u.id, text: u.name })));
    const targets = yearClasses().map((c) => ({
      cls: c, input: el('input', { type: 'checkbox', checked: c.id === classId }),
      lessonId: newId(ctx.random, CONFIG.idLength),
    }));
    const snapshot = () => JSON.stringify([date.value, title.value, unit.value, targets.map((t) => t.input.checked)]);
    const baseline = snapshot();
    const error = el('div', { class: 'error', role: 'alert', hidden: true });
    const showError = (text) => { error.textContent = text; error.hidden = false; };
    const save = el('button', { type: 'submit', class: 'btn btn-primary', text: '作る' });
    const cancel = el('button', {
      type: 'button', class: 'btn', text: 'やめる',
      onclick: async () => { if (await okToLeave() && alive) closeForm(); },
    });
    const form = el('form', { class: 'card inline-form', novalidate: true, 'aria-label': '授業を作る' },
      el('h2', { text: '授業を作る' }),
      el('div', { class: 'field' }, el('label', { class: 'label', for: 'lesson-date', text: '日付' }), date),
      el('div', { class: 'field' },
        el('label', { class: 'label', for: 'lesson-title', text: '授業名' }),
        el('p', { class: 'small muted field-hint', text: `${CONFIG.lessonTitleMax} 文字まで` }), title),
      el('div', { class: 'field' }, el('label', { class: 'label', for: 'lesson-unit', text: '単元' }), unit),
      el('fieldset', { class: 'lesson-targets' }, el('legend', { class: 'label', text: '対象のクラス' }),
        el('div', { class: 'check-list' }, targets.map(({ cls, input }) =>
          el('label', { class: 'check-row' }, input, el('span', { text: cls.name }))))),
      error, el('div', { class: 'dialog-actions' }, cancel, save));
    editor = { dirty: () => snapshot() !== baseline };
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (busy || loading) return;
      error.hidden = true;
      const values = { date: date.value, title: title.value.trim(), unitId: unit.value };
      const code = checkLesson(values, { titleMax: CONFIG.lessonTitleMax });
      if (code) { showError(lessonError(code)); return; }
      const selected = targets.filter((t) => t.input.checked);
      if (selected.length === 0) { showError('対象のクラスを 1 つ以上選んでください。'); return; }
      busy = true;
      syncControls();
      progress.replaceChildren(statusChip('info', '保存しています…'));
      try {
        await ctx.repo.createLessons(selected.map((t) => ({
          classId: t.cls.id, lessonId: t.lessonId, ...values,
        })), ctx.now());
        if (!alive) return;
        closeForm();
        toast('授業を作りました。');
        await load();
      } catch {
        if (alive) showError('つながりません。もう一度ためしてください。');
      } finally {
        busy = false;
        if (alive) { progress.replaceChildren(); syncControls(); }
      }
    });
    formArea.replaceChildren(form);
    title.focus();
  }

  async function removeLesson(lesson) {
    if (busy || loading) return;
    const cid = classId;
    busy = true;
    syncControls();
    message.replaceChildren();
    progress.replaceChildren(statusChip('info', '生徒の記録を確かめています…'));
    try {
      const count = await ctx.repo.countRecords(cid, lesson.id);
      if (!alive) return;
      if (count > 0) {
        message.replaceChildren(el('p', { class: 'notice', text: '生徒の記録がある授業は消せません。' }));
        return;
      }
      const ok = await confirmDialog({
        title: `「${lesson.title}」を消しますか？`,
        body: 'この授業と、置いてある資料の一覧を消します。', okLabel: '消す', danger: true,
      });
      if (!ok || !alive) return;
      progress.replaceChildren(statusChip('info', '消しています…'));
      const result = await deleteLessonFlow({ repo: ctx.repo, files: ctx.files, classId: cid, lesson });
      if (!alive) return;
      if (!result.deleted && result.reason === 'has-records') {
        message.replaceChildren(el('p', { class: 'notice', text: '生徒の記録がある授業は消せません。' }));
        return;
      }
      if (result.leftover > 0) {
        message.replaceChildren(el('p', { class: 'notice', text: '授業を消しました。一部のファイルを片付けられませんでした（Drive に残っています）。' }));
      } else {
        toast('授業を消しました。');
      }
      await load();
    } catch {
      if (alive) message.replaceChildren(el('p', { class: 'error', role: 'alert', text: 'つながりません。消せませんでした。もう一度ためしてください。' }));
    } finally {
      busy = false;
      if (alive) { progress.replaceChildren(); syncControls(); }
    }
  }

  function renderLessons() {
    if (!classId) {
      listArea.replaceChildren(el('p', { class: 'home-empty', text: '先にクラスを作ってください。' }));
      return;
    }
    if (lessons.length === 0) {
      listArea.replaceChildren(el('p', { class: 'home-empty', text: 'まだ授業がありません。「授業を作る」で作ってください。' }));
      return;
    }
    const unitNames = new Map(units.map((u) => [u.id, u.name]));
    listArea.replaceChildren(el('ul', { class: 'lesson-rows' }, lessons.map((lesson) => {
      const materials = materialList(lesson.materials);
      const boards = materials.filter((m) => m.kind === 'board').length;
      const handouts = materials.filter((m) => m.kind === 'handout').length;
      return el('li', { class: 'lesson-row' },
        el('button', {
          type: 'button', class: 'lesson-open',
          'aria-label': `${dateLabel(lesson.date)} ${lesson.title} を開く`,
          onclick: () => ctx.navigate('t-lesson', { classId, lessonId: lesson.id }),
        },
        el('span', { class: 'lesson-date', text: dateLabel(lesson.date) }),
        el('span', { class: 'lesson-summary' },
          el('span', { class: 'lesson-title', text: lesson.title || '（授業名なし）' }),
          el('span', { class: 'small', text: unitNames.get(lesson.unitId) || '（単元なし）' })),
        el('span', { class: 'lesson-count', text: `板書 ${boards}・資料 ${handouts}` })),
        el('button', {
          type: 'button', class: 'btn', text: '消す',
          'aria-label': `「${lesson.title}」を消す`, onclick: () => removeLesson(lesson),
        }));
    })));
  }

  async function load() {
    loading = true;
    ready = false;
    listArea.replaceChildren(el('p', { class: 'loading', role: 'status', text: '読みこんでいます…' }));
    syncControls();
    try {
      if (!classesReady) {
        classes = await ctx.repo.listClasses();
        if (!alive) return;
        const years = [...new Set([currentYear, ...classes.map((c) => c.year)])].sort((a, b) => b - a);
        yearSelect.replaceChildren(...years.map((y) => el('option', { value: String(y), text: `${y} 年度` })));
        yearSelect.value = String(year);
        fillClasses();
        classesReady = true;
      }
      if (classId) {
        const [loadedUnits, loadedLessons] = await Promise.all([ctx.repo.listUnits(year), ctx.repo.listLessons(classId)]);
        if (!alive) return;
        units = sortUnits(loadedUnits);
        lessons = sortLessons(loadedLessons);
      } else {
        units = [];
        lessons = [];
      }
      ready = true;
      renderLessons();
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
