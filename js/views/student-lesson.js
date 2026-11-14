// 生徒の授業ページ。資料の読みこみや保存の状態が変わっても、入力欄は作り直さない。
import { el, confirmDialog, toast, statusChip } from '../ui.js';
import { CONFIG } from '../config.js';
import { createRecordSaver } from '../record-saver.js';
import { pickInitial, normalizeRecord, sameRecord, LEVELS } from '../record-logic.js';
import { dateLabel } from '../lesson-logic.js';
import { materialPane } from './parts/material-pane.js';
import { attachmentPane } from './parts/attachment-pane.js';

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
  let attachments = null;
  const dialogs = new AbortController();
  const fields = {};
  const counts = {};
  const levelButtons = new Map();
  const saveStatus = el('div', { class: 'student-lesson-status', role: 'status', 'aria-live': 'polite' });
  const connectionStatus = el('div', { class: 'student-lesson-status', role: 'status', 'aria-live': 'polite' });
  const draftWarning = el('p', { class: 'notice', role: 'alert', hidden: true });
  const pageMessage = el('div', { class: 'page-message', role: 'status', 'aria-live': 'polite' });
  const heading = el('h1', { text: '授業' });
  const date = el('p', { class: 'student-lesson-date' });
  const materialsArea = el('div');
  const attachmentsArea = el('div');
  const reflectionStatus = el('span', { class: 'reflection-status', role: 'status' });

  function sectionHeading(id, number, title, description, status = null) {
    return el('header', { class: 'lesson-section-band' },
      el('span', { class: 'lesson-section-number', 'aria-hidden': 'true', text: number }),
      el('h2', { id, text: title }), status,
      el('p', { class: 'lesson-section-description', text: description }));
  }

  function textField(key, label, rows) {
    const id = `student-record-${key}`;
    fields[key] = el('textarea', { id, rows, maxlength: CONFIG.recordTextMax,
      'aria-describedby': `${id}-count`, oninput: editRecord });
    counts[key] = el('p', { id: `${id}-count`, class: 'small student-record-count' });
    return el('div', { class: 'field' }, el('label', { class: 'label', for: id, text: label }), fields[key], counts[key]);
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
      sectionHeading('student-teacher-heading', 1, '先生の資料', '資料をめくったり、拡大したりできます。'),
      el('div', { class: 'lesson-section-body' }, materialsArea)),
    el('section', { class: 'student-lesson-mine', 'aria-labelledby': 'student-mine-heading' },
      sectionHeading('student-mine-heading', 2, '自分の記録', '授業中に気づいたことを書きます。'),
      el('div', { class: 'lesson-section-body' }, memo,
        el('h3', { text: '自分の写真・PDF' }), attachmentsArea)),
    el('section', { class: 'student-lesson-reflection', 'aria-labelledby': 'student-reflection-heading' },
      sectionHeading('student-reflection-heading', 3, '振り返り', '授業の終わりに書きます。', reflectionStatus),
      el('div', { class: 'lesson-section-body' }, levels,
        el('div', { class: 'student-reflection-fields' },
          textField('learned', '分かったこと・学んだこと', 4),
          textField('question', '疑問・まだ分からないこと', 4)))));
  const goHome = () => ctx.navigate('home', { classId });
  root.replaceChildren(el('div', { class: 'student-page' }, el('main', { class: 'student-lesson-page' },
    el('header', { class: 'student-lesson-header' },
      el('button', { type: 'button', class: 'btn', text: '‹ 一覧へ', onclick: goHome }),
      el('div', { class: 'student-lesson-title' }, date, heading),
      el('div', { class: 'student-lesson-states' }, saveStatus, connectionStatus)),
    draftWarning, pageMessage, content)));

  function showSaveState(state) {
    if (!alive) return;
    const labels = {
      dirty: ['info', '保存中…'], saving: ['info', '保存中…'], saved: ['ok', '保存しました'],
      retrying: ['warn', '保存できませんでした。もう一度ためしています…'], failed: ['danger', '保存できませんでした'],
    };
    const label = labels[state];
    saveStatus.replaceChildren(...(label ? [statusChip(...label)] : []));
    if (state === 'failed') saveStatus.append(el('button', {
      type: 'button', class: 'btn', text: 'もう一度', onclick: () => saver.retry(),
    }));
  }

  function showConnection() {
    connectionStatus.replaceChildren(...(online ? [] : [statusChip('warn', '接続が切れています')]));
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
    loading = true;
    pageMessage.textContent = '読みこんでいます…';
    try {
      const [lessonResult, recordResult] = await Promise.allSettled([
        ctx.repo.getLesson(classId, lessonId),
        ctx.recordQueue.run(key, async () => {
          const server = await ctx.repo.getRecord(classId, lessonId, studentId);
          const draft = ctx.drafts.get(studentId, classId, lessonId);
          return { server, draft };
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
      const { server, draft } = recordResult.value;
      const initial = pickInitial(server, draft, { max: CONFIG.recordTextMax });
      record = initial.record;
      updatedAt = initial.updatedAt;
      if (draft && !initial.fromDraft) ctx.drafts.remove(studentId, classId, lessonId);
      saver = createRecordSaver({
        save: (value, editedAt) => ctx.recordQueue.run(key, async () => {
          await ctx.repo.saveRecord(classId, lessonId, studentId, value, editedAt);
          if (alive) updatedAt = Math.max(updatedAt, editedAt);
        }),
        saveDraft, removeDraft: () => ctx.drafts.remove(studentId, classId, lessonId),
        now: ctx.now, ...ctx.timers, delayMs: CONFIG.save.delayMs, retryMs: CONFIG.save.retryMs, onState: showSaveState,
      });
      date.textContent = dateLabel(lesson.date);
      heading.textContent = lesson.title;
      syncRecord();
      ready = true;
      content.hidden = false;
      pageMessage.replaceChildren();
      if (initial.fromDraft) {
        saver.edit(record, { editedAt: draft.editedAt });
        toast('前に保存できなかった内容を、もう一度送ります。');
      }
      materials = materialPane({ ctx, classId, lessonId, lesson });
      materialsArea.replaceChildren(materials.node);
      attachments = attachmentPane({ ctx, classId, lessonId, studentId,
        attachments: Array.isArray(server?.attachments) ? server.attachments : [], readOnly: false });
      attachmentsArea.replaceChildren(attachments.node);
    } catch {
      if (alive) pageMessage.replaceChildren(
        el('p', { class: 'error', text: 'つながりません。電波を確かめて、もう一度ためしてください。' }),
        el('button', { type: 'button', class: 'btn', text: 'もう一度ためす', onclick: load }));
    } finally { loading = false; }
  }

  async function refreshRecord() {
    if (!alive || !ready || document.visibilityState !== 'visible' || saver.dirty) return;
    const current = ++refreshId;
    const startedRevision = revision;
    try {
      const server = await ctx.repo.getRecord(classId, lessonId, studentId);
      // 読みこみの途中で書いた場合も、その入力を守る。
      if (!alive || current !== refreshId || saver.dirty || startedRevision !== revision) return;
      if (typeof server?.updatedAt !== 'number' || !Number.isFinite(server.updatedAt) || server.updatedAt <= updatedAt) return;
      record = normalizeRecord(server, { max: CONFIG.recordTextMax });
      updatedAt = server.updatedAt;
      syncRecord();
    } catch { /* 戻ったときの読み直しに失敗しても、今の記録を残す */ }
  }

  async function okToLeave() {
    if (saver?.dirty) {
      showSaveState('saving');
      const saved = await saver.flush();
      if (!alive) return false;
      if (!saved && !await confirmDialog({ title: 'まだ保存できていません',
        body: 'この iPad の中に残して、一覧へもどりますか？　次に一覧を開いたときに、もう一度送ります。',
        okLabel: '一覧へもどる', cancelLabel: 'ここに残る', signal: dialogs.signal })) return false;
    }
    if (!alive) return false;
    if (attachments?.busy) return confirmDialog({ title: 'まだ送れていない写真・PDF があります',
      body: 'まだ送れていない写真・PDF があります。離れると、送れていない分は消えます。',
      okLabel: '一覧へもどる', cancelLabel: 'ここに残る', signal: dialogs.signal });
    return true;
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
    if (saver && (saver.state === 'failed' || saver.state === 'retrying')) void saver.retry();
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
    dialogs.abort();
    ctx.setLeaveGuard(null);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('beforeunload', onBeforeUnload);
    document.removeEventListener('visibilitychange', refreshRecord);
    materials?.destroy();
    attachments?.destroy();
  };
}
