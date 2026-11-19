// YouTube の再生枠。閉じるときは、先に iframe を外して音を止める。
import { el, registerDialog } from '../../ui.js';
import { cleanLinkUrl } from '../../link-logic.js';

export function openVideo({ title, src, pageUrl }) {
  if (typeof src !== 'string' || !src.startsWith('https://www.youtube-nocookie.com/embed/')) return null;
  const cleaned = cleanLinkUrl(src);
  if (!cleaned || !cleaned.startsWith('https://www.youtube-nocookie.com/embed/')) return null;
  const opener = document.activeElement;
  const frame = el('iframe', { src: cleaned, title,
    allow: 'fullscreen; encrypted-media; picture-in-picture', allowfullscreen: true,
    referrerpolicy: 'strict-origin-when-cross-origin', sandbox: 'allow-scripts allow-same-origin allow-presentation' });
  const dlg = el('dialog', { class: 'video-dialog', 'aria-label': title });
  const button = el('button', { type: 'button', class: 'btn', text: 'とじる', onclick: close });
  const page = cleanLinkUrl(pageUrl);
  dlg.append(el('h2', { text: title }), frame,
    el('p', { hidden: !page }, page ? el('a', { href: page, target: '_blank', rel: 'noopener noreferrer',
      text: 'うまく再生できないときは、別のタブで開く' }) : null),
    el('div', { class: 'dialog-actions' }, button));
  let closed = false;
  const unregister = registerDialog(close);
  function close() {
    if (closed) return;
    closed = true;
    unregister();
    frame.remove();
    button.removeEventListener('click', close);
    dlg.removeEventListener('cancel', onCancel);
    dlg.removeEventListener('close', close);
    if (dlg.open) dlg.close();
    dlg.remove();
    if (opener && opener !== document.body && opener.isConnected && typeof opener.focus === 'function') opener.focus();
  }
  function onCancel(event) { event.preventDefault(); close(); }
  dlg.addEventListener('cancel', onCancel);
  dlg.addEventListener('close', close);
  document.body.append(dlg);
  dlg.showModal();
  button.focus();
  return { close };
}
