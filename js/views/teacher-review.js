// 先生が生徒の記録を読む一覧。読み直すまでは、同じ記録を表示する。
import { el, toast, statusChip } from '../ui.js';
import { schoolYear } from '../roster-logic.js';
import { dateLabel, sortLessons } from '../lesson-logic.js';
import { LEVELS } from '../record-logic.js';
import { reviewPeople, reviewRows, levelCounts, levelLabel, defaultLesson, copyText } from '../review-logic.js';
import { teacherNav } from './parts/teacher-nav.js';

export function mount(root, ctx) {
  let alive = true;
  let loading = false;
  let ready = false;
  let copying = false;
  let navigatePending = false;
  let loadId = 0;
  let copyId = 0;
  const currentYear = schoolYear(ctx.now());
  let year = currentYear;
  let classId = ctx.params.classId || '';
  let lessonId = ctx.params.lessonId || '';
  let classes = [];
  let lessons = [];
  let people = [];
  let rows = [];
  let field = 'question';
  let sort = 'level';
  const fieldButtons = new Map();
  const sortButtons = new Map();
  const yearSelect = el('select', { id: 'review-year', onchange: () => changeSelection('year') });
  const classSelect = el('select', { id: 'review-class', onchange: () => changeSelection('class') });
  const lessonSelect = el('select', { id: 'review-lesson', onchange: () => changeSelection('lesson') });
  const reload = el('button', { type: 'button', class: 'btn', text: '読み直す', onclick: () => load({ chooseClass: !classId }) });
  const copy = el('button', { type: 'button', class: 'btn', text: '全員分をコピー', onclick: copyAll });
  const pageMessage = el('div', { class: 'page-message', role: 'status', 'aria-live': 'polite' });
  const chartArea = el('div');
  const listArea = el('div');
  const copyArea = el('div', { class: 'review-copy-area' });

  function choices(label, items, buttons, change) {
    return el('div', { class: 'review-choices', role: 'group', 'aria-label': label }, items.map(([value, text]) => {
      const button = el('button', { type: 'button', class: 'btn', text, 'aria-pressed': 'false',
        onclick: () => { if (!loading && ready) { change(value); renderRows(); syncControls(); } } });
      buttons.set(value, button);
      return button;
    }));
  }

  const content = el('div', { class: 'review-columns', hidden: true },
    el('section', { class: 'review-chart card', 'aria-labelledby': 'review-level-heading' },
      el('h2', { id: 'review-level-heading', text: '理解度' }), chartArea),
    el('section', { class: 'review-records', 'aria-labelledby': 'review-records-heading' },
      el('h2', { id: 'review-records-heading', text: '生徒の記録' }),
      choices('読む項目', [['question', '疑問'], ['learned', '分かったこと']], fieldButtons, (value) => { field = value; }),
      choices('並び順', [['level', '理解度が低い順'], ['number', '出席番号順']], sortButtons, (value) => { sort = value; }),
      el('div', { class: 'page-actions' }, copy), copyArea, listArea));
  root.replaceChildren(teacherNav(ctx, 'review'),
    el('main', { class: 'page-main review-page' },
      el('h1', { text: '記録' }),
      el('div', { class: 'review-filters' },
        el('div', { class: 'field' }, el('label', { class: 'label', for: 'review-year', text: '年度' }), yearSelect),
        el('div', { class: 'field' }, el('label', { class: 'label', for: 'review-class', text: 'クラス' }), classSelect),
        el('div', { class: 'field review-lesson-filter' }, el('label', { class: 'label', for: 'review-lesson', text: '授業' }), lessonSelect), reload),
      pageMessage, content));

  function syncControls() {
    if (!alive) return;
    yearSelect.disabled = loading;
    classSelect.disabled = loading || !classes.some((c) => c.year === year);
    lessonSelect.disabled = loading || lessons.length === 0;
    reload.disabled = loading;
    copy.disabled = loading || !ready || copying;
    for (const [value, button] of fieldButtons) {
      button.disabled = loading || !ready;
      button.setAttribute('aria-pressed', String(value === field));
    }
    for (const [value, button] of sortButtons) {
      button.disabled = loading || !ready;
      button.setAttribute('aria-pressed', String(value === sort));
    }
    for (const button of listArea.querySelectorAll('button')) button.disabled = loading || !ready;
  }

  function fillSelections() {
    const years = [...new Set([currentYear, ...classes.map((c) => c.year)])].sort((a, b) => b - a);
    yearSelect.replaceChildren(...years.map((y) => el('option', { value: String(y), text: `${y} 年度` })));
    yearSelect.value = String(year);
    const available = classes.filter((c) => c.year === year);
    const hasClass = available.some((c) => c.id === classId);
    classSelect.replaceChildren(...(hasClass ? [] : [el('option', { value: '', text: '（クラスを選んでください）' })]),
      ...available.map((c) => el('option', { value: c.id, text: c.name })));
    classSelect.value = hasClass ? classId : '';
    const hasLesson = lessons.some((l) => l.id === lessonId);
    lessonSelect.replaceChildren(...(hasLesson ? [] : [el('option', { value: '', text: '（授業を選んでください）' })]),
      ...lessons.map((l) => el('option', { value: l.id, text: `${dateLabel(l.date)} ${l.title || '（授業名なし）'}` })));
    lessonSelect.value = hasLesson ? lessonId : '';
  }

  function changeSelection(which) {
    if (!alive || loading) return;
    if (which === 'lesson') {
      if (lessonSelect.value) void ctx.navigate('t-review', { classId, lessonId: lessonSelect.value });
      return;
    }
    if (which === 'year') {
      year = Number(yearSelect.value);
      classId = '';
    } else classId = classSelect.value;
    lessonId = '';
    navigatePending = true;
    void load({ chooseClass: which === 'year' });
  }

  function renderChart() {
    const counts = levelCounts(people);
    const levels = [...LEVELS, { value: 'none', label: 'まだ入力なし' }];
    const max = Math.max(1, ...levels.map((level) => counts[level.value]));
    const bars = levels.map((level) => {
      const bar = el('span', { class: `review-bar review-bar-${level.value}` });
      bar.style.width = `${counts[level.value] / max * 100}%`;
      return el('div', { class: 'review-bar-row', 'aria-hidden': 'true' },
        el('div', { class: 'review-bar-label' }, el('span', { text: level.label }),
          el('strong', { text: `${counts[level.value]} 人` })),
        el('div', { class: 'review-bar-track' }, bar));
    });
    chartArea.replaceChildren(el('div', { role: 'img',
      'aria-label': levels.map((level) => `${level.label} ${counts[level.value]} 人`).join('、') }, bars),
    el('p', { class: 'review-total', text: `全部で ${counts.total} 人` }));
  }

  function clearCopy() {
    copyId += 1;
    copying = false;
    copyArea.replaceChildren();
  }

  function renderRows() {
    clearCopy();
    const sorted = reviewRows(people, { field, sort });
    // 名簿にいない人は、どちらの並び順でも最後に残す。
    rows = [...sorted.filter((row) => row.inRoster), ...sorted.filter((row) => !row.inRoster)];
    if (rows.length === 0) {
      listArea.replaceChildren(el('p', { text: 'このクラスには、まだ生徒がいません。' }));
      return;
    }
    listArea.replaceChildren(el('ul', { class: 'review-rows' }, rows.map((row) => {
      const label = !row.inRoster ? '名簿にいない' : row.number === null ? '出席番号なし' : `${row.number} 番`;
      const name = !row.inRoster || row.number === null ? `${label} ${row.studentId}` : label;
      const kind = row.level === null ? 'info' : row.level >= 3 ? 'ok' : 'warn';
      return el('li', {}, el('button', { type: 'button', class: 'review-row',
        'aria-label': `${name}の記録を開く`,
        onclick: () => ctx.navigate('t-record', { classId, lessonId, studentId: row.studentId }) },
      el('span', { class: 'review-row-heading' },
        el('span', { class: 'review-person', text: label }), statusChip(kind, levelLabel(row.level)),
        !row.inRoster || row.number === null ? el('span', { class: 'small', text: row.studentId }) : null),
      el('span', { class: 'review-text', text: row.text.trim() ? row.text : '（まだ書いていません）' })));
    })));
  }

  async function copyAll() {
    if (!alive || loading || !ready || copying) return;
    const result = copyText(rows);
    if (result.count === 0) { toast('コピーする文章がありません。'); return; }
    const current = ++copyId;
    copying = true;
    copyArea.replaceChildren();
    syncControls();
    try {
      if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('コピーを使えません');
      await navigator.clipboard.writeText(result.text);
      if (alive && current === copyId) toast(`${result.count} 人分をコピーしました。`);
    } catch {
      if (!alive || current !== copyId) return;
      const text = el('textarea', { id: 'review-copy-text', rows: 8, readonly: true, value: result.text });
      copyArea.replaceChildren(el('div', { class: 'notice' },
        el('p', { role: 'status', text: 'コピーできませんでした。下の文章を選んで、コピーしてください。' }),
        el('label', { class: 'label', for: 'review-copy-text', text: 'コピーする文章' }), text,
        el('button', { type: 'button', class: 'btn', text: '閉じる', onclick: () => { clearCopy(); syncControls(); copy.focus(); } })));
      text.focus();
      text.select();
    } finally {
      if (alive && current === copyId) { copying = false; syncControls(); }
    }
  }

  async function load(options = {}) {
    if (!alive) return;
    const current = ++loadId;
    const stale = () => !alive || current !== loadId;
    loading = true;
    ready = false;
    content.hidden = true;
    clearCopy();
    pageMessage.textContent = '読みこんでいます…';
    syncControls();
    try {
      const loadedClasses = await ctx.repo.listClasses();
      if (stale()) return;
      classes = loadedClasses;
      if (options.chooseClass) classId = classes.find((c) => c.year === year)?.id || '';
      const cls = classes.find((c) => c.id === classId);
      if (cls) year = cls.year;
      lessons = [];
      fillSelections();
      if (!cls) {
        pageMessage.textContent = classId ? 'この授業は見つかりません。' : '先にクラスを作ってください。';
        return;
      }
      const loadedLessons = await ctx.repo.listLessons(classId);
      if (stale()) return;
      lessons = sortLessons(loadedLessons);
      if (!lessonId) lessonId = defaultLesson(lessons, ctx.now()) || '';
      fillSelections();
      if (!lessons.some((l) => l.id === lessonId)) {
        pageMessage.textContent = lessonId ? 'この授業は見つかりません。' : 'このクラスには、まだ授業がありません。';
        return;
      }
      // 切りかえ先は、どちらの読み直しでもハッシュに反映する。
      if (navigatePending && (classId !== ctx.params.classId || lessonId !== ctx.params.lessonId)) {
        await ctx.navigate('t-review', { classId, lessonId });
        return;
      }
      navigatePending = false;
      const [lessonResult, membersResult, recordsResult] = await Promise.allSettled([
        ctx.repo.getLesson(classId, lessonId), ctx.repo.getMembers(classId), ctx.repo.listRecords(classId, lessonId),
      ]);
      if (stale()) return;
      if (lessonResult.status === 'fulfilled' && !lessonResult.value) {
        pageMessage.textContent = 'この授業は見つかりません。';
        return;
      }
      if ([lessonResult, membersResult, recordsResult].some((result) => result.status === 'rejected')) throw new Error('読みこめませんでした');
      people = reviewPeople(membersResult.value, recordsResult.value);
      ready = true;
      renderChart();
      renderRows();
      pageMessage.replaceChildren();
      content.hidden = false;
    } catch {
      if (!stale()) pageMessage.replaceChildren(
        el('p', { class: 'error', text: 'つながりません。もう一度ためしてください。' }),
        el('button', { type: 'button', class: 'btn', text: 'もう一度ためす', onclick: () => load(options) }));
    } finally {
      if (!stale()) { loading = false; syncControls(); }
    }
  }

  void load({ chooseClass: !classId });
  return () => { alive = false; loadId += 1; copyId += 1; };
}
