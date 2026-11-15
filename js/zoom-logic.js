// 写真・PDF の倍率と、指の下の位置を保つスクロールの計算。
export function clampZoom(value, current = 1) {
  const fallback = typeof current === 'number' && !Number.isNaN(current) ? current : 1;
  return Math.max(1, Math.min(4, typeof value === 'number' && !Number.isNaN(value) ? value : fallback));
}

export function pinchZoom(current, before, after) {
  if (!Number.isFinite(before) || before <= 0 || !Number.isFinite(after) || after <= 0) return clampZoom(current);
  return clampZoom(clampZoom(current) * after / before, current);
}

export function nextZoom(current, delta) {
  return clampZoom(clampZoom(current) + delta, current);
}

export function zoomScroll({ scroll, from, to = from, before, after }) {
  if (![before.width, before.height, after.width, after.height].every((size) => Number.isFinite(size) && size > 0)) return scroll;
  const left = scroll.left + after.left + (from.x - before.left) * after.width / before.width - to.x;
  const top = scroll.top + after.top + (from.y - before.top) * after.height / before.height - to.y;
  return { left: Number.isFinite(left) ? Math.max(0, left) : scroll.left,
    top: Number.isFinite(top) ? Math.max(0, top) : scroll.top };
}
