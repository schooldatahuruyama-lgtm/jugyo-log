// 読みこんだ一覧だけで作るまとめ。画面が替わったらコピーの結果も破棄する。
import { el, toast } from '../../ui.js';
import { normalizeText, extractWords, summarize, summaryText } from '../../summary-logic.js';

export function summaryBox({ students, records, terms }) {
  let alive = true;
  let copying = false;
  let selected = null;
  const summary = summarize({ students, records, terms });
  const labelOf = (student) => !student.inRoster ? '名簿にいない' : student.number === null ? '出席番号なし' : `${student.number} 番`;
  const fields = [['question', '疑問'], ['learned', '分かったこと']];
  const details = el('div', { id: 'review-summary-details', class: 'summary-details', hidden: true });
  const copyArea = el('div', { class: 'review-copy-area' });
  const copy = el('button', { type: 'button', class: 'btn', text: 'まとめをコピー', onclick: copySummary });
  const node = el('section', { class: 'summary-box card', 'aria-labelledby': 'review-summary-heading' },
    el('h2', { id: 'review-summary-heading', text: 'まとめ（自動）' }));

  function excerpts(items) {
    return items.length ? el('ul', { class: 'summary-excerpts' }, items.map(({ student, text }) => el('li', {},
      el('span', { class: 'review-person', text: labelOf(student) }), el('p', { class: 'summary-text', text }))))
      : el('p', { text: '（ありません）' });
  }

  function toggle(button, word, matches) {
    if (!alive) return;
    const close = selected === button;
    selected?.setAttribute('aria-expanded', 'false');
    selected = close ? null : button;
    details.hidden = close;
    details.replaceChildren();
    if (close) return;
    button.setAttribute('aria-expanded', 'true');
    details.append(el('h3', { text: `「${word}」を書いた生徒` }), ...fields.map(([field, label]) =>
      el('section', {}, el('h4', { text: label }), excerpts(matches[field].map((student) => ({ student, text: student.record[field] }))))));
  }

  function disclosure(text, word, matches) {
    const button = el('button', { type: 'button', class: 'btn', text,
      'aria-expanded': 'false', 'aria-controls': 'review-summary-details', onclick: () => toggle(button, word, matches()) });
    return button;
  }

  async function copySummary() {
    if (!alive || copying) return;
    copying = true;
    copy.disabled = true;
    copyArea.replaceChildren();
    const value = summaryText(summary, labelOf);
    try {
      if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('コピーを使えません');
      await navigator.clipboard.writeText(value);
      if (alive) toast('まとめをコピーしました。');
    } catch {
      if (!alive) return;
      const text = el('textarea', { id: 'summary-copy-text', rows: 8, readonly: true, value });
      copyArea.replaceChildren(el('div', { class: 'notice' },
        el('p', { role: 'status', text: 'コピーできませんでした。下の文章を選んで、コピーしてください。' }),
        el('label', { class: 'label', for: 'summary-copy-text', text: 'コピーする文章' }), text,
        el('button', { type: 'button', class: 'btn', text: '閉じる', onclick: () => { copyArea.replaceChildren(); copy.focus(); } })));
      text.focus();
      text.select();
    } finally {
      if (alive) { copying = false; copy.disabled = false; }
    }
  }

  if (!students.some((student) => student.record)) {
    node.append(el('p', { text: 'まだ記録がありません。' }));
  } else {
    node.append(el('p', { text: '文字で書いた記録を、このアプリの中で数えたものです。手書きは入っていません。' }),
      el('h3', { text: '書いた人数' }), ...fields.map(([field, label]) => {
        const counts = summary.counts[field];
        return el('p', { text: `${label}: 文字 ${counts.text} 人・手書き ${counts.ink} 人・まだ ${counts.none} 人` });
      }));
    if (summary.terms.length) {
      node.append(el('h3', { text: '重要用語ごとの人数' }),
        el('div', { class: 'table-scroll' }, el('table', { class: 'summary-table' },
          el('thead', {}, el('tr', {}, ['用語', '疑問に出てきた人数', '分かったことに出てきた人数']
            .map((text) => el('th', { scope: 'col', text })))),
          el('tbody', {}, summary.terms.map((item) => {
            const button = disclosure(item.term, item.term, () => item);
            return el('tr', { onclick: (event) => { if (!button.contains(event.target)) button.click(); } },
              el('th', { scope: 'row' }, button), el('td', { text: `${item.question.length} 人` }), el('td', { text: `${item.learned.length} 人` }));
          })))));
    }
    for (const [field, label] of fields) {
      const words = summary.words[field];
      node.append(el('h3', { text: `よく出てくる言葉（${label}）` }), words.length
        ? el('div', { class: 'summary-words' }, words.map(({ word, students: writers }) =>
          disclosure(`${word}（${writers.length} 人）`, word, () => Object.fromEntries(fields.map(([name]) =>
            [name, students.filter((student) => extractWords(student.record?.[name]).includes(normalizeText(word)))])))))
        : el('p', { text: '（2 人以上が書いた言葉は、ありません）' }));
    }
    node.append(el('h3', { text: '理解度が低い生徒の疑問' }), excerpts(summary.low.items));
    if (summary.low.ink) node.append(el('p', { text: `ほかに、手書きの人が ${summary.low.ink} 人います。` }));
    node.append(details, el('div', { class: 'page-actions' }, copy), copyArea);
  }
  return { node, destroy: () => { alive = false; } };
}
