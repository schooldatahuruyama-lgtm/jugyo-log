// 授業の切りかえでは作りかけを引き継ぎ、記録のページを離れたら捨てる。
import { el, toast, confirmDialog } from '../../ui.js';
import { buildSummaryRequest, cleanAiSummary, isSummaryStale, aiSummaryText,
  aiSummaryLabel, aiSummaryStudent, aiSummarySections, aiSummaryDate, aiSummaryError } from '../../ai-summary-logic.js';

export function createAiSummarySession({ repo, request, now }) {
  let alive = true;
  const available = typeof request === 'function';
  const states = new Map();
  const notify = (state) => { if (alive) for (const listener of state.listeners) listener(); };

  function stateFor(classId, lessonId) {
    const key = JSON.stringify([classId, lessonId]);
    if (!states.has(key)) states.set(key, { classId, lessonId, saved: null,
      loaded: false, loading: false, loadError: false, error: '', saveError: false,
      phase: '', listeners: new Set() });
    return states.get(key);
  }

  async function load(state) {
    if (!alive || state.loading || state.phase || state.saveError) return;
    state.loading = true;
    state.loadError = false;
    notify(state);
    try {
      const saved = await repo.getAiSummary(state.classId, state.lessonId);
      if (!alive) return;
      const summary = cleanAiSummary(saved);
      state.saved = summary ? { ...saved, ...summary } : null;
      state.loaded = true;
    } catch {
      if (alive) state.loadError = true;
    } finally {
      state.loading = false;
      notify(state);
    }
  }

  async function save(state) {
    if (!alive || !state.saved || state.phase === 'saving') return;
    state.phase = 'saving';
    notify(state);
    const saved = state.saved;
    try {
      await repo.setAiSummary(state.classId, state.lessonId,
        { summary: saved, model: saved.model, basedOn: saved.basedOn, labels: saved.labels }, saved.createdAt);
      if (alive) state.saveError = false;
    } catch {
      if (alive) state.saveError = true;
    } finally {
      state.phase = '';
      notify(state);
    }
  }

  async function generate(state, input) {
    if (!alive || !available || state.phase !== 'confirming') return;
    state.phase = 'generating';
    state.error = '';
    notify(state);
    try {
      const result = await request(input.request);
      if (!alive) return;
      const summary = cleanAiSummary(result?.summary, input.labels);
      if (!summary) { state.error = aiSummaryError('ai-failed'); return; }
      state.saved = { ...summary, v: 1, createdAt: now(), model: result.model,
        basedOn: { count: input.count, latest: input.latest }, labels: input.labels };
      // 新しいまとめは、保存の成否にかかわらず画面に残す。
      state.saveError = false;
      await save(state);
    } catch (error) {
      if (alive) state.error = aiSummaryError(error?.code);
    } finally {
      state.phase = '';
      notify(state);
    }
  }

  return { available, stateFor, load, generate, save, notify,
    destroy() { alive = false; for (const state of states.values()) state.listeners.clear(); states.clear(); } };
}

