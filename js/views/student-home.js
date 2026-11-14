// 生徒の授業一覧。読めた授業は残し、印や単元の読みこみだけ失敗したときは知らせる。
import { el, confirmDialog, toast } from '../ui.js';
import { CONFIG } from '../config.js';
import { sortUnits } from '../lesson-logic.js';
import { cleanTerm, termKey, matchLessons, frequentTerms } from '../term-logic.js';
import { classLabel, groupByDate, groupByUnit, todoLessons } from '../student-list-logic.js';
import { tileMark } from '../record-logic.js';
import { pendingLessons, resendDrafts } from '../record-flow.js';
import { lessonTile } from './parts/lesson-tile.js';

export function mount(root, ctx) {
  let alive = true;
  let loadId = 0;
  let classes = null;
  let current = null;
  let lessons = [];
  let units = [];
  let marks = null;
  let myTerms = {};
  let termsReady = false;
  let query = '';
  let searchTimer = null;
  let unitsReady = false;
  let ready = false;
  let order = 'date';
  let onlyTodo = false;
  let tiles = [];
  let navigating = false;
  let signingOut = false;
  let leaving = false;
  let resendStarted = false;
  let resending = null;
  const studentId = ctx.session.studentId;
  const setTimer = ctx.timers?.setTimeout || setTimeout;
  const clearTimer = ctx.timers?.clearTimeout || clearTimeout;
  const sub = el('span', { class: 'topbar-sub' });
  const message = el('div', { class: 'page-message', 'aria-live': 'polite' });
  const pendingArea = el('div', { class: 'pending-area', role: 'status' });
  const listArea = el('div', { class: 'student-lessons' });
  const yearSelect = el('select', {
    'aria-label': '年度',
    onchange: async () => {
      const classId = yearSelect.value;
      if (classId !== current?.id) await go('home', { classId });
      if (alive && current) yearSelect.value = current.id;
    },
  });
  const dateButton = el('button', { type: 'button', class: 'btn', text: '日付順', onclick: () => changeOrder('date') });
  const unitButton = el('button', { type: 'button', class: 'btn', text: '単元別', onclick: () => changeOrder('unit') });
  const filters = el('div', { class: 'student-filters', hidden: true },
    el('label', { class: 'field' }, el('span', { class: 'label', text: '年度' }), yearSelect),
    el('div', { class: 'student-order', role: 'group', 'aria-label': '授業の並べ方' }, dateButton, unitButton));
  const searchInput = el('input', { id: 'lesson-term-search', type: 'search', placeholder: '用語でさがす（例: 反射）',
    oninput: () => {
      searchClear.hidden = searchInput.value === '';
      clearTimer(searchTimer);
      searchTimer = setTimer(applySearch, 200);
    } });
  const searchClear = el('button', { type: 'button', class: 'btn', text: '消す', hidden: true,
    onclick: () => chooseSearch('') });
  const searchStatus = el('p', { class: 'term-message', role: 'status', 'aria-live': 'polite' });
  const frequentArea = el('div', { class: 'term-list term-frequent', hidden: true });
  const searchArea = el('section', { class: 'term-search', hidden: true, 'aria-label': '用語でさがす' },
    el('label', { class: 'label', for: 'lesson-term-search', text: '用語でさがす' }),
    el('div', { class: 'term-input-row' }, searchInput, searchClear), searchStatus, frequentArea);
  const todoMessage = el('p');
  const todoButton = el('button', { type: 'button', class: 'btn', 'aria-pressed': 'false',
    text: 'まだの授業だけ見る', onclick: () => {
      if (!ready || navigating || signingOut) return;
      onlyTodo = !onlyTodo;
      renderLessons();
    } });
  const todoArea = el('div', { class: 'notice student-todo', hidden: true }, todoMessage, todoButton);

  async function logout() {
    if (!alive || signingOut || navigating) return;
    signingOut = true;
    syncControls();
    try {
      const count = ctx.drafts.list(studentId).length;
      const ok = await confirmDialog({
        title: 'ログアウトしますか？',
        body: 'もう一度使うときは、ID とパスワードを入れます。'
          + (count > 0 ? `まだ保存できていない記録が ${count} 件あります。ログアウトすると消えます。` : ''),
        okLabel: 'ログアウト', danger: count > 0,
      });
      if (!ok || !alive) return;
      leaving = true;
      clearTiles();
      await ctx.signOutAll();
      if (alive) await ctx.navigate('login', {}, { confirmed: true });
    } catch {
      if (alive) {
        if (ready) renderLessons();
        toast('ログアウトできませんでした。もう一度ためしてください。');
      }
    } finally {
      signingOut = false;
      leaving = false;
      if (alive) syncControls();
    }
  }

  const bar = el('header', { class: 'topbar' },
    el('div', { class: 'topbar-title' },
      el('span', { class: 'topbar-brand', text: '授業ログ' }),
      sub),
    el('nav', { class: 'topbar-menu', 'aria-label': 'メニュー' },
      el('button', { type: 'button', class: 'btn', text: 'パスワードを変える', onclick: () => go('password') }),
      el('button', { type: 'button', class: 'btn', text: 'ログアウト', onclick: logout })));

  root.replaceChildren(el('div', { class: 'student-page' }, el('div', { class: 'student-home-page' },
    bar, el('main', { class: 'page-main' }, filters, searchArea, todoArea, message, pendingArea, listArea))));

  // 再送を待たずに移り、移ったあとの応答では一覧を描き直さない。
  ctx.setLeaveGuard(() => {
    if (signingOut) return false;
    leaving = true;
    return true;
  });

  function syncControls() {
    const busy = navigating || signingOut;
    yearSelect.disabled = busy;
    dateButton.disabled = busy || !ready;
    unitButton.disabled = busy || !ready;
    todoButton.disabled = busy || !ready;
    searchInput.disabled = busy || !ready;
    for (const button of searchArea.querySelectorAll('button')) button.disabled = busy || !ready;
    dateButton.setAttribute('aria-pressed', String(order === 'date'));
    unitButton.setAttribute('aria-pressed', String(order === 'unit'));
    for (const button of bar.querySelectorAll('button')) button.disabled = busy;
  }

  async function go(name, params = {}) {
    if (!alive || navigating || signingOut) return 'stayed';
    navigating = true;
    syncControls();
    try {
      return await ctx.navigate(name, params);
    } finally {
      navigating = false;
      leaving = false;
      if (alive) syncControls();
    }
  }

  function clearTiles() {
    for (const tile of tiles) tile.destroy();
    tiles = [];
  }

  function changeOrder(value) {
    if (!ready || navigating || signingOut || order === value) return;
    order = value;
    syncControls();
    renderLessons();
  }

  function applySearch() {
    searchTimer = null;
    if (!alive || leaving || !ready) return;
    query = cleanTerm(searchInput.value);
    renderLessons();
  }

  function chooseSearch(text) {
    if (!alive || !ready || navigating || signingOut) return;
    clearTimer(searchTimer);
    searchInput.value = text;
    searchClear.hidden = text === '';
    applySearch();
    searchInput.focus();
  }

  function renderFrequent() {
    const texts = frequentTerms(lessons, myTerms, CONFIG.frequentTerms);
    frequentArea.hidden = texts.length === 0;
    frequentArea.replaceChildren(...(texts.length ? [el('span', { class: 'small', text: 'よく使う用語:' }),
      ...texts.map((text) => el('button', { type: 'button', class: 'term-pill', text, onclick: () => chooseSearch(text) })),
    ] : []));
  }

  function renderPending() {
    const count = ctx.drafts.list(studentId).length;
    pendingArea.replaceChildren(...(count > 0 ? [el('p', {
      class: 'notice',
      text: `まだ保存できていない記録が ${count} 件あります。`
        + (resending ? '送り直しています…' : '電波のよい所で、もう一度開いてください。'),
    })] : []));
  }

  function renderPartial() {
    message.replaceChildren();
    if (marks === null || !unitsReady || !termsReady) message.append(
      el('p', { class: 'notice', text: '一部を読みこめませんでした。' }),
      el('button', { type: 'button', class: 'btn', text: 'もう一度', onclick: load }));
  }

  function renderLessons() {
    clearTiles();
    const today = ctx.now();
    const todo = todoLessons(lessons, marks, today);
    if (todo.length === 0) onlyTodo = false;
    todoArea.hidden = todo.length === 0;
    todoMessage.replaceChildren(el('span', { text: '振り返りがまだの授業が ' }),
      el('strong', { text: `${todo.length} つ` }), el('span', { text: 'あります。' }));
    todoButton.textContent = onlyTodo ? '全部の授業を見る' : 'まだの授業だけ見る';
    todoButton.setAttribute('aria-pressed', String(onlyTodo));
    searchArea.hidden = lessons.length === 0;
    searchStatus.textContent = '';
    if (lessons.length === 0) {
      listArea.replaceChildren(el('p', { class: 'home-empty', text: 'まだ授業がありません。' }));
      return;
    }
    const classId = current.id;
    const pending = pendingLessons(ctx.drafts, studentId, classId);
    const visible = matchLessons(onlyTodo ? todo : lessons, myTerms, query);
    if (termKey(query)) searchStatus.textContent = visible.length
      ? `『${query}』の授業が ${visible.length} つ見つかりました。`
      : `『${query}』の授業は見つかりませんでした。`;
    const groups = order === 'date' ? groupByDate(visible, today) : groupByUnit(visible, units);
    listArea.replaceChildren(...groups.map((group) => el('section', { class: 'lesson-group' },
      el('h2', { text: group.label }),
      el('div', { class: 'lesson-grid' }, group.lessons.map((lesson) => {
        const tile = lessonTile({
          lesson,
          myTerms: myTerms[lesson.id], query,
          mark: marks !== null ? tileMark(marks[lesson.id]) : undefined,
          pending: pending.has(lesson.id),
          loadThumbs: () => ctx.thumbs.load(lesson),
          onOpen: () => go('lesson', { classId, lessonId: lesson.id }),
          swipe: CONFIG.swipe,
        });
        tiles.push(tile);
        return tile.node;
      })))));
  }

  function startResend() {
    if (resendStarted || leaving) return;
    resendStarted = true;
    resending = resendDrafts({ repo: ctx.repo, drafts: ctx.drafts, studentId, max: CONFIG.recordTextMax, queue: ctx.recordQueue });
    renderPending();
    resending = resending.then(async ({ sent, kept, dropped }) => {
      if (!alive || leaving) return;
      const id = loadId;
      if (sent > 0) {
        try {
          const latest = await ctx.repo.getMarks(studentId, current.id);
          if (!alive || leaving || id !== loadId) return;
          marks = latest;
        } catch {
          if (!alive || leaving || id !== loadId) return;
          marks = null;
        }
      }
      if (ready && (sent > 0 || kept > 0 || dropped > 0)) {
        renderPartial();
        renderLessons();
      }
    }).catch(() => {
      // 下書きは消さず、下の件数で知らせる。
    }).finally(() => {
      resending = null;
      if (alive && !leaving) renderPending();
    });
  }

  async function load() {
    // 再送後の新しい印を、再送前に読み始めた結果で戻さない。
    if (resending) await resending;
    if (!alive || leaving || signingOut) return;
    const id = ++loadId;
    const stale = () => !alive || leaving || id !== loadId;
    ready = false;
    todoArea.hidden = true;
    searchArea.hidden = true;
    clearTimer(searchTimer);
    searchTimer = null;
    clearTiles();
    message.replaceChildren();
    listArea.replaceChildren(el('p', { class: 'loading', role: 'status', text: '読みこんでいます…' }));
    syncControls();
    try {
      if (classes === null) {
        const loaded = await ctx.repo.myClasses(studentId);
        if (stale()) return;
        classes = loaded;
        current = classes.find((cls) => cls.id === ctx.params.classId) || classes[0];
        yearSelect.replaceChildren(...classes.map((cls) => el('option', { value: cls.id, text: classLabel(cls) })));
      }
      if (!current) {
        sub.textContent = '';
        listArea.replaceChildren(el('p', { class: 'home-empty notice', text: 'まだクラスに入っていません。先生に聞いてください。' }));
        return;
      }
      sub.textContent = current.number === null ? current.name : `${current.name}　出席番号 ${current.number}`;
      yearSelect.value = current.id;
      filters.hidden = false;
      const [lessonResult, markResult, unitResult, termResult] = await Promise.allSettled([
        ctx.repo.listLessons(current.id), ctx.repo.getMarks(studentId, current.id), ctx.repo.listUnits(current.year),
        ctx.repo.getMyTerms(studentId, current.id),
      ]);
      if (stale()) return;
      if (lessonResult.status === 'rejected') throw lessonResult.reason;
      lessons = lessonResult.value;
      marks = markResult.status === 'fulfilled' ? markResult.value : null;
      unitsReady = unitResult.status === 'fulfilled';
      units = unitsReady ? sortUnits(unitResult.value) : [];
      termsReady = termResult.status === 'fulfilled';
      myTerms = termsReady ? termResult.value : {};
      ready = true;
      query = cleanTerm(searchInput.value);
      renderPartial();
      renderFrequent();
      renderLessons();
      renderPending();
      startResend();
    } catch {
      if (stale()) return;
      listArea.replaceChildren(
        el('p', { class: 'error', role: 'alert', text: 'つながりません。電波を確かめて、もう一度ためしてください。' }),
        el('p', {}, el('button', { type: 'button', class: 'btn btn-primary', text: 'もう一度ためす', onclick: load })));
    } finally {
      if (!stale()) syncControls();
    }
  }

  renderPending();
  load();
  return () => {
    alive = false;
    loadId += 1;
    clearTimer(searchTimer);
    clearTiles();
  };
}
