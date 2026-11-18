// AI に渡す文字と、返ってきたまとめを整える。通信・DOM は使わない。
import { lessonTerms } from './term-logic.js';
import { isStudentId } from './ids.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const listOf = (v) => (Array.isArray(v) ? v : []);
const textOf = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max).trim() : '');
const numberRe = /^([1-9][0-9]?番|名簿外[1-9][0-9]?)$/;
const validNumber = (v) => typeof v === 'string' && v.match(numberRe)?.[0] === v;

export function maskText(text) {
  if (typeof text !== 'string') return '';
  // 判定用だけ全角英数字・記号を半角にし、伏せない部分は元の文字を残す。
  const normalized = text.replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
  const pattern = /([a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+)|(s[0-9]{2}-[0-9]{3})|([0-9](?:[-\s]*[0-9]){9,})/gi;
  let result = '';
  let end = 0;
  for (const match of normalized.matchAll(pattern)) {
    result += text.slice(end, match.index) + (match[1] ? '（メール）' : match[2] ? '（ID）' : '（番号）');
    end = match.index + match[0].length;
  }
  return result + text.slice(end);
}

export function buildSummaryRequest(input) {
  const { lesson, students, records } = isObj(input) ? input : {};
  const title = textOf(lesson?.title, 60);
  if (!title) return null;
  const entries = [];
  const labels = {};
  const seen = new Set();
  let outside = 0;
  let latest = 0;
  let truncated = false;
  for (const student of listOf(students)) {
    if (!isObj(student) || typeof student.studentId !== 'string' || !student.studentId || seen.has(student.studentId)) continue;
    seen.add(student.studentId);
    const no = student.inRoster === false ? `名簿外${++outside}` : `${student.number}番`;
    const record = isObj(records) && Object.hasOwn(records, student.studentId) ? records[student.studentId] : null;
    if (!validNumber(no) || Object.hasOwn(labels, no) || !isObj(record)) continue;
    const level = record.level == null ? 0 : record.level;
    if (!Number.isInteger(level) || level < 0 || level > 4) continue;
    if (['learned', 'question', 'memo'].some((field) => record[field] !== undefined && typeof record[field] !== 'string')) continue;
    const learned = textOf(maskText(record.learned), 2000);
    const question = textOf(maskText(record.question), 2000);
    const memo = textOf(maskText(record.memo), 2000);
    if (!learned && !question && !memo) continue;
    if (entries.length === 60) { truncated = true; continue; }
    entries.push({ no, level, learned, question, memo });
    labels[no] = student.studentId;
    if (Number.isFinite(record.updatedAt)) latest = Math.max(latest, record.updatedAt);
  }
  if (!entries.length) return null;
  return {
    request: { title, terms: lessonTerms(lesson).map(({ text }) => text.slice(0, 20)).slice(0, 40), board: '', entries },
    labels, count: entries.length, latest, ...(truncated ? { truncated: true } : {}),
  };
}

export function cleanAiSummary(value, labels) {
  if (!isObj(value)) return null;
  const overview = textOf(value.overview, 600);
  if (!overview || ['questionGroups', 'misconceptions', 'nextLesson', 'followUp']
    .some((field) => value[field] != null && !Array.isArray(value[field]))) return null;
  const numberOf = (v) => {
    const number = typeof v === 'string' ? v.trim() : '';
    return validNumber(number) && (labels === undefined || (isObj(labels) && Object.hasOwn(labels, number))) ? number : '';
  };
  const questionGroups = listOf(value.questionGroups).filter(isObj).map((item) => ({
    topic: textOf(item.topic, 200),
    numbers: [...new Set(listOf(item.numbers).map(numberOf).filter(Boolean))],
    example: textOf(item.example, 300),
  })).filter((item) => item.topic && item.numbers.length && item.example).slice(0, 6);
  const misconceptions = listOf(value.misconceptions).filter(isObj).map((item) => ({
    number: numberOf(item.number), quote: textOf(item.quote, 300), note: textOf(item.note, 200),
  })).filter((item) => item.number && item.quote && item.note).slice(0, 8);
  const nextLesson = listOf(value.nextLesson).map((text) => textOf(text, 200)).filter(Boolean).slice(0, 3);
  const followUp = listOf(value.followUp).filter(isObj).map((item) => ({
    number: numberOf(item.number), reason: textOf(item.reason, 200),
  })).filter((item) => item.number && item.reason).slice(0, 8);
  const savedLabels = labels === undefined && Object.hasOwn(value, 'labels')
    ? { labels: Object.fromEntries((isObj(value.labels) ? Object.entries(value.labels) : [])
      .filter(([number, studentId]) => validNumber(number) && isStudentId(studentId))) } : {};
  return { overview, questionGroups, misconceptions, nextLesson, followUp, ...savedLabels };
}

export function isSummaryStale(saved, { count, latest }) {
  return saved?.basedOn?.count !== count || saved?.basedOn?.latest !== latest;
}

export function aiSummaryText(summary) {
  return aiSummarySections(summary).map(({ title, items }) => [title, ...(items.length
    ? items.map((parts) => parts.map((part) => typeof part === 'string' ? part : aiSummaryLabel(part.number)).join(''))
    : ['（ありません）'])].join('\n')).join('\n\n');
}

export function aiSummaryLabel(number) {
  return number.replace(/^([0-9]+)番$/, '$1 番');
}

export function aiSummaryStudent(number, students, labels = null) {
  if (!validNumber(number) || !isObj(labels) || !Object.hasOwn(labels, number) || !isStudentId(labels[number])) return null;
  const people = listOf(students).filter(isObj);
  return people.find((person) => person.studentId === labels[number])?.studentId || null;
}

// 呼び名の部分だけボタンにできるよう、文章を部品に分ける。
export function aiSummarySections(summary) {
  const value = cleanAiSummary(summary);
  if (!value) return [];
  return [
    { title: 'クラス全体の様子', items: [[value.overview]] },
    { title: '疑問のまとまり', items: value.questionGroups.map((item) => [
      `（${item.topic}）（${item.numbers.length} 人: `,
      ...item.numbers.flatMap((number, i) => [...(i ? ['・'] : []), { number }]), `）\n${item.example}`,
    ]) },
    { title: 'まちがって覚えていそうな所', items: value.misconceptions.map((item) => [
      '（', { number: item.number }, `）『${item.quote}』— ${item.note}`,
    ]) },
    { title: '次の授業で取り上げるとよいこと', items: value.nextLesson.map((text) => [text]), bullets: true },
    { title: '声をかけたい生徒', items: value.followUp.map((item) => ['（', { number: item.number }, `）${item.reason}`]) },
  ];
}

export function aiSummaryDate(saved) {
  if (!Number.isFinite(saved?.createdAt)) return '';
  const date = new Date(saved.createdAt);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())} に作成・${saved.basedOn?.count} 人分の記録から`;
}

export function aiSummaryError(code) {
  const messages = {
    'ai-config': 'AI の設定がまだです。手順書（docs/setup/ai-summary.md）のとおりに、保存の仕組みに鍵とモデルの名前を入れてください。',
    'ai-key': 'AI の鍵が正しくないか、使えなくなっています。',
    'ai-busy': 'AI が混んでいるか、使える量をこえています。少し待ってから、もう一度押してください。',
    'ai-failed': 'AI のまとめを作れませんでした。もう一度押してください。',
    bad: '保存の仕組みが古い版のようです。手順書のとおりに、保存の仕組みを貼り直してください。',
    toobig: '記録が多すぎて、送れませんでした。',
    denied: '先生としてログインし直してください。',
    auth: '先生としてログインし直してください。',
  };
  return Object.hasOwn(messages, code) ? messages[code]
    : '通信できませんでした。電波を確かめて、もう一度押してください。';
}
