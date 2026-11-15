// 手書きの形と線の計算。通信や画面の操作はしない。
import { CONFIG } from './config.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (n, max) => Math.max(0, Math.min(max, n));

export function inkPlaceKind(name) {
  if (typeof name !== 'string' || !name) return null;
  if (CONFIG.inkFields.includes(name)) return 'field';
  if (CONFIG.attachmentSlots.includes(name)) return 'attachment';
  // 資料を足す画面の newId と同じ、12 文字の英数字。
  return name.length === CONFIG.idLength && /^[A-Za-z0-9]+$/.test(name) ? 'material' : null;
}

export function pictureIndex(record, place, fileId) {
  const index = record?.ink?.[place];
  return index && index.on === fileId ? index : null;
}

function pictureHeight(height) {
  return Math.max(CONFIG.ink.pictureMinHeight, Math.min(CONFIG.ink.pageHeight * CONFIG.ink.maxPages, Math.round(height)));
}

export function emptyPictureInk(naturalWidth, naturalHeight) {
  let h = 600;
  if (isNum(naturalWidth) && naturalWidth > 0 && isNum(naturalHeight) && naturalHeight > 0) {
    const height = CONFIG.ink.width * naturalHeight / naturalWidth;
    h = pictureHeight(isNum(height) ? height : CONFIG.ink.width * (naturalHeight / naturalWidth));
  }
  return { v: 1, k: 'pic', h, s: [] };
}

export function serverInkTime(record, field) {
  const updated = record?.ink?.[field]?.updatedAt;
  const cleared = record?.inkCleared?.[field];
  return Math.max(isNum(updated) ? updated : 0, isNum(cleared) ? cleared : 0);
}

export function emptyInk() {
  return { v: 1, h: CONFIG.ink.pageHeight, s: [] };
}

export function round1(n) {
  return Math.round(n * 10) / 10;
}

export function cleanStroke(value, height) {
  if (!isObj(value)) return null;
  const { c, w, p } = value;
  if (!Number.isInteger(c) || c < 0 || c >= CONFIG.ink.colors.length
    || !Number.isInteger(w) || w < 0 || w >= CONFIG.ink.widths.length
    || !Array.isArray(p) || p.length < 4 || p.length % 2 !== 0
    || p.length > CONFIG.ink.maxPoints * 2) return null;
  const points = [];
  for (let i = 0; i < p.length; i += 1) {
    if (!isNum(p[i])) return null;
    points.push(round1(clamp(p[i], i % 2 === 0 ? CONFIG.ink.width : height)));
  }
  return { c, w, p: points };
}

export function cleanInk(value) {
  if (!isObj(value) || value.v !== 1) return emptyInk();
  const { pageHeight, maxPages, maxStrokes } = CONFIG.ink;
  const picture = value.k === 'pic';
  const h = picture ? pictureHeight(isNum(value.h) ? value.h : 600) : isNum(value.h)
    ? Math.max(pageHeight, Math.min(pageHeight * maxPages, Math.ceil(value.h / pageHeight) * pageHeight))
    : pageHeight;
  const s = [];
  for (const stroke of Array.isArray(value.s) ? value.s : []) {
    const cleaned = cleanStroke(stroke, h);
    if (cleaned) s.push(cleaned);
    if (s.length === maxStrokes) break;
  }
  return picture ? { v: 1, k: 'pic', h, s } : { v: 1, h, s };
}

export function parseInk(text) {
  try {
    const value = JSON.parse(text);
    return isObj(value) && value.v === 1 ? cleanInk(value) : null;
  } catch {
    return null;
  }
}

export function serializeInk(ink) {
  return JSON.stringify(cleanInk(ink));
}

export function inkBytes(ink) {
  return serializeInk(ink).length;
}

export function isEmptyInk(ink) {
  return ink.s.length === 0;
}

// 線分への距離の二乗。両端が同じなら、その点への距離を使う。
function segmentDistanceSq(x, y, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : clamp(((x - x0) * dx + (y - y0) * dy) / lengthSq, 1);
  return (x - (x0 + t * dx)) ** 2 + (y - (y0 + t * dy)) ** 2;
}

