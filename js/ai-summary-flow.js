// AI の生成は、通信が失敗しても送り直さない。
import { cleanAiSummary } from './ai-summary-logic.js';
import { NetError } from './errors.js';

export async function requestAiSummary({ gas, request }) {
  const result = await gas.call('summarize', request, { maxTries: 1, timeoutMs: 120000 });
  const labels = Object.fromEntries(request.entries.map(({ no }) => [no, true]));
  const summary = cleanAiSummary(result?.summary, labels);
  if (!summary || typeof result.model !== 'string' || !result.model.trim()) throw new NetError('ai-failed');
  return { summary, model: result.model.trim() };
}
