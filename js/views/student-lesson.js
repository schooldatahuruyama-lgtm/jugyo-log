// 生徒の授業ページ。資料の読みこみや保存の状態が変わっても、入力欄は作り直さない。
import { el, confirmDialog, toast } from '../ui.js';
import { CONFIG } from '../config.js';
import { createRecordSaver } from '../record-saver.js';
import { pickInitial, normalizeRecord, sameRecord, LEVELS } from '../record-logic.js';
import { dateLabel } from '../lesson-logic.js';
import { materialPane } from './parts/material-pane.js';
import { linkPane } from './parts/link-pane.js';
import { attachmentPane } from './parts/attachment-pane.js';
import { headingIcon } from './parts/heading-icon.js';
import { termRow } from './parts/term-row.js';
import { inkField } from './parts/ink-field.js';
import { replyBox } from './parts/reply-box.js';
import { stampKind } from '../reply-logic.js';

export function mount(root, ctx) {
  const { classId, lessonId } = ctx.params;
  const studentId = ctx.session.studentId;
  const key = `${classId}/${lessonId}`;
  let alive = true;
  let loading = false;
  let ready = false;
  let saver = null;
  let record = normalizeRecord(null, { max: CONFIG.recordTextMax });
  let updatedAt = 0;
  let revision = 0;
  let refreshId = 0;
  let online = navigator.onLine !== false;
  let draftWarned = false;
  let materials = null;
  let links = null;
  let attachments = null;
  let terms = null;
  let reply = null;
  let stampTime = null;
  let stampShown = false;
  const stamp = el('span', { class: 'student-seen-stamp', hidden: true });
  const dialogs = new AbortController();
  const fields = {};
  const counts = {};
  const inkFields = {};
  const writingFields = {};
  const saveStates = { text: 'idle' };
  function savedState(field, state) {
    saveStates[field] = state;
    showSaveState();
    if (!alive || state !== 'saved') return;
    ctx.offline?.touch?.(classId, lessonId, studentId);
  }
  const levelButtons = new Map();
  const saveStatus = el('div', { class: 'student-lesson-status', role: 'status', 'aria-live': 'polite' });
  const connectionStatus = el('div', { class: 'student-lesson-status', role: 'status', 'aria-live': 'polite' });
  const draftWarning = el('p', { class: 'notice', role: 'alert', hidden: true });
  const pageMessage = el('div', { class: 'page-message', role: 'status', 'aria-live': 'polite' });
  const heading = el('h1', { text: '授業' });
  const date = el('p', { class: 'student-lesson-date' });
  const materialsArea = el('div');
  const linksArea = el('div', { hidden: true });
  const attachmentsArea = el('div');
  const termsArea = el('div');
  const reflectionStatus = el('span', { class: 'reflection-status', role: 'status' });

  function sectionHeading(id, kind, title, description, status = null) {
    return el('header', { class: 'lesson-section-band' },
      el('h2', { id }, headingIcon(kind), el('span', { text: title })), status,
      el('p', { class: 'lesson-section-description', text: description }));
  }

  function textField(key, label, rows) {
    const id = `student-record-${key}`;
    fields[key] = el('textarea', { id, rows, maxlength: CONFIG.recordTextMax,
      'aria-describedby': `${id}-count`, oninput: editRecord });
    counts[key] = el('p', { id: `${id}-count`, class: 'small student-record-count' });
    const textArea = el('div', {}, fields[key], counts[key]);
    const inkArea = el('div', { hidden: true });
    const textButton = el('button', { type: 'button', text: '文字', 'aria-pressed': 'true',
      onclick: () => setWritingMode(key, 'text') });
    const inkButton = el('button', { type: 'button', text: '手書き', 'aria-pressed': 'false',
      onclick: () => setWritingMode(key, 'ink') });
    writingFields[key] = { label, mode: 'text', textArea, inkArea, textButton, inkButton };
    return el('div', { class: 'field' }, el('div', { class: 'student-writing-heading' },
      el('label', { class: 'label', for: id, text: label }),
      el('div', { class: 'student-writing-switch', role: 'group', 'aria-label': `${label}の書き方` }, textButton, inkButton)),
    textArea, inkArea);
  }

  function syncWritingMode(key) {
    const entry = writingFields[key];
    const isInk = entry.mode === 'ink';
    entry.textArea.hidden = isInk;
    entry.inkArea.hidden = !isInk;
    for (const [button, name, selected, filled] of [
      [entry.textButton, '文字', !isInk, record[key].length > 0],
      [entry.inkButton, '手書き', isInk, inkFields[key]?.hasInk()],
    ]) {
      button.setAttribute('aria-pressed', String(selected));
      button.textContent = `${name}${!selected && filled ? ' ●' : ''}`;
      button.setAttribute('aria-label', `${name}${!selected && filled ? '（書いてあります）' : ''}`);
    }
  }

  function setWritingMode(key, mode) {
    if (!alive || !ready) return;
    writingFields[key].mode = mode;
    syncWritingMode(key);
    if (mode === 'ink') void inkFields[key].show();
  }

  const memo = textField('memo', 'メモ', 7);
  const levels = el('fieldset', { class: 'student-record-levels' },
    el('legend', { class: 'label', text: '今日の理解度' }),
    el('div', { class: 'student-record-level-buttons' }, LEVELS.map((level) => {
      const button = el('button', { type: 'button', class: 'btn', text: level.label, 'aria-pressed': 'false',
        onclick: () => editRecord(level.value) });
      levelButtons.set(level.value, button);
      return button;
    })));
  const content = el('div', { class: 'student-lesson-columns', hidden: true },
    el('section', { class: 'student-lesson-teacher', 'aria-labelledby': 'student-teacher-heading' },
      sectionHeading('student-teacher-heading', 'teacher', '先生の資料', '資料をめくったり、拡大したりできます。'),
      el('div', { class: 'lesson-section-body' }, materialsArea, linksArea)),
    el('section', { class: 'student-lesson-mine', 'aria-labelledby': 'student-mine-heading' },
      sectionHeading('student-mine-heading', 'mine', '自分の記録', '授業中に気づいたことを書きます。'),
      el('div', { class: 'lesson-section-body' },
        el('div', { class: 'term-heading' }, el('h3', { text: '重要用語' }),
          el('span', { class: 'small', text: '自分で足した用語は、押すと外せます。' })), termsArea, memo,
        el('h3', { text: '自分の写真・PDF' }), attachmentsArea)),
    el('section', { class: 'student-lesson-reflection', 'aria-labelledby': 'student-reflection-heading' },
      sectionHeading('student-reflection-heading', 'reflect', '振り返り', '授業の終わりに書きます。', reflectionStatus),
      el('div', { class: 'lesson-section-body' }, levels,
        el('div', { class: 'student-reflection-fields' },
          textField('learned', '分かったこと・学んだこと', 4),
          textField('question', '疑問・まだ分からないこと', 4)))));
  const reflectionBand = content.querySelectorAll('.student-lesson-reflection')[0].querySelectorAll('.lesson-section-band')[0];
  reflectionBand.append(stamp);

  function showStamp(value) {
    if (!alive) return;
    const seen = value?.seen === true;
    stamp.hidden = !seen;
    reflectionBand.classList.toggle('has-seen-stamp', seen);
    if (!seen) { stampTime = null; stamp.replaceChildren(); return; }
    if (stampTime === value.updatedAt) return;
    stampTime = value.updatedAt;
    const image = el('img', { class: stampShown ? '' : 'stamp-enter', width: 64, height: 64,
      src: `assets/stamps/seen-${stampKind({ studentId, lessonId, updatedAt: value.updatedAt })}.svg`, alt: '先生が見ました' });
    image.addEventListener('error', () => {
      if (!alive || !stamp.contains(image)) return;
      stamp.replaceChildren(el('span', { class: 'student-stamp-fallback', text: '✓ 先生が見ました' }));
    }, { once: true });
    stampShown = true;
    stamp.replaceChildren(image);
  }
  const goHome = () => ctx.navigate('home', { classId });
  root.replaceChildren(el('div', { class: 'student-page' }, el('main', { class: 'student-lesson-page' },
    el('header', { class: 'student-lesson-header' },
      el('button', { type: 'button', class: 'btn', text: '‹ 一覧へ', onclick: goHome }),
      el('div', { class: 'student-lesson-title' }, date, heading),
      el('div', { class: 'student-lesson-states' }, saveStatus, connectionStatus)),
    draftWarning, pageMessage, content)));

  function statusText(kind, label) {
    const icons = { ok: '✓', warn: '！', danger: '■' };
    return el('span', { class: `student-status-text student-status-${kind}` },
      icons[kind] ? el('span', { 'aria-hidden': 'true', text: `${icons[kind]} ` }) : null,
      el('span', { text: label }));
  }

  function retrySaves() {
    for (const item of [saver, materials, attachments, ...Object.values(inkFields)]) {
      if (item && (item.state === 'failed' || item.state === 'retrying')) void item.retry();
    }
  }

  function showSaveState() {
    if (!alive) return;
    const priority = { idle: 0, saved: 1, dirty: 2, saving: 2, retrying: 3, failed: 4 };
    const state = Object.values(saveStates).reduce((worst, value) => priority[value] > priority[worst] ? value : worst, 'idle');
    const labels = {
      dirty: ['info', '保存中…'], saving: ['info', '保存中…'], saved: ['ok', '保存しました'],
      retrying: ['warn', '保存できませんでした。もう一度ためしています…'], failed: ['danger', '保存できませんでした'],
    };
    const label = labels[state];
    saveStatus.replaceChildren(...(label ? [statusText(...label)] : []));
    if (state === 'failed') saveStatus.append(el('button', {
      type: 'button', class: 'btn', text: 'もう一度', onclick: retrySaves,
    }));
  }

  function showConnection() {
    connectionStatus.replaceChildren(...(online ? [] : [statusText('warn', '接続が切れています')]));
  }

  function syncRecord() {
    const filled = LEVELS.some((level) => level.value === record.level);
    reflectionStatus.classList.toggle('is-complete', filled);
    const statusText = filled ? '✓ 記入済み' : '！ 未記入';
    if (reflectionStatus.textContent !== statusText) reflectionStatus.textContent = statusText;
    for (const key of Object.keys(fields)) {
      // 同じ文字を入れ直さず、変換中のカーソルやフォーカスを保つ。
      if (fields[key].value !== record[key]) fields[key].value = record[key];
      const remaining = CONFIG.recordTextMax - record[key].length;
      counts[key].textContent = record[key].length < CONFIG.recordCountFrom ? ''
        : remaining === 0 ? 'これ以上は書けません' : `あと ${remaining} 文字`;
      syncWritingMode(key);
    }
    for (const level of LEVELS) {
      const selected = record.level === level.value;
      const button = levelButtons.get(level.value);
      button.setAttribute('aria-pressed', String(selected));
      button.textContent = `${selected ? '✓ ' : ''}${level.label}`;
    }
  }

  function editRecord(level) {
    if (!alive || !ready) return;
    const next = normalizeRecord({ memo: fields.memo.value, learned: fields.learned.value,
      question: fields.question.value, level: typeof level === 'number' ? level : record.level }, { max: CONFIG.recordTextMax });
    const changed = !sameRecord(record, next);
    record = next;
    syncRecord();
    if (!changed) return;
    revision += 1;
    saver.edit(record);
  }

  function saveDraft(value, time) {
    let saved = false;
    try { saved = ctx.drafts.put(studentId, classId, lessonId, value, time); } catch { /* 保存できなくても通信は続ける */ }
    if (saved === false && !draftWarned && alive) {
      draftWarned = true;
      draftWarning.textContent = 'この iPad に下書きを残せません。保存しましたと出るまで、このページを閉じないでください。';
      draftWarning.hidden = false;
    }
    return saved;
  }

  function notFound() {
    pageMessage.replaceChildren(el('p', { text: 'この授業は見つかりません。' }),
      el('button', { type: 'button', class: 'btn', text: '一覧へ', onclick: goHome }));
  }

  async function load() {
    if (!alive || loading || ready) return;
    links?.destroy();
    loading = true;
    pageMessage.textContent = '読みこんでいます…';
    try {
      const [lessonResult, recordResult] = await Promise.allSettled([
        ctx.repo.getLesson(classId, lessonId),
        ctx.recordQueue.run(key, async () => {
          const server = await ctx.repo.getRecord(classId, lessonId, studentId);
          const fromCache = Boolean(ctx.offline?.down);
          const draft = ctx.drafts.get(studentId, classId, lessonId);
          return { server, draft, fromCache };
        }),
      ]);
      if (!alive) return;
      if ((lessonResult.status === 'fulfilled' && !lessonResult.value)
        || [lessonResult, recordResult].some((result) => result.status === 'rejected' && result.reason?.code === 'denied')) {
        notFound();
        return;
      }
      if (lessonResult.status === 'rejected' || recordResult.status === 'rejected') throw new Error('読みこめませんでした');
      const lesson = lessonResult.value;
      const { server, draft, fromCache } = recordResult.value;
      let needsServerCheck = fromCache;
      const initial = pickInitial(server, draft, { max: CONFIG.recordTextMax });
      record = initial.record;
      updatedAt = initial.updatedAt;
      if (draft && !initial.fromDraft) ctx.drafts.remove(studentId, classId, lessonId);
      saver = createRecordSaver({
        save: (value, editedAt) => {
          const startedRevision = revision;
          return ctx.recordQueue.run(key, async () => {
            if (needsServerCheck) {
              const latest = await ctx.liveRepo.getRecord(classId, lessonId, studentId);
              if (Number.isFinite(latest?.updatedAt) && latest.updatedAt > editedAt) {
                needsServerCheck = startedRevision !== revision;
                ctx.offline?.touch?.(classId, lessonId, studentId);
                if (alive && startedRevision === revision) {
                  record = normalizeRecord(latest, { max: CONFIG.recordTextMax });
                  updatedAt = latest.updatedAt;
                  syncRecord();
                  toast('ほかの端末で書いた新しい記録があったので、そちらを出しています。');
                }
                return { superseded: true };
              }
            }
            await ctx.repo.saveRecord(classId, lessonId, studentId, value, editedAt);
            needsServerCheck = false;
            if (alive) updatedAt = Math.max(updatedAt, editedAt);
          });
        },
        saveDraft, removeDraft: () => ctx.drafts.remove(studentId, classId, lessonId),
        now: ctx.now, ...ctx.timers, delayMs: CONFIG.save.delayMs, retryMs: CONFIG.save.retryMs,
        onState: (state) => savedState('text', state),
      });
      for (const field of CONFIG.inkFields) {
        const entry = writingFields[field];
        inkFields[field] = inkField({ ctx, classId, lessonId, studentId, field, label: entry.label,
          index: server?.ink?.[field] ?? null, cleared: server?.inkCleared?.[field],
          onState: (state) => savedState(field, state),
          onChange: () => syncWritingMode(field) });
        entry.inkArea.replaceChildren(inkFields[field].node);
        entry.mode = inkFields[field].hasInk() && record[field].length === 0 ? 'ink' : 'text';
      }
      date.textContent = dateLabel(lesson.date);
      heading.textContent = lesson.title;
      syncRecord();
      ready = true;
      content.hidden = false;
      pageMessage.replaceChildren();
      for (const field of CONFIG.inkFields) {
        if (writingFields[field].mode === 'ink') void inkFields[field].show();
      }
      if (initial.fromDraft) {
        saver.edit(record, { editedAt: draft.editedAt });
        toast('前に保存できなかった内容を、もう一度送ります。');
      }
      materials = materialPane({ ctx, classId, lessonId, lesson, studentId, readOnly: false,
        ink: server?.ink, inkCleared: server?.inkCleared,
        onState: (state) => savedState('materials', state) });
      materialsArea.replaceChildren(materials.node);
      links = linkPane({ lesson });
      linksArea.replaceChildren(links.node);
      linksArea.hidden = links.node.hidden;
      attachments = attachmentPane({ ctx, classId, lessonId, studentId,
        attachments: Array.isArray(server?.attachments) ? server.attachments : [], readOnly: false,
        ink: server?.ink, inkCleared: server?.inkCleared,
        onState: (state) => savedState('attachments', state) });
      attachmentsArea.replaceChildren(attachments.node);
      terms = termRow({ ctx, classId, lessonId, studentId, lesson, readOnly: false });
      termsArea.replaceChildren(terms.node);
      reply = replyBox({ ctx, classId, lessonId, studentId, readOnly: true, onReply: showStamp });
      content.append(reply.node);
    } catch {
      if (alive) pageMessage.replaceChildren(
        el('p', { class: 'error', text: ctx.offline?.down || navigator.onLine === false
          ? 'この授業は、まだこの iPad に入っていません。電波のある所で一度開くと、電波がなくても開けるようになります。'
          : 'つながりません。電波を確かめて、もう一度ためしてください。' }),
        el('button', { type: 'button', class: 'btn', text: 'もう一度ためす', onclick: load }));
    } finally { loading = false; }
  }

  async function refreshRecord() {
    if (!alive || !ready || document.visibilityState !== 'visible') return;
    void reply?.reload();
    const current = ++refreshId;
    const startedRevision = revision;
    try {
      const server = await ctx.repo.getRecord(classId, lessonId, studentId);
      if (!alive || current !== refreshId) return;
      for (const field of CONFIG.inkFields) inkFields[field].refresh(server?.ink?.[field] ?? null, server?.inkCleared?.[field]);
      materials?.refreshInk(server?.ink, server?.inkCleared);
      attachments?.refreshInk(server?.ink, server?.inkCleared);
      // 読みこみの途中で書いた場合も、その入力を守る。
      if (saver.dirty || startedRevision !== revision) return;
      if (typeof server?.updatedAt !== 'number' || !Number.isFinite(server.updatedAt) || server.updatedAt <= updatedAt) return;
      record = normalizeRecord(server, { max: CONFIG.recordTextMax });
      updatedAt = server.updatedAt;
      syncRecord();
    } catch { /* 戻ったときの読み直しに失敗しても、今の記録を残す */ }
  }

  async function okToLeave() {
    terms?.setLocked(true);
    for (const item of Object.values(inkFields)) item.setLocked(true);
    materials?.setLocked(true);
    attachments?.setLocked(true);
    let leaving = false;
    try {
      if (terms && !await terms.settle()) return false;
      const savers = [saver, materials, attachments, ...Object.values(inkFields)].filter(Boolean);
      if (savers.some((item) => item.dirty)) {
        const results = await Promise.all(savers.map((item) => item.flush()));
        const saved = results.every(Boolean);
        if (!alive) return false;
        if (!saved && !await confirmDialog({ title: 'まだ保存できていません',
          body: 'この iPad の中に残して、一覧へもどりますか？　次に一覧を開いたときに、もう一度送ります。',
          okLabel: '一覧へもどる', cancelLabel: 'ここに残る', signal: dialogs.signal })) return false;
      }
      if (!alive) return false;
      if (attachments?.busy && !await confirmDialog({ title: 'まだ送れていない写真・PDF があります',
        body: 'まだ送れていない写真・PDF があります。離れると、送れていない分は消えます。',
        okLabel: '一覧へもどる', cancelLabel: 'ここに残る', signal: dialogs.signal })) return false;
      leaving = alive;
      return leaving;
    } finally {
      if (!leaving) {
        terms?.setLocked(false);
        for (const item of Object.values(inkFields)) item.setLocked(false);
        materials?.setLocked(false);
        attachments?.setLocked(false);
      }
    }
  }

  const onBeforeUnload = (event) => {
    if (!attachments?.busy) return;
    event.preventDefault();
    event.returnValue = '';
  };

  const onOffline = () => { online = false; showConnection(); };
  const onOnline = () => {
    online = true;
    showConnection();
    retrySaves();
  };
  ctx.setLeaveGuard(okToLeave);
  window.addEventListener('offline', onOffline);
  window.addEventListener('online', onOnline);
  window.addEventListener('beforeunload', onBeforeUnload);
  document.addEventListener('visibilitychange', refreshRecord);
  showConnection();
  void load();

  return () => {
    alive = false;
    saver?.dispose();
    for (const item of Object.values(inkFields)) item.destroy();
    dialogs.abort();
    ctx.setLeaveGuard(null);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('beforeunload', onBeforeUnload);
    document.removeEventListener('visibilitychange', refreshRecord);
    materials?.destroy();
    links?.destroy();
    attachments?.destroy();
    terms?.destroy();
    reply?.destroy();
  };
}
