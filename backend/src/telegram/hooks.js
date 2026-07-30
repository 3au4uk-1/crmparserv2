const hooksByEvent = new Map();

export function registerHook(event, handler) {
  if (typeof event !== 'string' || !event.trim()) {
    throw new Error('registerHook: event required');
  }
  if (typeof handler !== 'function') {
    throw new Error('registerHook: handler must be a function');
  }
  const list = hooksByEvent.get(event) ?? [];
  list.push(handler);
  hooksByEvent.set(event, list);
}

export function listHooks(event) {
  return [...(hooksByEvent.get(event) ?? [])];
}

export function clearHooksForTests() {
  hooksByEvent.clear();
}
