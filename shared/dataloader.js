export function createLoader(batchFn) {
  let queue = [];
  let scheduled = false;

  function load(key) {
    return new Promise((resolve, reject) => {
      queue.push({ key, resolve, reject });
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(flush);
      }
    });
  }

  function flush() {
    const batch = queue;
    queue = [];
    scheduled = false;
    Promise.resolve(batchFn(batch.map((item) => item.key)))
      .then((results) => {
        if (!Array.isArray(results) || results.length !== batch.length) {
          throw new Error('DataLoader: размер ответа не совпал с пакетом ключей');
        }
        batch.forEach((item, index) => {
          const value = results[index];
          if (value instanceof Error) item.reject(value);
          else item.resolve(value);
        });
      })
      .catch((error) => {
        batch.forEach((item) => item.reject(error));
      });
  }

  return { load };
}
