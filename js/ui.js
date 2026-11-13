// 画面の部品。入力された文字は必ず textContent で出す（innerHTML は使わない）
// スライドアプリの js/ui.js から、el・confirmDialog・closeAllDialogs・toast・statusChip を写した。
// 画面が切りかわったときに closeAllDialogs を呼ぶのは js/main.js が行う。

// el('div', { class: 'card', text: '本文', onclick: fn }, 子...)
// props.text は textContent に入れる。on で始まる関数はイベントの待ち受け。
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, val] of Object.entries(props || {})) {
    if (val === undefined || val === null || val === false) continue;
    if (key === 'innerHTML' || key === 'html') throw new Error('innerHTML は使えません');
    if (key === 'text') node.textContent = String(val);
    else if (key === 'class') node.className = String(val);
    else if (key === 'dataset') Object.assign(node.dataset, val);
    else if (key.startsWith('on') && typeof val === 'function') node.addEventListener(key.slice(2).toLowerCase(), val);
    else if (['value', 'checked', 'disabled', 'selected'].includes(key)) node[key] = val;
    else node.setAttribute(key, val === true ? '' : String(val));
  }
  const add = (c) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return node;
}

// 開いている確認ダイアログ（画面が切りかわったら、取り消しとして片づける）
const openDialogs = new Set();

// 確認ダイアログ。OK なら true、取り消し・Esc・外側のタップ・画面の切りかえなら false。
// 結果はボタンを押した時点で返す（<dialog> の close イベントが届くのを待たない）。完了は 1 回だけ。
// cancelLabel: 取り消しのボタンの文。signal（AbortSignal）: 中止されたら取り消し（false）として閉じる
export function confirmDialog({ title, body, okLabel = 'OK', cancelLabel = 'やめる', danger = false, signal = null }) {
  return new Promise((resolve) => {
    if (signal && signal.aborted) { resolve(false); return; }
    const opener = document.activeElement; // 閉じたらフォーカスを戻す先
    const dlg = el('dialog', { class: 'confirm', 'aria-labelledby': 'confirm-title' });
    let done = false;

    const finish = (value) => {
      if (done) return;
      done = true;
      openDialogs.delete(entry);
      dlg.removeEventListener('close', onClose);
      dlg.removeEventListener('cancel', onCancel);
      dlg.removeEventListener('click', onBackdrop);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve(value);
      if (dlg.open) dlg.close();
      dlg.remove();
      // 開いた部品がまだ画面にあれば、そこへフォーカスを戻す
      if (opener && opener !== document.body && opener.isConnected && typeof opener.focus === 'function') {
        opener.focus();
      }
    };
    // Esc（ブラウザの cancel イベント）
    const onCancel = (ev) => { ev.preventDefault(); finish(false); };
    // ほかの理由で閉じられたときも、取り消しとして終える
    const onClose = () => finish(false);
    // 呼んだ側が中止した（対象が消えた・画面が替わったなど）
    const onAbort = () => finish(false);
    // 外側（背景）のタップ: ダイアログの枠の外を押したとき
    const onBackdrop = (ev) => {
      if (ev.target !== dlg) return;
      const r = dlg.getBoundingClientRect();
      const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      if (!inside) finish(false);
    };

    const ok = el('button', { type: 'button', class: danger ? 'btn btn-danger' : 'btn btn-primary', text: okLabel, onclick: () => finish(true) });
    const cancel = el('button', { type: 'button', class: 'btn', text: cancelLabel, onclick: () => finish(false) });
    dlg.append(
      el('h2', { id: 'confirm-title', text: title }),
      el('p', { text: body }),
      el('div', { class: 'dialog-actions' }, cancel, ok),
    );
    const entry = { finish };
    openDialogs.add(entry);
    dlg.addEventListener('close', onClose);
    dlg.addEventListener('cancel', onCancel);
    dlg.addEventListener('click', onBackdrop);
    if (signal) signal.addEventListener('abort', onAbort);
    document.body.append(dlg);
    dlg.showModal();
    cancel.focus(); // 間違って押しても実行されない側に置く
  });
}

// 開いている確認ダイアログを、すべて取り消し（false）として閉じる
export function closeAllDialogs() {
  for (const entry of [...openDialogs]) entry.finish(false);
}

const CHIP_ICONS = { ok: '✓', warn: '!', danger: '■', info: 'i' };

// 状態のチップ（アイコンと文字。色だけで伝えない）
export function statusChip(kind, label) {
  const k = CHIP_ICONS[kind] ? kind : 'info';
  return el('span', { class: `chip chip-${k}` },
    el('span', { class: 'chip-icon', 'aria-hidden': 'true', text: CHIP_ICONS[k] }),
    el('span', { text: label }));
}

// 短い通知（数秒で消える）
export function toast(message) {
  const host = document.getElementById('toasts') || document.body;
  const t = el('div', { class: 'toast', role: 'status', text: message });
  host.append(t);
  setTimeout(() => t.remove(), 4000);
}
