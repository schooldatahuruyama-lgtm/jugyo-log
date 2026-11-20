// 理科クエストの単元を足した・変えたときは、ここも直す。
export const RIKA_UNITS = Object.freeze([
  { id: 'basics', title: '観察と実験の基本', grade: 1 },
  { id: 'light', title: '光の世界', grade: 1 },
  { id: 'sound', title: '音の世界', grade: 1 },
  { id: 'force', title: '力のはたらき', grade: 1 },
  { id: 'substance', title: '身のまわりの物質', grade: 1 },
  { id: 'solution', title: '水溶液', grade: 1 },
  { id: 'state-change', title: '状態変化', grade: 1 },
  { id: 'plants', title: '植物のなかま', grade: 1 },
  { id: 'animals', title: '動物のなかま', grade: 1 },
  { id: 'volcano', title: '火山と地震', grade: 1 },
  { id: 'strata', title: '地層と大地の変化', grade: 1 },
  { id: 'chemical-change', title: '化学変化と原子・分子', grade: 2 },
  { id: 'body', title: '生物のからだのつくりとはたらき', grade: 2 },
  { id: 'electricity', title: '電流とその利用', grade: 2 },
  { id: 'weather', title: '天気とその変化', grade: 2 },
  { id: 'motion', title: '運動とエネルギー', grade: 3 },
  { id: 'ion', title: '化学変化とイオン', grade: 3 },
  { id: 'heredity', title: '生命の連続性', grade: 3 },
  { id: 'space', title: '地球と宇宙', grade: 3 },
  { id: 'nature', title: '自然と人間', grade: 3 },
].map((unit) => Object.freeze(unit)));

export function rikaUnit(id) {
  return typeof id === 'string' ? RIKA_UNITS.find((unit) => unit.id === id) ?? null : null;
}

export function rikaUnitLabel(id) {
  const unit = rikaUnit(id);
  return unit ? `${unit.grade}年 ${unit.title}` : null;
}

export function cleanClassUnit(value) {
  return typeof value === 'string' && /^[a-z0-9-]{1,40}$/.test(value) && value.trim() === value ? value : null;
}
