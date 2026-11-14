// 同じ授業の書きこみを、成功・失敗にかかわらず呼ばれた順に行う。
export function createRecordQueue() {
  const pending = new Map();

  return {
    run(key, fn) {
      if (typeof key !== 'string') return Promise.reject(new TypeError('key は文字列にしてください'));
      if (typeof fn !== 'function') return Promise.reject(new TypeError('fn は関数にしてください'));
      const previous = pending.get(key) || Promise.resolve();
      const result = previous.then(() => fn());
      const clear = () => {
        // 後から追加された処理が残っていれば、その列は消さない。
        if (pending.get(key) === tail) pending.delete(key);
      };
      const tail = result.then(clear, clear);
      pending.set(key, tail);
      return result;
    },
  };
}
