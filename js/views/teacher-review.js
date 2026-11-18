// 先生が生徒の記録を読む一覧。読み直すまでは、同じ記録を表示する。
import { el, toast, statusChip, confirmDialog } from '../ui.js';
import { isStudentId } from '../ids.js';
import { schoolYear } from '../roster-logic.js';
import { dateLabel, sortLessons } from '../lesson-logic.js';
import { reviewPeople, reviewRows, levelCounts, levelShares, filterRows, levelLabel, defaultLesson, copyText } from '../review-logic.js';
import { teacherNav } from './parts/teacher-nav.js';
import { replyMarkLabel, stampKind, stampTargets } from '../reply-logic.js';
import { lessonTerms } from '../term-logic.js';
import { summaryBox } from './parts/summary-box.js';
import { aiSummaryBox, createAiSummarySession } from './parts/ai-summary-box.js';

// 選択欄から同じ記録ページへ移る間だけ、作りかけを次の画面へ渡す。
const aiTransfers = new WeakMap();

export function mount(root, ctx) {
  let alive = true;
  let loading = false;
  let ready = false;
  let copying = false;
  let stamping = false;
  let repliesReady = false;
  const dialogs = new AbortController();
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
  let countedIds = new Set();
  let replies = {};
  let records = {};
  let attachmentCounts = new Map();
  let rows = [];
  let field = 'question';
  let sort = 'level';
  let levelKey = null;
  let summary = null;
  let aiSummary = null;
  let transferringAi = false;
  const aiSession = aiTransfers.get(ctx.repo) || createAiSummarySession({ repo: ctx.repo, now: ctx.now,
    request: typeof ctx.ai?.summarize === 'function' ? (request) => ctx.ai.summarize(request) : null });
  aiTransfers.delete(ctx.repo);
  const fieldButtons = new Map();
  const sortButtons = new Map();
  const levelButtons = new Map();
  const inkThumbs = new Map();
  const inkViews = new Map();
  const yearSelect = el('select', { id: 'review-year', onchange: () => changeSelection('year') });
  const classSelect = el('select', { id: 'review-class', onchange: () => changeSelection('class') });
  const lessonSelect = el('select', { id: 'review-lesson', onchange: () => changeSelection('lesson') });
  const reload = el('button', { type: 'button', class: 'btn', text: '読み直す', onclick: () => load({ chooseClass: !classId }) });
  const copy = el('button', { type: 'button', class: 'btn', text: '全員分をコピー', onclick: copyAll });
  const stampAll = el('button', { type: 'button', class: 'btn', text: '全員にスタンプを押す', onclick: stampAllReplies });
  const stampEmpty = el('span', { class: 'small', text: '（押す相手がいません）', hidden: true });
  const stampStatus = el('p', { class: 'reply-status', role: 'status', 'aria-live': 'polite' });
  const pageMessage = el('div', { class: 'page-message', role: 'status', 'aria-live': 'polite' });
  const chartArea = el('div');
  const summaryArea = el('div', { class: 'review-summary' });
  const listArea = el('div');
  const replyMessage = el('p', { class: 'notice', role: 'status', hidden: true });
  const filterStatus = el('div', { class: 'review-filter-status', role: 'status' });
  const showAll = el('button', { type: 'button', class: 'btn', text: '全員を出す', onclick: () => {
    const selected = levelButtons.get(levelKey);
    selectLevel(null);
    selected?.focus();
  } });
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
    summaryArea,
    el('section', { class: 'review-records', 'aria-labelledby': 'review-records-heading' },
      el('h2', { id: 'review-records-heading', text: '生徒の記録' }),
      choices('読む項目', [['question', '疑問'], ['learned', '分かったこと']], fieldButtons, (value) => {
        field = value;
        void loadInkThumbs(field);
      }),
      choices('並び順', [['level', '理解度が低い順'], ['number', '出席番号順']], sortButtons, (value) => { sort = value; }),
      el('div', { class: 'page-actions' }, copy, stampAll, stampEmpty), stampStatus, copyArea, filterStatus, replyMessage, listArea));
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
    yearSelect.disabled = loading || stamping;
    classSelect.disabled = loading || stamping || !classes.some((c) => c.year === year);
    lessonSelect.disabled = loading || stamping || lessons.length === 0;
    reload.disabled = loading || stamping;
    const targets = stampTargets({ students: people, records, replies });
    stampAll.disabled = loading || !ready || !repliesReady || stamping || targets.length === 0;
    stampEmpty.hidden = !ready || !repliesReady || targets.length !== 0;
    copy.disabled = loading || !ready || copying;
    showAll.disabled = loading || !ready;
    for (const [value, button] of levelButtons) {
      button.disabled = loading || !ready;
      button.setAttribute('aria-pressed', String(value === levelKey));
    }
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
    if (!alive || loading || stamping) return;
    levelKey = null;
    if (which === 'lesson') {
      if (lessonSelect.value) void changeReview({ classId, lessonId: lessonSelect.value });
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

  async function changeReview(params) {
    transferringAi = true;
    aiTransfers.set(ctx.repo, aiSession);
    try { await ctx.navigate('t-review', params); }
    finally {
      transferringAi = false;
      // 遷移が止まった・画面を読みこめなかった場合は、引き継ぎを残さない。
      if (aiTransfers.get(ctx.repo) === aiSession) {
        aiTransfers.delete(ctx.repo);
        if (!alive) aiSession.destroy();
      }
    }
  }

  function renderChart() {
    levelButtons.clear();
    const shares = levelShares(levelCounts(people.filter((person) => countedIds.has(person.studentId))));
    const present = shares.filter((item) => item.count > 0);
    if (present.length === 0) {
      chartArea.replaceChildren(el('p', { text: 'このクラスには、まだ生徒がいません。' }));
      return;
    }
    const band = el('div', { class: 'review-band', role: 'group', 'aria-label': '理解度でしぼりこむ' }, present.map(({ key, count, percent }) => {
      const button = el('button', { type: 'button', class: `review-segment review-level-${key}`,
        text: `${percent}%`, 'aria-label': `${levelLabel(key)} ${percent}%`, 'aria-pressed': String(key === levelKey),
        onclick: () => selectLevel(levelKey === key ? null : key) });
      button.style.flexGrow = String(count);
      levelButtons.set(key, button);
      return button;
    }));
    band.style.minWidth = `${present.length * 56}px`;
    chartArea.replaceChildren(el('div', { class: 'review-band-scroll' }, band),
      el('ul', { class: 'review-legend', 'aria-label': '理解度の色' }, shares.map(({ key }) =>
        el('li', { class: `review-level-${key}` },
          el('span', { class: 'review-legend-color', 'aria-hidden': 'true' }), el('span', { text: levelLabel(key) })))));
  }

  function selectLevel(value) {
    if (!alive || loading || !ready) return;
    levelKey = value;
    renderRows();
    syncControls();
  }

  function renderFilterStatus() {
    filterStatus.replaceChildren();
    if (levelKey === null) return;
    filterStatus.append(el('span', {
      text: `『${levelLabel(levelKey)}』の ${rows.filter((row) => countedIds.has(row.studentId)).length} 人を出しています。`,
    }), showAll);
  }

  function clearCopy() {
    copyId += 1;
    copying = false;
    copyArea.replaceChildren();
  }

  function showInkThumb(area, studentId) {
    const thumbs = inkThumbs.get(field)?.thumbs;
    const thumb = thumbs?.[studentId];
    const fallback = () => area.replaceChildren(el('span', { class: 'small', text: '（手書きがあります。開くと見られます）' }));
    if (typeof thumb !== 'string' || !thumb.startsWith('data:image/')) { fallback(); return; }
    const image = el('img', { class: 'review-ink-thumb', src: thumb, alt: '手書き' });
    const current = loadId;
    const currentField = field;
    image.addEventListener('error', () => {
      if (!alive || current !== loadId || currentField !== field || inkViews.get(studentId) !== area) return;
      delete thumbs[studentId];
      fallback();
    }, { once: true });
    area.replaceChildren(image);
  }

  function loadInkThumbs(name) {
    if (inkThumbs.has(name)) return inkThumbs.get(name).promise;
    const current = loadId;
    const currentClass = classId;
    const currentLesson = lessonId;
    const entry = { thumbs: {}, promise: null };
    inkThumbs.set(name, entry);
    entry.promise = (async () => {
      try { entry.thumbs = { ...await ctx.repo.listInkThumbs(currentClass, currentLesson, name) }; }
      catch { /* 一覧は使えるままにして、手書きを開く案内を出す。 */ }
      if (!alive || current !== loadId || name !== field || !ready) return;
      for (const [studentId, area] of inkViews) showInkThumb(area, studentId);
    })();
    return entry.promise;
  }

  function renderRows() {
    clearCopy();
    inkViews.clear();
    const all = reviewRows(people, { field, sort });
    let sorted = filterRows(all, levelKey);
    if (levelKey !== null && sorted.length === 0) {
      levelKey = null;
      sorted = all;
    }
    // 名簿にいない人は、どちらの並び順でも最後に残す。
    rows = [...sorted.filter((row) => row.inRoster), ...sorted.filter((row) => !row.inRoster)];
    renderFilterStatus();
    if (rows.length === 0) {
      listArea.replaceChildren(el('p', { text: 'このクラスには、まだ生徒がいません。' }));
      return;
    }
    listArea.replaceChildren(el('ul', { class: 'review-rows' }, rows.map((row) => {
      const label = !row.inRoster ? '名簿にいない' : row.number === null ? '出席番号なし' : `${row.number} 番`;
      const name = !row.inRoster || row.number === null ? `${label} ${row.studentId}` : label;
      const kind = row.level === null ? 'info' : row.level >= 3 ? 'ok' : 'warn';
      const reply = replies[row.studentId];
      const replyLabel = reply?.text ? replyMarkLabel(reply) : '';
      const ink = row.hasInk ? el('span', { class: 'review-ink' }) : null;
      if (ink) {
        inkViews.set(row.studentId, ink);
        showInkThumb(ink, row.studentId);
      }
      return el('li', {}, el('button', { type: 'button', class: `review-row review-level-${row.level ?? 'none'}`,
        'aria-label': `${name}の記録を開く`,
        onclick: () => ctx.navigate('t-record', { classId, lessonId, studentId: row.studentId }) },
      el('span', { class: 'review-row-heading' },
        el('span', { class: 'review-person', text: label }), statusChip(kind, levelLabel(row.level)),
        replyLabel ? el('span', { class: 'reply-mark', text: replyLabel }) : null,
        reply?.seen ? el('span', { class: 'reply-mark reply-stamp-mark' },
          el('img', { src: `assets/stamps/seen-${stampKind({ studentId: row.studentId, lessonId, updatedAt: reply.updatedAt })}.svg`,
            width: 24, height: 24, alt: '' }), el('span', { text: 'スタンプ' })) : null,
        attachmentCounts.get(row.studentId) > 0 ? el('span', { class: 'small', text: `添付 ${attachmentCounts.get(row.studentId)}` }) : null,
        !row.inRoster || row.number === null ? el('span', { class: 'small', text: row.studentId }) : null),
      row.text.trim() || !row.hasInk ? el('span', { class: 'review-text', text: row.text.trim() ? row.text : '（まだ書いていません）' }) : null,
      ink));
    })));
  }

  async function stampAllReplies() {
    if (!alive || loading || !ready || !repliesReady || stamping) return;
    const targets = stampTargets({ students: people, records, replies });
    if (targets.length === 0) return;
    stampStatus.textContent = '';
    stampStatus.setAttribute('role', 'status');
    if (targets.length > 60) {
      stampStatus.textContent = '一度に押せるのは 60 人までです。';
      stampStatus.setAttribute('role', 'alert');
      return;
    }
    const current = loadId;
    stamping = true;
    syncControls();
    try {
      const ok = await confirmDialog({ title: 'スタンプを押しますか？',
        body: `振り返りを書いた ${targets.length} 人に、スタンプを押します。`, okLabel: '押す', signal: dialogs.signal });
      if (!ok || !alive || current !== loadId) return;
      stampStatus.textContent = 'スタンプを押しています…';
      const now = ctx.now();
      await ctx.repo.stampReplies(classId, lessonId, targets, now);
      if (!alive || current !== loadId) return;
      for (const id of targets) replies[id] = { ...replies[id], seen: true, updatedAt: now };
      renderRows();
      stampStatus.textContent = `${targets.length} 人にスタンプを押しました。`;
    } catch {
      if (!alive || current !== loadId) return;
      stampStatus.textContent = 'スタンプを押せませんでした。もう一度押してください。';
      stampStatus.setAttribute('role', 'alert');
    } finally {
      if (alive && current === loadId) { stamping = false; syncControls(); }
    }
  }

  async function copyAll() {
    if (!alive || loading || !ready || copying) return;
    const result = copyText(rows.filter((row) => countedIds.has(row.studentId)));
    if (result.count === 0) {
      toast(result.inkCount > 0 ? `コピーできる文章がありません（手書き ${result.inkCount} 件）。` : 'コピーする文章がありません。');
      return;
    }
    const current = ++copyId;
    copying = true;
    copyArea.replaceChildren();
    syncControls();
    try {
      if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('コピーを使えません');
      await navigator.clipboard.writeText(result.text);
      if (alive && current === copyId) toast(`${result.count} 人分をコピーしました。`
        + (result.inkCount > 0 ? `手書き ${result.inkCount} 件は含まれていません。` : ''));
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
    if (!alive || stamping) return;
    const current = ++loadId;
    const stale = () => !alive || current !== loadId;
    loading = true;
    ready = false;
    repliesReady = false;
    stampStatus.textContent = '';
    inkThumbs.clear();
    inkViews.clear();
    content.hidden = true;
    summary?.destroy();
    summary = null;
    aiSummary?.destroy();
    aiSummary = null;
    summaryArea.replaceChildren();
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
        await changeReview({ classId, lessonId });
        return;
      }
      navigatePending = false;
      void loadInkThumbs(field);
      const [lessonResult, membersResult, recordsResult, repliesResult] = await Promise.allSettled([
        ctx.repo.getLesson(classId, lessonId), ctx.repo.getMembers(classId), ctx.repo.listRecords(classId, lessonId),
        Promise.resolve().then(() => ctx.repo.listReplies(classId, lessonId)),
      ]);
      if (stale()) return;
      if (lessonResult.status === 'fulfilled' && !lessonResult.value) {
        pageMessage.textContent = 'この授業は見つかりません。';
        return;
      }
      if ([lessonResult, membersResult, recordsResult].some((result) => result.status === 'rejected')) throw new Error('読みこめませんでした');
      people = reviewPeople(membersResult.value, recordsResult.value);
      records = recordsResult.value;
      // 返事だけの生徒は表示するが、人数とコピーの対象は名簿と記録のままにする。
      countedIds = new Set(people.map((person) => person.studentId));
      summary = summaryBox({ students: people, records: recordsResult.value,
        terms: lessonTerms(lessonResult.value).map((term) => term.text) });
      replies = repliesResult.status === 'fulfilled' ? repliesResult.value : {};
      repliesReady = repliesResult.status === 'fulfilled';
      const outside = people.filter((person) => !person.inRoster);
      for (const studentId of Object.keys(replies)) {
        if (isStudentId(studentId) && !countedIds.has(studentId)) {
          outside.push({ studentId, number: null, inRoster: false, record: null });
        }
      }
      outside.sort((a, b) => a.studentId < b.studentId ? -1 : a.studentId > b.studentId ? 1 : 0);
      people = [...people.filter((person) => person.inRoster), ...outside];
      aiSummary = aiSummaryBox({ session: aiSession, classId, lessonId, lesson: lessonResult.value,
        students: people, records, navigate: ctx.navigate });
      summaryArea.replaceChildren(summary.node, aiSummary.node);
      replyMessage.hidden = repliesResult.status === 'fulfilled';
      replyMessage.textContent = repliesResult.status === 'rejected' ? '返事の印を読みこめませんでした。' : '';
      attachmentCounts = new Map(people.map((person) => {
        const attachments = recordsResult.value?.[person.studentId]?.attachments;
        return [person.studentId, Array.isArray(attachments) ? attachments.length : 0];
      }));
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
  return () => {
    alive = false; loadId += 1; copyId += 1; dialogs.abort(); summary?.destroy(); aiSummary?.destroy();
    if (!transferringAi) aiSession.destroy();
  };
}
