// 写真・PDF の倍率と、指の動きに合わせるスクロールの計算。
export function touchScroll(before, after) {
  const points = [before?.[0], before?.[1], after?.[0], after?.[1]];
  if (!points.every((point) => Number.isFinite(point?.clientX) && Number.isFinite(point?.clientY))) return 0;
  const delta = before[0].clientY / 2 + before[1].clientY / 2 - after[0].clientY / 2 - after[1].clientY / 2;
  return Number.isFinite(delta) ? delta : 0;
}

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
