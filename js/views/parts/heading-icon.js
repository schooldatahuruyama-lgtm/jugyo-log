// 見出しの飾り。内容は隣の文字で伝える。
import { el } from '../../ui.js';

export function headingIcon(kind) {
  const icon = el('span', { 'aria-hidden': 'true' });
  let shapes;
  if (kind === 'teacher') {
    shapes = [['rect', { x: 3, y: 4, width: 18, height: 12, rx: 1.5 }],
      ['path', { d: 'M8 20h8M12 16v4M7 9h6M7 12h3' }]];
  } else if (kind === 'mine') {
    shapes = [['path', { d: 'M4 20l1-4L16 5l3 3L8 19l-4 1z' }], ['path', { d: 'M14 7l3 3' }]];
  } else if (kind === 'reflect') {
    shapes = [['path', { d: 'M4 5h16v11H10l-4 4v-4H4z' }], ['path', { d: 'M8 9h8M8 12h5' }]];
  } else return icon;

  icon.className = `lesson-section-icon lesson-section-icon-${kind}`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  for (const [tag, attributes] of shapes) {
    const shape = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, String(value));
    svg.append(shape);
  }
  icon.append(svg);
  return icon;
}
