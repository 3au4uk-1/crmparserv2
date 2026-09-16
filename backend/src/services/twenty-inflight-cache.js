export function createInFlightCache() {
  const map = new Map();
  return {
    getOrStart(key, fn) {
      if (!map.has(key)) {
        const promise = Promise.resolve().then(fn);
        map.set(key, promise);
        promise.catch(() => {
          if (map.get(key) === promise) map.delete(key);
        });
      }
      return map.get(key);
    },
  };
}
