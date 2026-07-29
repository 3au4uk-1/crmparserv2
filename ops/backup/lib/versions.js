/**
 * Fail-fast gate for capture.mjs — validates version env before backup triggers.
 * @param {NodeJS.ProcessEnv} env
 * @param {{ skipVersions?: boolean }} opts
 */
export function validateCaptureVersions(env, { skipVersions = false } = {}) {
  return resolveVersions(env, { skipVersions });
}

/**
 * Resolve manifest version fields from environment.
 * @param {NodeJS.ProcessEnv} env
 * @param {{ skipVersions?: boolean }} opts
 */
export function resolveVersions(env, { skipVersions = false } = {}) {
  const twentyAppVersion = env.TWENTY_APP_VERSION?.trim();
  if (!twentyAppVersion) {
    if (skipVersions) {
      return buildVersionPayload('unknown', env);
    }
    throw new Error('TWENTY_APP_VERSION required');
  }

  const crmparserImage = env.CRMPARSER_IMAGE?.trim();
  if (!crmparserImage) {
    if (skipVersions) {
      return { crmparserImage: 'unknown', twentyAppVersion };
    }
    throw new Error('CRMPARSER_IMAGE required (set env or pass --skip-versions for dry runs)');
  }

  return buildVersionPayload(crmparserImage, env, twentyAppVersion);
}

function buildVersionPayload(crmparserImage, env, twentyAppVersion = 'unknown') {
  const versions = { crmparserImage, twentyAppVersion };
  const digest = env.CRMPARSER_DIGEST?.trim();
  if (digest) versions.crmparserDigest = digest;
  return versions;
}
