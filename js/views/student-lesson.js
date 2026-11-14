// 生徒の授業ページ。資料の読みこみや保存の状態が変わっても、入力欄は作り直さない。
import { el, confirmDialog, toast, statusChip } from '../ui.js';
import { CONFIG } from '../config.js';
import { createRecordSaver } from '../record-saver.js';
import { pickInitial, normalizeRecord, sameRecord, LEVELS } from '../record-logic.js';
import { materialList, dateLabel } from '../lesson-logic.js';
import { openViewer } from './parts/viewer.js';

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
  let viewer = null;
  const dialogs = new AbortController();
  const materialViews = new Map();
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
      el('h2', { id: 'student-teacher-heading', text: '先生の資料' }), materialsArea),
    el('section', { class: 'student-lesson-mine', 'aria-labelledby': 'student-mine-heading' },
      el('h2', { id: 'student-mine-heading', text: '自分の記録' }), memo,
      el('h3', { text: '振り返り' }), levels,
      textField('learned', '分かったこと・学んだこと', 4),
      textField('question', '疑問・まだ分からないこと', 4)));
  const goHome = () => ctx.navigate('home', { classId });
  root.replaceChildren(el('main', { class: 'student-lesson-page' },
    el('header', { class: 'student-lesson-header' },
      el('button', { type: 'button', class: 'btn', text: '‹ 一覧へ', onclick: goHome }),
      el('div', { class: 'student-lesson-title' }, date, heading),
      el('div', { class: 'student-lesson-states' }, saveStatus, connectionStatus)),
    draftWarning, pageMessage, content));

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
      showMaterials(lesson);
    } catch {
      if (alive) pageMessage.replaceChildren(
        el('p', { class: 'error', text: 'つながりません。電波を確かめて、もう一度ためしてください。' }),
        el('button', { type: 'button', class: 'btn', text: 'もう一度ためす', onclick: load }));
    } finally { loading = false; }
  }

  function viewMaterial(item) {
    if (!alive || (item.material.type === 'image' && !item.blob)) return;
    viewer?.close();
    const { material } = item;
    viewer = openViewer({ title: material.name, kind: material.type,
      load: () => material.type === 'pdf' ? ctx.files.loadFile(classId, lessonId, material) : item.blob });
  }

  function clearImage(item) {
    if (item.image) item.image.removeAttribute('src');
    item.image = null;
    if (item.url) URL.revokeObjectURL(item.url);
    item.url = null;
    item.blob = null;
  }

  function imageFailed(item) {
    if (!alive) return;
    clearImage(item);
    item.open.disabled = true;
    if (item.thumb) showThumb(item);
    else item.preview.replaceChildren(el('span', { text: '写真' }));
    item.message.replaceChildren(el('span', { text: '読みこめませんでした' }),
      el('button', { type: 'button', class: 'btn', text: 'もう一度', onclick: () => loadImages([item.material]) }));
  }

  async function loadImages(materials) {
    if (!alive || materials.length === 0) return;
    for (const material of materials) materialViews.get(material.id).message.textContent = '読みこんでいます…';
    let blobs;
    try { blobs = await ctx.files.loadImages(classId, lessonId, materials); } catch { blobs = {}; }
    if (!alive) return;
    for (const material of materials) {
      const item = materialViews.get(material.id);
      const blob = blobs?.[material.id];
      if (!(blob instanceof Blob)) { imageFailed(item); continue; }
      try {
        clearImage(item);
        item.blob = blob;
        item.url = URL.createObjectURL(blob);
        const image = el('img', { alt: material.name, src: item.url });
        item.image = image;
        image.addEventListener('error', () => { if (item.image === image) imageFailed(item); }, { once: true });
        item.preview.replaceChildren(image);
        item.open.disabled = false;
        item.message.replaceChildren();
      } catch { imageFailed(item); }
    }
  }

  function showThumb(item) {
    const image = el('img', { src: item.thumb, alt: item.material.name });
    image.addEventListener('error', () => {
      if (alive && item.image === image) {
        item.thumb = null;
        item.image = null;
        item.preview.replaceChildren(el('span', { text: item.material.type === 'pdf' ? 'PDF' : '写真' }));
      }
    }, { once: true });
    item.image = image;
    item.preview.replaceChildren(image);
  }

  async function loadThumbs(lesson) {
    try {
      const thumbs = await ctx.thumbs.load(lesson);
      if (!alive) return;
      for (const [id, item] of materialViews) {
        const thumb = thumbs?.[id];
        // 本物の写真が先に届いたら、小さい画像へは戻さない。
        if (item.blob || typeof thumb !== 'string' || !/^data:image\/(?:jpeg|png|webp);base64,/.test(thumb)) continue;
        item.thumb = thumb;
        showThumb(item);
      }
    } catch { /* 小さい画像がなくても、写真の本体や PDF は開ける */ }
  }

  function showMaterials(lesson) {
    const materials = materialList(lesson.materials);
    if (materials.length === 0) {
      materialsArea.replaceChildren(el('p', { text: '先生の資料は、まだありません。' }));
      return;
    }
    materialsArea.replaceChildren(el('ul', { class: 'student-material-list' }, materials.map((material) => {
      const preview = el('span', { class: `student-material-preview student-material-${material.type}` },
        el('span', { text: material.type === 'pdf' ? 'PDF' : '写真' }));
      const message = el('div', { class: 'student-material-message', role: 'status' });
      const item = { material, preview, message, blob: null, url: null, image: null, thumb: null, open: null };
      item.open = el('button', { type: 'button', class: 'student-material-open', disabled: material.type === 'image',
        'aria-label': `${material.name} を開く`, onclick: () => viewMaterial(item) }, preview,
        el('span', { class: 'student-material-summary' },
          el('span', { class: 'small', text: material.kind === 'board' ? '板書' : '配布資料' }),
          el('span', { class: 'material-name', text: material.name })));
      materialViews.set(material.id, item);
      return el('li', {}, item.open, message);
    })));
    void loadThumbs(lesson);
    void loadImages(materials.filter((material) => material.type === 'image'));
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
    if (!saver?.dirty) return true;
    showSaveState('saving');
    const saved = await saver.flush();
    if (!alive) return false;
    if (saved) return true;
    return confirmDialog({ title: 'まだ保存できていません',
      body: 'この iPad の中に残して、一覧へもどりますか？　次に一覧を開いたときに、もう一度送ります。',
      okLabel: '一覧へもどる', cancelLabel: 'ここに残る', signal: dialogs.signal });
  }

  const onOffline = () => { online = false; showConnection(); };
  const onOnline = () => {
    online = true;
    showConnection();
    if (saver && (saver.state === 'failed' || saver.state === 'retrying')) void saver.retry();
  };
  ctx.setLeaveGuard(okToLeave);
  window.addEventListener('offline', onOffline);
  window.addEventListener('online', onOnline);
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
    document.removeEventListener('visibilitychange', refreshRecord);
    viewer?.close();
    viewer = null;
    for (const item of materialViews.values()) clearImage(item);
    materialViews.clear();
  };
}
