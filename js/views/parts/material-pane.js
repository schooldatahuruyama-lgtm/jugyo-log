// 先生の資料の一覧。生徒と先生が同じ表示を使い、閉じると画像とビューアーを片付ける。
import { el } from '../../ui.js';
import { materialList } from '../../lesson-logic.js';
import { openViewer } from './viewer.js';

export function materialPane({ ctx, classId, lessonId, lesson }) {
  let alive = true;
  let viewer = null;
  const materialViews = new Map();
  const materialsArea = el('div');

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

  showMaterials(lesson);
  return {
    node: materialsArea,
    destroy() {
      alive = false;
      viewer?.close();
      viewer = null;
      for (const item of materialViews.values()) clearImage(item);
      materialViews.clear();
    },
  };
}
