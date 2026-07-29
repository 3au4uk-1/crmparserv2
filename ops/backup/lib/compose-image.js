/**
 * Replace crmparser service image line in a Dokploy docker-compose file.
 * @param {string} composeFile
 * @param {string} imageRef
 */
export function replaceCrmparserImageInCompose(composeFile, imageRef) {
  const re = /(^\s*image:\s*)ghcr\.io\/3au4uk-1\/crmparserv2[^\s]*\s*$/m;
  if (!re.test(composeFile)) {
    throw new Error('crmparser image line not found in compose file');
  }
  return composeFile.replace(re, `$1${imageRef}`);
}
