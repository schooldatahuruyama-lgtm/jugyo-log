// 先生の一覧用。画像を作れなくても、線の保存は止めない。
import { CONFIG } from './config.js';
import { cleanInk, inkBounds } from './ink-logic.js';

export function inkThumb(ink, { document = globalThis.document } = {}) {
  try {
    const value = cleanInk(ink);
    const bounds = inkBounds(value);
    if (!bounds) return null;
    const left = Math.max(0, bounds.x - 12);
    const top = Math.max(0, bounds.y - 12);
    const right = Math.min(CONFIG.ink.width, bounds.x + bounds.w + 12);
    const bottom = Math.min(value.h, bounds.y + bounds.h + 12);
    const width = right - left;
    const height = bottom - top;
    const scale = Math.min(1, 320 / width, 240 / height);
    const canvas = document.createElement('canvas');
    for (const factor of [1, 0.5]) {
      const ratio = scale * factor;
      canvas.width = Math.max(1, Math.min(320 * factor, Math.ceil(width * ratio)));
      canvas.height = Math.max(1, Math.min(240 * factor, Math.ceil(height * ratio)));
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const stroke of value.s) {
        ctx.strokeStyle = CONFIG.ink.colors[stroke.c];
        ctx.lineWidth = Math.max(1, CONFIG.ink.widths[stroke.w] * ratio);
        ctx.beginPath();
        ctx.moveTo((stroke.p[0] - left) * ratio, (stroke.p[1] - top) * ratio);
        for (let i = 2; i < stroke.p.length; i += 2) {
          ctx.lineTo((stroke.p[i] - left) * ratio, (stroke.p[i + 1] - top) * ratio);
        }
        ctx.stroke();
      }
      for (const quality of [0.8, 0.6, 0.4]) {
        const url = canvas.toDataURL('image/jpeg', quality);
        if (url.startsWith('data:image/jpeg;base64,') && url.length <= CONFIG.thumb.maxChars) return url;
      }
    }
    return null;
  } catch {
    return null;
  }
}
