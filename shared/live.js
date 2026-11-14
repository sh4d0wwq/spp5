export function pollIterable(pull, intervalMs = 1000) {
  let timer;
  let stopped = false;
  const queue = [];
  let wake = () => {};
  const pump = () => {
    if (stopped) return;
    try {
      const items = pull() || [];
      if (items.length) {
        queue.push(...items);
        wake();
      }
    } catch {
      /* следующий тик попробует снова: подписка не должна падать из-за временной ошибки чтения */
    }
  };
  timer = setInterval(pump, intervalMs);
  pump();
  return {
    async next() {
      while (!queue.length && !stopped) {
        await new Promise((resolve) => { wake = resolve; });
      }
      if (!queue.length && stopped) return { done: true, value: undefined };
      return { done: false, value: queue.shift() };
    },
    async return() {
      stopped = true;
      clearInterval(timer);
      wake();
      return { done: true, value: undefined };
    },
    [Symbol.asyncIterator]() { return this; },
  };
}
