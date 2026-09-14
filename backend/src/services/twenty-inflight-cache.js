export function createInFlightCache() {
  const map = new Map();
  return {
    getOrStart(key, fn) {
      if (!map.has(key)) {
        map.set(key, Promise.resolve().then(fn));
      }
      return map.get(key);
    },
  };
}
