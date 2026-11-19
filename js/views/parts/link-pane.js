// 生徒と先生の記録画面に、安全に開けるリンクだけを出す。
import { el } from '../../ui.js';
import { linkList, linkLabel, linkHost, embedUrl } from '../../link-logic.js';
import { openVideo } from './video-player.js';

export function linkPane({ lesson }) {
  const links = linkList(lesson.links).filter((link) => link.ok);
  const listeners = [];
  let video = null;
  const node = links.length ? el('div', { class: 'link-pane' }, el('h3', { text: '動画・サイト' }),
    el('ul', { class: 'link-rows' }, links.map((link) => {
      const label = linkLabel(link);
      const open = link.video ? el('button', { type: 'button', class: 'btn link-open', text: `▶ ${label}` })
        : el('a', { class: 'btn link-open', text: `↗ ${label}`, href: link.url, target: '_blank', rel: 'noopener noreferrer' });
      if (link.video) {
        const click = () => {
          video?.close();
          video = openVideo({ title: label, src: embedUrl(link.url), pageUrl: link.url });
        };
        open.addEventListener('click', click);
        listeners.push(() => open.removeEventListener('click', click));
      }
      return el('li', { class: 'link-row' }, open,
        el('span', { class: 'small', text: link.video ? '動画（この画面で再生）' : `サイト（別のタブで開く）・${linkHost(link.url)}` }));
    }))) : el('div', { hidden: true });
  return { node, destroy() { video?.close(); listeners.forEach((off) => off()); } };
}
