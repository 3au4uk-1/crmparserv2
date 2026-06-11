export function loadCompanyCodes(db) {
  return db.prepare('SELECT code FROM companies ORDER BY code').all().map((r) => r.code);
}
