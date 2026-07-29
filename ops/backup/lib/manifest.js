export function createManifest({ snapshotId, components, versions, createdAt = new Date().toISOString() }) {
  const manifest = {
    snapshotId,
    createdAt,
    retentionDays: 7,
    environment: 'production',
    components,
    versions,
  };
  assertManifest(manifest);
  return manifest;
}

export function assertManifest(m) {
  if (!m || typeof m !== 'object') throw new Error('manifest: not an object');
  for (const k of ['snapshotId', 'createdAt', 'retentionDays', 'environment', 'components', 'versions']) {
    if (m[k] == null) throw new Error(`manifest: missing ${k}`);
  }
  if (m.retentionDays !== 7) throw new Error('manifest: retentionDays must be 7');
  if (m.environment !== 'production') throw new Error('manifest: environment must be production');
  for (const name of ['twentyPg', 'twentyFiles', 'crmparserSqlite']) {
    const c = m.components?.[name];
    if (!c?.key) throw new Error(`manifest: components.${name}.key required`);
    if (!c?.source) throw new Error(`manifest: components.${name}.source required`);
  }
  if (!m.versions?.crmparserImage) throw new Error('manifest: versions.crmparserImage required');
  if (!m.versions?.twentyAppVersion) throw new Error('manifest: versions.twentyAppVersion required');
}
