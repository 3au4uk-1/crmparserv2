let parsingInProgress = false;

export function isParsingInProgress() {
  return parsingInProgress;
}

export function tryAcquireParsingLock() {
  if (parsingInProgress) return false;
  parsingInProgress = true;
  return true;
}

export function releaseParsingLock() {
  parsingInProgress = false;
}
