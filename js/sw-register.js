export function shouldRegister({ hostname, search, hasWorker }) {
  if (!hasWorker) return false;
  if (['localhost', '127.0.0.1', '[::1]'].includes(hostname)) {
    return new URLSearchParams(search || '').getAll('sw').includes('1');
  }
  return true;
}

export function workerUrl(version) {
  return `sw.js?v=${encodeURIComponent(version)}`;
}