export function aiSummaryBox({ session, classId, lessonId, lesson, students, records, navigate }) {
  let alive = true;
  let copying = false;
  let copyId = 0;
  const dialogs = new AbortController();
  const input = buildSummaryRequest({ lesson, students, records });
  const state = session.stateFor(classId, lessonId);
  const current = input || { count: 0, latest: 0 };
  const node = el('section', { class: 'ai-summary-box card', 'aria-labelledby': 'ai-summary-heading' });
  const copyArea = el('div', { class: 'review-copy-area' });
  const copy = el('button', { type: 'button', class: 'btn', text: 'AI のまとめをコピー', onclick: copySummary });

  function person(number) {
    const label = aiSummaryLabel(number);
    const studentId = aiSummaryStudent(number, students, state.saved?.labels);
    if (!studentId) return el('span', { text: label });
    return el('button', { type: 'button', class: 'btn ai-summary-person', text: label,
      onclick: () => { if (alive) void navigate('t-record', { classId, lessonId, studentId }); } });
  }

  function render() {
    if (!alive) return;
    node.replaceChildren(el('h2', { id: 'ai-summary-heading', text: 'AI のまとめ' }));
    if (state.saved) {
      node.append(el('p', { class: 'notice', text: 'AI が作った文です。まちがいがあることがあります。' }));
      const date = aiSummaryDate(state.saved);
      if (date) node.append(el('p', { class: 'small ai-summary-date', text: date }));
      for (const { title, items, bullets } of aiSummarySections(state.saved)) {
        const lines = items.map((parts) => el(bullets ? 'li' : 'p', { class: 'ai-summary-text' },
          parts.map((part) => typeof part === 'string' ? el('span', { text: part }) : person(part.number))));
        node.append(el('section', {}, el('h3', { text: title }), items.length
          ? (bullets ? el('ul', {}, lines) : lines) : el('p', { text: '（ありません）' })));
      }
      if (isSummaryStale(state.saved, current)) node.append(el('p', { class: 'notice',
        text: 'このまとめを作ったあとに、記録が変わっています。' }));
    } else {
      node.append(el('p', { text: '文字で書いた記録を OpenAI に送り、AI がまとめます。名前や ID の欄は送りません。手書きは入りません。' }));
    }
    if (!session.available) node.append(el('p', { text: 'この画面では、AI のまとめを使えません。' }));
    if (state.loading) node.append(el('p', { role: 'status', text: '読みこんでいます…' }));
    if (state.loadError) node.append(el('p', { role: 'alert', text: 'AI のまとめを読みこめませんでした。' }),
      el('button', { type: 'button', class: 'btn', text: 'もう一度', onclick: () => { if (alive) void session.load(state); } }));
    if (state.phase === 'generating') node.append(el('p', { role: 'status', text: 'AI がまとめています…（30 秒ほどかかります）' }));
    if (state.phase === 'saving') node.append(el('p', { role: 'status', text: '保存しています…' }));
    if (state.error) node.append(el('p', { role: 'alert', text: state.error }));
    if (state.saveError) node.append(el('p', { role: 'alert', text: 'まとめは作れましたが、保存できませんでした。開き直すと消えます。' }),
      el('button', { type: 'button', class: 'btn', text: 'もう一度保存する', disabled: Boolean(state.phase),
        onclick: () => { if (alive && !state.phase) void session.save(state); } }));
    if (state.loaded && !state.loading && !state.loadError) {
      const generate = session.available ? el('button', { type: 'button', class: 'btn btn-primary',
        text: state.saved ? '作り直す' : 'AI でまとめる', disabled: !input || Boolean(state.phase), onclick: confirmSummary }) : null;
      copy.disabled = copying;
      node.append(el('div', { class: 'page-actions' }, generate,
        session.available ? el('span', { class: 'small', text: input ? `（文字で書いた ${input.count} 人分）` : '（文字で書いた記録がありません）' }) : null,
        state.saved ? copy : null));
    }
    node.append(copyArea);
  }

  async function confirmSummary() {
    if (!alive || !session.available || !input || !state.loaded || state.loading || state.loadError || state.phase) return;
    state.phase = 'confirming';
    session.notify(state);
    const ok = await confirmDialog({ title: 'AI でまとめますか？',
      body: `この授業の、文字で書いた記録（${input.count} 人分）を、OpenAI に送ります。名前や ID の欄は送りません。生徒が文の中に書いた名前などは、そのまま送られます。`
        + (input.truncated ? '（人数が多いので、はじめの 60 人分だけ送ります）' : ''),
      okLabel: 'まとめる', signal: dialogs.signal });
    if (!alive || !ok) {
      state.phase = '';
      session.notify(state);
      return;
    }
    copyId += 1;
    copying = false;
    copyArea.replaceChildren();
    await session.generate(state, input);
  }

  async function copySummary() {
    if (!alive || copying || !state.saved) return;
    const id = ++copyId;
    const value = ['AI が作った文です。まちがいがあることがあります。', aiSummaryDate(state.saved),
      aiSummaryText(state.saved)].filter(Boolean).join('\n\n');
    copying = true;
    copy.disabled = true;
    copyArea.replaceChildren();
    try {
      if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('コピーを使えません');
      await navigator.clipboard.writeText(value);
      if (alive && id === copyId) toast('AI のまとめをコピーしました。');
    } catch {
      if (!alive || id !== copyId) return;
      const text = el('textarea', { id: 'ai-summary-copy-text', rows: 8, readonly: true, value });
      copyArea.replaceChildren(el('div', { class: 'notice' },
        el('p', { role: 'status', text: 'コピーできませんでした。下の文章を選んで、コピーしてください。' }),
        el('label', { class: 'label', for: 'ai-summary-copy-text', text: 'コピーする文章' }), text,
        el('button', { type: 'button', class: 'btn', text: '閉じる', onclick: () => { copyArea.replaceChildren(); copy.focus(); } })));
      text.focus();
      text.select();
    } finally {
      if (alive && id === copyId) { copying = false; copy.disabled = false; }
    }
  }

  state.listeners.add(render);
  render();
  void session.load(state);
  return { node, destroy() { alive = false; copyId += 1; state.listeners.delete(render); dialogs.abort(); } };
}
