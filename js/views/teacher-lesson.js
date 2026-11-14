// 授業の情報と資料の編集（#/t/lesson/<classId>/<lessonId>）。
import { el, confirmDialog, toast, statusChip } from '../ui.js';
import { CONFIG } from '../config.js';
import { newId } from '../ids.js';
import { checkLesson, sortUnits, materialList, nextOrder, moveInOrder } from '../lesson-logic.js';
import { cleanTerm, checkTerm, termKey, lessonTerms, suggestTerms } from '../term-logic.js';
import { compressImage, compressCanvas, dataUrlToBase64 } from '../image.js';
import { openPdf } from '../pdf.js';
import { addMaterialFlow, removeMaterialFlow } from '../material-flow.js';
import { teacherNav } from './parts/teacher-nav.js';
import { openViewer } from './parts/viewer.js';

function sendError(code) {
  if (code === 'toobig') return 'ファイルが大きすぎます。';
  if (code === 'denied') return '先生としてログインし直してください。';
  if (code === 'limit') return '資料は 12 個までです。';
  if (code === 'notfound') return '付ける先の授業が見つかりません。';
  return 'もう一度ためしてください。';
}

// PDF は大きいので、一度に全バイトを引数に広げない。
function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const parts = [];
  for (let i = 0; i < bytes.length; i += 8192) parts.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  return btoa(parts.join(''));
}

