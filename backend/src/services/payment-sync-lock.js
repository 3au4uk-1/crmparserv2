let paymentSyncInProgress = false;

export function isPaymentSyncInProgress() {
  return paymentSyncInProgress;
}

export function tryAcquirePaymentSyncLock() {
  if (paymentSyncInProgress) return false;
  paymentSyncInProgress = true;
  return true;
}

export function releasePaymentSyncLock() {
  paymentSyncInProgress = false;
}