export function simplify(points, tolerance) {
  const unique = [];
  for (let i = 0; i < points.length; i += 2) {
    if (unique.length === 0 || points[i] !== unique[unique.length - 2] || points[i + 1] !== unique[unique.length - 1]) {
      unique.push(points[i], points[i + 1]);
    }
  }
  const count = unique.length / 2;
  if (count <= 2) return unique;
  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[count - 1] = 1;
  const stack = [[0, count - 1]];
  const toleranceSq = tolerance * tolerance;
  while (stack.length) {
    const [first, last] = stack.pop();
    let farthest = -1;
    let maxDistanceSq = toleranceSq;
    for (let i = first + 1; i < last; i += 1) {
      const distanceSq = segmentDistanceSq(unique[i * 2], unique[i * 2 + 1],
        unique[first * 2], unique[first * 2 + 1], unique[last * 2], unique[last * 2 + 1]);
      if (distanceSq > maxDistanceSq) {
        farthest = i;
        maxDistanceSq = distanceSq;
      }
    }
    if (farthest !== -1) {
      keep[farthest] = 1;
      if (farthest - first > 1) stack.push([first, farthest]);
      if (last - farthest > 1) stack.push([farthest, last]);
    }
  }
  const out = [];
  for (let i = 0; i < count; i += 1) {
    if (keep[i]) out.push(unique[i * 2], unique[i * 2 + 1]);
  }
  return out;
}

export function makeStroke({ points, color, width, ruler }, height) {
  if (!Array.isArray(points) || points.length === 0 || points.length % 2 !== 0) return null;
  for (const n of points) if (!isNum(n)) return null;
  let p = ruler
    ? snapLine(points[0], points[1], points[points.length - 2], points[points.length - 1])
    : simplify(points, CONFIG.ink.simplifyTolerance);
  if (p.length === 2 || (p.length === 4 && p[0] === p[2] && p[1] === p[3])) {
    // 紙の右端では内側にずらし、軽く触れた点も長さのある線にする。
    const x = round1(clamp(p[0], CONFIG.ink.width));
    const y = round1(clamp(p[1], height));
    p = [x, y, x + (x === CONFIG.ink.width ? -0.1 : 0.1), y];
  }
  const count = p.length / 2;
  if (count > CONFIG.ink.maxPoints) {
    const sampled = [];
    for (let i = 0; i < CONFIG.ink.maxPoints; i += 1) {
      const index = Math.round(i * (count - 1) / (CONFIG.ink.maxPoints - 1));
      sampled.push(p[index * 2], p[index * 2 + 1]);
    }
    p = sampled;
  }
  return cleanStroke({ c: color, w: width, p }, height);
}

export function snapLine(x0, y0, x1, y1) {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  if (dy < dx * CONFIG.ink.snapRatio) y1 = y0;
  else if (dx < dy * CONFIG.ink.snapRatio) x1 = x0;
  return [x0, y0, x1, y1];
}

export function hitStroke(stroke, x, y, radius) {
  const reach = radius + CONFIG.ink.widths[stroke.w] / 2;
  const { p } = stroke;
  for (let i = 2; i < p.length; i += 2) {
    if (segmentDistanceSq(x, y, p[i - 2], p[i - 1], p[i], p[i + 1]) <= reach * reach) return true;
  }
  return false;
}

export function eraseAt(ink, x, y) {
  const s = ink.s.filter((stroke) => !hitStroke(stroke, x, y, CONFIG.ink.eraserRadius));
  return s.length === ink.s.length ? ink : { ...ink, s };
}

export function addStroke(ink, stroke) {
  if (ink.s.length >= CONFIG.ink.maxStrokes) return { ink, error: 'too-many' };
  const next = { ...ink, s: [...ink.s, stroke] };
  if (inkBytes(next) > CONFIG.ink.maxBytes) return { ink, error: 'too-big' };
  return { ink: next, error: null };
}

export function addPage(ink) {
  if (!canAddPage(ink)) return { ink, error: 'too-long' };
  return { ink: { ...ink, h: ink.h + CONFIG.ink.pageHeight }, error: null };
}

export function canAddPage(ink) {
  return ink.k !== 'pic' && ink.h < CONFIG.ink.pageHeight * CONFIG.ink.maxPages;
}

export function strokePath(stroke) {
  const parts = [];
  for (let i = 0; i < stroke.p.length; i += 2) {
    parts.push(`${i === 0 ? 'M' : 'L'} ${round1(stroke.p[i]).toFixed(1)} ${round1(stroke.p[i + 1]).toFixed(1)}`);
  }
  return parts.join(' ');
}

export function inkBounds(ink) {
  if (isEmptyInk(ink)) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const stroke of ink.s) {
    const half = CONFIG.ink.widths[stroke.w] / 2;
    for (let i = 0; i < stroke.p.length; i += 2) {
      minX = Math.min(minX, stroke.p[i] - half);
      minY = Math.min(minY, stroke.p[i + 1] - half);
      maxX = Math.max(maxX, stroke.p[i] + half);
      maxY = Math.max(maxY, stroke.p[i + 1] + half);
    }
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function createHistory(max) {
  const stack = [];
  return {
    push(ink) {
      stack.push(ink);
      if (stack.length > max) stack.shift();
    },
    undo(current) {
      return stack.pop() ?? null;
    },
    canUndo() {
      return stack.length > 0;
    },
  };
}