export function mount(root, ctx) {
  const { classId, lessonId } = ctx.params;
  let alive = true;
  let lesson = null;
  let cls = null;
  let classes = [];
  let thumbs = {};
  let ready = false;
  let loading = false;
  let saving = false;
  let materialBusy = false;
  let selecting = false;
  let pending = null;
  let viewer = null;
  let baseline = '';
  let termBusy = false;
  let termLocked = false;
  let termRequest = null;
  let allLessons = null;
  let suggestionId = 0;
  const dialogs = new AbortController();

  const date = el('input', { id: 'edit-lesson-date', type: 'date' });
  const title = el('input', { id: 'edit-lesson-title', type: 'text', autocomplete: 'off' });
  const unit = el('select', { id: 'edit-lesson-unit' });
  const snapshot = () => JSON.stringify([date.value, title.value, unit.value]);
  const dirty = () => lesson !== null && snapshot() !== baseline;
  const infoError = el('div', { class: 'error', role: 'alert', hidden: true });
  const save = el('button', { type: 'submit', class: 'btn btn-primary', text: '保存する' });
  const infoStatus = el('div', { class: 'page-message', role: 'status', 'aria-live': 'polite' });
  const infoForm = el('form', { class: 'card inline-form', novalidate: true, onsubmit: saveInfo },
    el('h2', { text: '授業の情報' }),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'edit-lesson-date', text: '日付' }), date),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'edit-lesson-title', text: '授業名' }),
      el('p', { class: 'small muted field-hint', text: `${CONFIG.lessonTitleMax} 文字まで` }), title),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'edit-lesson-unit', text: '単元' }), unit),
    infoError, infoStatus, el('div', { class: 'dialog-actions' }, save));
  const termList = el('div', { class: 'term-list' });
  const termError = el('p', { class: 'error term-message', role: 'alert' });
  const termLimit = el('p', { class: 'small term-message', role: 'status' });
  const termInput = el('input', { type: 'text', maxlength: CONFIG.termMax, autocomplete: 'off',
    placeholder: `用語を足す（${CONFIG.termMax} 文字まで）`, 'aria-label': '重要用語を足す',
    'aria-describedby': 'lesson-term-hint',
    onkeydown: (ev) => { if (ev.key === 'Enter' && (ev.isComposing || ev.keyCode === 229)) ev.preventDefault(); } });
  const termAdd = el('button', { type: 'submit', class: 'btn', text: '＋ 足す' });
  const suggestions = el('div', { class: 'term-suggestions', hidden: true });
  const termsSection = el('section', { class: 'card lesson-terms', 'aria-labelledby': 'lesson-terms-heading' },
    el('h2', { id: 'lesson-terms-heading', text: '重要用語' }), termList,
    el('form', { class: 'term-input-row', novalidate: true,
      onsubmit: (ev) => { ev.preventDefault(); void addTerm(termInput.value); } }, termInput, termAdd),
    el('p', { id: 'lesson-term-hint', class: 'small term-message', text: '人の名前など、個人が分かる言葉は入れないでください。' }),
    termLimit, termError, suggestions);
  const imageInput = el('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => selectFile(imageInput, 'image') });
  const pdfInput = el('input', { type: 'file', accept: 'application/pdf', hidden: true, onchange: () => selectFile(pdfInput, 'pdf') });
  const photoButton = el('button', { type: 'button', class: 'btn', text: '写真を足す', onclick: () => chooseFile(imageInput) });
  const pdfButton = el('button', { type: 'button', class: 'btn', text: 'PDF を足す', onclick: () => chooseFile(pdfInput) });
  const formArea = el('div', { class: 'form-area' });
  const materialMessage = el('div', { class: 'page-message', role: 'status', 'aria-live': 'polite' });
  const listArea = el('div');
  const heading = el('h1', { text: '授業の編集' });
  const content = el('div', { hidden: true }, heading, infoForm, termsSection,
    el('section', { class: 'lesson-materials', 'aria-label': '授業の資料' },
      el('h2', { text: '授業の資料' }),
      el('div', { class: 'page-actions' }, photoButton, pdfButton, imageInput, pdfInput),
      formArea, materialMessage, listArea));
  const pageMessage = el('div', { class: 'page-message', role: 'status', 'aria-live': 'polite' });
  root.replaceChildren(teacherNav({ ...ctx, okToLeave }, 'lessons'),
    el('main', { class: 'page-main' },
      el('div', { class: 'page-actions' }, el('button', {
        type: 'button', class: 'btn', text: '‹ 授業の一覧へ', onclick: () => ctx.navigate('t-lessons'),
      }), el('button', {
        type: 'button', class: 'btn', text: '生徒の記録を見る', onclick: () => ctx.navigate('t-review', { classId, lessonId }),
      })), pageMessage, content));

  async function okToLeave() {
    if (termLocked) return false;
    termLocked = true;
    syncTermControls();
    try {
      if (termBusy) {
        try { await termRequest; } catch { return false; }
        if (!alive) return false;
      }
      if (saving || materialBusy) { toast('処理しています。終わるまで待ってください。'); return false; }
      if (dirty() || pending) {
        const sending = pending?.sending;
        if (!await confirmDialog({
          title: sending ? '資料を送っています' : '保存していない変更があります',
          body: sending
            ? '送信はまだ終わっていません。画面を移っても送信が続くことがあります。移りますか？'
            : '授業の変更や、足そうとしている資料がまだ保存されていません。保存しないで移りますか？',
          okLabel: 'この画面を離れる', cancelLabel: 'この画面に残る', signal: dialogs.signal,
        })) return false;
      }
      return alive;
    } finally {
      // ログアウトでは、このあとにも取り消せる確認があるので、成功時も元に戻す。
      termLocked = false;
      syncTermControls();
    }
  }
  if (ctx.setLeaveGuard) ctx.setLeaveGuard(okToLeave);
  const onBeforeUnload = (ev) => {
    if (!dirty() && !pending && !saving && !materialBusy) return;
    ev.preventDefault();
    ev.returnValue = '';
  };
  window.addEventListener('beforeunload', onBeforeUnload);

  function syncControls() {
    if (!alive) return;
    syncTermControls();
    const infoLocked = !ready || loading || saving || materialBusy || selecting || pending !== null;
    for (const control of infoForm.querySelectorAll('input, select, button')) control.disabled = infoLocked;
    photoButton.disabled = infoLocked;
    pdfButton.disabled = infoLocked;
    // 一覧の「開く」と上部の移動ボタンは、送信中でも使える。
    for (const button of listArea.querySelectorAll('[data-material-action]')) {
      button.disabled = !ready || loading || materialBusy || saving || Boolean(pending?.request) || button.dataset.edge === 'true';
    }
  }

  function notFound() {
    lesson = null;
    ready = false;
    content.hidden = true;
    pageMessage.replaceChildren(el('p', { text: 'この授業は見つかりません。' }),
      el('button', { type: 'button', class: 'btn', text: '授業の一覧へ', onclick: () => ctx.navigate('t-lessons') }));
  }

  async function load() {
    if (loading) return;
    loading = true;
    pageMessage.textContent = '読みこんでいます…';
    try {
      const [loadedClasses, loadedLesson] = await Promise.all([ctx.repo.listClasses(), ctx.repo.getLesson(classId, lessonId)]);
      if (!alive) return;
      classes = loadedClasses;
      cls = classes.find((c) => c.id === classId);
      if (!loadedLesson || !cls) { notFound(); return; }
      const [units, loadedThumbs] = await Promise.all([
        ctx.repo.listUnits(cls.year), ctx.repo.getThumbs(classId, lessonId).catch(() => ({})),
      ]);
      if (!alive) return;
      lesson = loadedLesson;
      thumbs = loadedThumbs;
      date.value = lesson.date;
      title.value = lesson.title;
      unit.replaceChildren(el('option', { value: '', text: '（なし）' }),
        ...sortUnits(units).map((u) => el('option', { value: u.id, text: u.name })));
      if (lesson.unitId && !units.some((u) => u.id === lesson.unitId)) {
        unit.append(el('option', { value: lesson.unitId, text: '（見つからない単元）' }));
      }
      unit.value = lesson.unitId;
      baseline = snapshot();
      heading.textContent = `${cls.name}・授業の編集`;
      ready = true;
      content.hidden = false;
      pageMessage.replaceChildren();
      renderMaterials();
      renderTerms();
      void loadSuggestions();
    } catch {
      if (alive) pageMessage.replaceChildren(
        el('p', { class: 'error', role: 'alert', text: 'つながりません。もう一度ためしてください。' }),
        el('button', { type: 'button', class: 'btn', text: 'もう一度', onclick: load }));
    } finally {
      loading = false;
      syncControls();
    }
  }

  async function saveInfo(ev) {
    ev.preventDefault();
    if (!ready || saving || materialBusy || selecting || pending) return;
    const values = { date: date.value, title: title.value.trim(), unitId: unit.value };
    const code = checkLesson(values, { titleMax: CONFIG.lessonTitleMax });
    infoError.hidden = !code;
    if (code) {
      infoError.textContent = code === 'bad-date' ? '日付を正しく入れてください。'
        : code === 'no-title' ? '授業名を入れてください。' : `授業名は ${CONFIG.lessonTitleMax} 文字までです。`;
      return;
    }
    saving = true;
    infoStatus.replaceChildren(statusChip('info', '保存しています…'));
    syncControls();
    try {
      if (!(await ctx.repo.getLesson(classId, lessonId))) { if (alive) notFound(); return; }
      await ctx.repo.updateLesson(classId, lessonId, values, ctx.now());
      if (!alive) return;
      lesson = { ...lesson, ...values };
      title.value = values.title;
      baseline = snapshot();
      infoStatus.replaceChildren(statusChip('ok', '保存しました'));
      void loadSuggestions();
    } catch {
      if (alive) { infoError.textContent = '保存できませんでした。もう一度ためしてください。'; infoError.hidden = false; infoStatus.replaceChildren(); }
    } finally {
      saving = false;
      syncControls();
    }
  }

  function syncTermControls() {
    if (!alive) return;
    const locked = !ready || loading || termBusy || termLocked;
    const full = lessonTerms(lesson).length >= CONFIG.termsPerLesson;
    for (const button of termsSection.querySelectorAll('button')) button.disabled = locked;
    for (const button of suggestions.querySelectorAll('button')) button.disabled = locked || full;
    termInput.disabled = locked || full;
    termAdd.disabled = locked || full;
    termLimit.textContent = full ? `重要用語は ${CONFIG.termsPerLesson} 個までです。` : '';
  }

  function renderTerms() {
    if (!alive || !lesson) return;
    const terms = lessonTerms(lesson);
    termList.replaceChildren(...(terms.length ? terms.map((term) => el('button', {
      type: 'button', class: 'term-pill', text: `${term.text} ×`, 'aria-label': `${term.text} を外す`,
      onclick: () => removeTerm(term),
    })) : [el('span', { class: 'small', text: '（まだありません）' })]));
    renderSuggestions();
  }

  function renderSuggestions() {
    if (!alive || !lesson) return;
    // 候補を読んだあとに足した・外した用語も、今の授業の内容で除く。
    const source = allLessons ? { ...allLessons, [classId]: { ...allLessons[classId], [lessonId]: lesson } } : null;
    const texts = suggestTerms(source, { classId, lessonId, unitId: lesson.unitId }, 12);
    suggestions.hidden = texts.length === 0;
    suggestions.replaceChildren(...(texts.length ? [
      el('h3', { text: '同じ単元で前に使った用語' }),
      el('div', { class: 'term-list' }, texts.map((text) => el('button', {
        type: 'button', class: 'term-pill', text, onclick: () => addTerm(text),
      }))),
    ] : []));
    syncTermControls();
  }

  async function loadSuggestions() {
    const id = ++suggestionId;
    allLessons = null;
    renderSuggestions();
    if (!lesson?.unitId) return;
    try {
      const found = await ctx.repo.listAllLessons();
      if (!alive || id !== suggestionId) return;
      allLessons = found;
      renderSuggestions();
    } catch { /* 候補を読めなくても、用語の入力は使える。 */ }
  }

  async function addTerm(value) {
    if (!alive || !ready || loading || termBusy || termLocked) return;
    termError.textContent = '';
    const code = checkTerm(value);
    if (code === 'empty') return;
    if (code) { termError.textContent = `用語は ${CONFIG.termMax} 文字までです。`; return; }
    const text = cleanTerm(value);
    const terms = lessonTerms(lesson);
    if (terms.some((term) => termKey(term.text) === termKey(text))) {
      termError.textContent = 'その用語は、もうあります。';
      return;
    }
    if (terms.length >= CONFIG.termsPerLesson) { syncTermControls(); return; }
    termBusy = true;
    syncTermControls();
    try {
      const termId = ctx.now().toString(36).padStart(9, '0') + newId(ctx.random, 4);
      termRequest = ctx.repo.addLessonTerm(classId, lessonId, termId, text, ctx.now());
      await termRequest;
      if (!alive) return;
      lesson.terms = { ...lesson.terms, [termId]: text };
      termInput.value = '';
      renderTerms();
    } catch {
      if (alive) termError.textContent = '保存できませんでした。もう一度ためしてください。';
    } finally { termBusy = false; syncTermControls(); }
  }

  async function removeTerm(term) {
    if (!alive || !ready || loading || termBusy || termLocked) return;
    termBusy = true;
    termError.textContent = '';
    syncTermControls();
    try {
      termRequest = ctx.repo.removeLessonTerm(classId, lessonId, term.id, ctx.now());
      await termRequest;
      if (!alive) return;
      const terms = { ...lesson.terms };
      delete terms[term.id];
      lesson.terms = terms;
      renderTerms();
      toast(`『${term.text}』を外しました。`);
    } catch {
      if (alive) termError.textContent = '保存できませんでした。もう一度ためしてください。';
    } finally { termBusy = false; syncTermControls(); }
  }

  function viewMaterial(material) {
    viewer?.close();
    viewer = openViewer({ title: material.name, kind: material.type, load: async () => {
      if (material.type === 'pdf') return ctx.files.loadFile(classId, lessonId, material);
      const images = await ctx.files.loadImages(classId, lessonId, [material]);
      return images[material.id];
    } });
  }

  function renderMaterials() {
    if (!alive || !lesson) return;
    const materials = materialList(lesson.materials);
    listArea.replaceChildren(materials.length ? el('ul', { class: 'material-rows' }, materials.map((material, index) => {
      const label = material.kind === 'board' ? '板書' : '配布資料';
      const thumb = thumbs[material.id];
      const preview = typeof thumb === 'string' && /^data:image\/(?:jpeg|png|webp);base64,/.test(thumb)
        ? el('img', { src: thumb, alt: '', loading: 'lazy' }) : el('span', { text: material.type === 'pdf' ? 'PDF' : '写真' });
      return el('li', { class: 'material-row' },
        el('button', { type: 'button', class: 'material-open', 'aria-label': `${material.name} を開く`, onclick: () => viewMaterial(material) },
          el('span', { class: 'material-thumb' }, preview),
          el('span', { class: 'material-summary' }, el('span', { class: 'small', text: label }), el('span', { class: 'material-name', text: material.name }))),
        el('div', { class: 'material-actions' },
          el('button', { type: 'button', class: 'btn', text: '上へ', dataset: { materialAction: '', edge: String(index === 0) },
            'aria-label': `${material.name} を上へ`, onclick: () => moveMaterial(material, -1) }),
          el('button', { type: 'button', class: 'btn', text: '下へ', dataset: { materialAction: '', edge: String(index === materials.length - 1) },
            'aria-label': `${material.name} を下へ`, onclick: () => moveMaterial(material, 1) }),
          el('button', { type: 'button', class: 'btn btn-danger-text', text: '消す', dataset: { materialAction: '' },
            'aria-label': `${material.name} を消す`, onclick: () => removeMaterial(material) })));
    })) : el('p', { class: 'home-empty', text: 'まだ資料がありません。写真や PDF を足せます。' }));
    syncControls();
  }

  async function moveMaterial(material, direction) {
    if (!ready || materialBusy || saving || pending?.request) return;
    const orders = moveInOrder(materialList(lesson.materials), material.id, direction);
    if (Object.keys(orders).length === 0) return;
    materialBusy = true;
    syncControls();
    try {
      await ctx.repo.setMaterialOrders(classId, lessonId, orders, ctx.now());
      if (!alive) return;
      for (const [id, order] of Object.entries(orders)) lesson.materials[id].order = order;
      renderMaterials();
      toast('順番を変えました。');
    } catch {
      if (alive) toast('順番を変えられませんでした。もう一度ためしてください。');
    } finally { materialBusy = false; syncControls(); }
  }

  async function removeMaterial(material) {
    if (!ready || materialBusy || saving || pending?.request) return;
    materialBusy = true;
    syncControls();
    try {
      const ok = await confirmDialog({ title: '資料を消しますか？',
        body: 'この授業から外します。ほかの授業にも付けてある場合、そちらには残ります。',
        okLabel: 'この授業から外す', danger: true, signal: dialogs.signal });
      if (!ok || !alive) return;
      await removeMaterialFlow({ repo: ctx.repo, files: ctx.files, classId, lessonId, material, now: ctx.now() });
      if (!alive) return;
      delete lesson.materials[material.id];
      delete thumbs[material.id];
      renderMaterials();
      toast('この授業から外しました。');
    } catch {
      if (alive) toast('外せませんでした。もう一度ためしてください。');
    } finally { materialBusy = false; syncControls(); }
  }

  function chooseFile(input) {
    if (!ready || saving || materialBusy || selecting || pending) return;
    if (dirty()) { toast('授業の変更を先に保存してください。'); return; }
    input.click();
  }

  async function selectFile(input, type) {
    const file = input.files?.[0];
    input.value = '';
    if (!file || !ready || saving || materialBusy || selecting || pending) return;
    if (dirty()) { toast('授業の変更を先に保存してください。'); return; }
    if (Object.keys(lesson.materials).length >= CONFIG.materialsPerLesson) { toast('資料は 12 個までです。'); return; }
    if (type === 'pdf' && file.size > CONFIG.pdfMaxBytes) { toast('PDF は 10MB までです。'); return; }
    selecting = true;
    materialMessage.textContent = '同じ日の授業を調べています…';
    syncControls();
    try {
      const others = classes.filter((c) => c.year === cls.year && c.id !== classId);
      const groups = await Promise.all(others.map(async (other) => ({ cls: other, lessons: await ctx.repo.listLessons(other.id) })));
      if (!alive) return;
      const targets = groups.flatMap((group) => group.lessons.filter((other) => other.date === lesson.date).map((other) => ({
        classId: group.cls.id, lessonId: other.id, label: `${group.cls.name}・${other.title}`,
        input: el('input', { type: 'checkbox' }),
      })));
      showAddForm(file, type, targets);
      materialMessage.replaceChildren();
    } catch {
      if (alive) materialMessage.replaceChildren(
        el('p', { class: 'error', text: 'ほかのクラスの授業を読めませんでした。ファイルを選び直してください。' }));
    } finally { selecting = false; syncControls(); }
  }

  function showAddForm(file, type, targets) {
    const kind = el('select', { id: 'material-kind' },
      el('option', { value: 'board', text: '板書' }), el('option', { value: 'handout', text: '配布資料' }));
    kind.value = type === 'image' ? 'board' : 'handout';
    const name = el('input', { id: 'material-name', type: 'text', autocomplete: 'off',
      value: type === 'image' ? '板書' : file.name.replace(/\.pdf$/i, '') });
    let defaultName = '板書';
    kind.addEventListener('change', () => {
      const next = kind.value === 'board' ? '板書' : '資料';
      if (type === 'image' && name.value === defaultName) name.value = next;
      defaultName = next;
    });
    const progress = el('div', { class: 'page-message', role: 'status', 'aria-live': 'polite' });
    const error = el('div', { class: 'error', role: 'alert', hidden: true });
    const add = el('button', { type: 'submit', class: 'btn btn-primary', text: '足す' });
    const cancel = el('button', { type: 'button', class: 'btn', text: 'やめる', onclick: () => {
      if (pending?.sending) return;
      pending = null;
      formArea.replaceChildren();
      syncControls();
    } });
    const form = el('form', { class: 'card inline-form material-form', novalidate: true, onsubmit: (ev) => { ev.preventDefault(); sendMaterial(); } },
      el('h3', { text: '資料を足す' }), el('p', { class: 'small material-file-name', text: file.name }),
      el('div', { class: 'field' }, el('label', { class: 'label', for: 'material-kind', text: '種類' }), kind),
      el('div', { class: 'field' }, el('label', { class: 'label', for: 'material-name', text: '名前' }),
        el('p', { class: 'small muted field-hint', text: `1〜${CONFIG.materialNameMax} 文字` }), name),
      el('fieldset', { class: 'lesson-targets' },
        el('legend', { class: 'label', text: '同じ資料を、ほかのクラスの授業にも付ける' }),
        targets.length ? el('div', { class: 'check-list' }, targets.map((target) =>
          el('label', { class: 'check-row' }, target.input, el('span', { text: target.label }))))
          : el('p', { class: 'small', text: '同じ年度のほかのクラスに、同じ日の授業はありません。' })),
      progress, error, el('div', { class: 'dialog-actions' }, cancel, add));
    pending = { file, type, targets, kind, name, progress, error, add, cancel, form,
      key: newId(ctx.random, 24), materialId: newId(ctx.random, CONFIG.idLength),
      sending: false, request: null, prepared: null };
    formArea.replaceChildren(form);
    name.focus();
  }

  function syncPending(item) {
    for (const control of item.form.querySelectorAll('input, select')) control.disabled = item.sending || item.request !== null;
    item.add.disabled = item.sending;
    item.cancel.disabled = item.sending;
    syncControls();
  }

  async function prepareMaterial(item) {
    if (item.prepared) return item.prepared;
    if (item.type === 'image') {
      item.progress.textContent = '写真を小さくしています…';
      const image = await compressImage(item.file, { maxEdge: CONFIG.image.maxEdge, maxBytes: CONFIG.image.maxChars });
      const thumb = await compressImage(item.file, { maxEdge: CONFIG.thumb.maxEdge, maxBytes: CONFIG.thumb.maxChars });
      return { mime: 'image/jpeg', dataB64: dataUrlToBase64(image), thumb };
    }
    item.progress.textContent = 'PDF を用意しています…';
    const buffer = await item.file.arrayBuffer();
    const dataB64 = bufferToBase64(buffer);
    let thumb = null;
    let pdf = null;
    try {
      pdf = await openPdf(buffer);
      const canvas = await pdf.renderPage(1, CONFIG.thumb.maxEdge);
      thumb = compressCanvas(canvas, { maxBytes: CONFIG.thumb.maxChars });
    } catch { /* PDF を送れるように、サムネイルが作れなくても続ける */ }
    finally { if (pdf) await pdf.close(); }
    return { mime: 'application/pdf', dataB64, thumb };
  }

  async function sendMaterial() {
    const item = pending;
    if (!item || item.sending || materialBusy || saving || !ready) return;
    item.error.hidden = true;
    if (!item.request) {
      const name = item.name.value.trim();
      if (!name || name.length > CONFIG.materialNameMax) {
        item.error.textContent = `名前は 1〜${CONFIG.materialNameMax} 文字で入れてください。`;
        item.error.hidden = false;
        return;
      }
      item.request = { kind: item.kind.value, name, targets: [
        { classId, lessonId }, ...item.targets.filter((t) => t.input.checked).map((t) => ({ classId: t.classId, lessonId: t.lessonId })),
      ] };
    }
    item.sending = true;
    syncPending(item);
    try {
      item.progress.textContent = '付ける先の授業を確かめています…';
      const targets = await Promise.all(item.request.targets.map(async (target) => {
        const found = await ctx.repo.getLesson(target.classId, target.lessonId);
        if (!found) throw Object.assign(new Error('授業がありません'), { code: 'notfound' });
        // 応答だけ失われて登録済みでも、自分の資料 ID は上限の計算から除く。
        const count = Object.keys(found.materials).filter((id) => id !== item.materialId).length;
        if (count >= CONFIG.materialsPerLesson) throw Object.assign(new Error('資料がいっぱいです'), { code: 'limit' });
        return { ...target, order: target.order ?? found.materials[item.materialId]?.order ?? nextOrder(found.materials) };
      }));
      item.request.targets = targets;
      if (!alive) return;
      item.prepared = await prepareMaterial(item);
      if (!alive) return;
      item.progress.textContent = '送っています…（大きい PDF は 1 分ほどかかります）';
      await addMaterialFlow({ repo: ctx.repo, files: ctx.files, key: item.key, materialId: item.materialId,
        kind: item.request.kind, type: item.type, name: item.request.name, ...item.prepared,
        targets: item.request.targets, now: ctx.now() });
      if (!alive) return;
      pending = null;
      formArea.replaceChildren();
      toast('資料を足しました。');
      await refreshMaterials();
    } catch (error) {
      if (!alive) return;
      item.progress.replaceChildren(statusChip('danger', '送れませんでした'));
      item.error.textContent = sendError(error?.code);
      item.error.hidden = false;
      item.add.textContent = 'やり直す';
    } finally {
      item.sending = false;
      if (alive && pending === item) syncPending(item);
      syncControls();
    }
  }

  async function refreshMaterials() {
    ready = false;
    syncControls();
    materialMessage.textContent = '資料の一覧を読みこんでいます…';
    try {
      const [found, images] = await Promise.all([
        ctx.repo.getLesson(classId, lessonId), ctx.repo.getThumbs(classId, lessonId).catch(() => ({})),
      ]);
      if (!alive) return;
      if (!found) { notFound(); return; }
      lesson.materials = found.materials;
      thumbs = images;
      ready = true;
      materialMessage.replaceChildren();
      renderMaterials();
    } catch {
      if (alive) materialMessage.replaceChildren(
        el('p', { class: 'error', text: '資料は保存しましたが、一覧を読み直せませんでした。' }),
        el('button', { type: 'button', class: 'btn', text: '一覧を読み直す', onclick: refreshMaterials }));
    } finally { syncControls(); }
  }

  load();
  return () => {
    alive = false;
    dialogs.abort();
    viewer?.close();
    window.removeEventListener('beforeunload', onBeforeUnload);
  };
}
