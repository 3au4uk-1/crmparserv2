export function collectAlbumMessage(
  stateMap,
  message,
  {
    waitMs = 1000,
    now = () => Date.now(),
    schedule = (callback, delay) => setTimeout(callback, delay),
  } = {},
) {
  if (!message?.media_group_id) {
    return Promise.resolve([message]);
  }

  const key = `${message.chat?.id}:${message.media_group_id}`;
  let state = stateMap.get(key);
  if (!state) {
    let resolve;
    const promise = new Promise((done) => {
      resolve = done;
    });
    state = { messages: [], promise, resolve, startedAt: now() };
    stateMap.set(key, state);
    schedule(() => {
      stateMap.delete(key);
      state.resolve([...state.messages]);
    }, waitMs);
  }

  state.messages.push(message);
  return state.promise;
}
