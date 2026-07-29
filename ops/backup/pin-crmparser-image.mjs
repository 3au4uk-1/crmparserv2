#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createDokployClient } from './lib/dokploy-client.js';
import { replaceCrmparserImageInCompose } from './lib/compose-image.js';
import { resolveCrmparserImageRef } from './lib/versions.js';
import { assertManifest } from './lib/manifest.js';

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error('Usage: node pin-crmparser-image.mjs <manifest.json>');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
assertManifest(manifest);
const imageRef = resolveCrmparserImageRef(manifest.versions);

const composeId = process.env.DOKPLOY_CRMPARSER_COMPOSE_ID?.trim() || 'JWIhULvt6slzDxT8AQXyWz';
const client = createDokployClient({
  baseUrl: process.env.DOKPLOY_URL,
  apiKey: process.env.DOKPLOY_API_KEY,
});

const compose = await client.composeOne(composeId);
if (!compose?.composeFile) {
  throw new Error(`compose.one returned no composeFile for ${composeId}`);
}

const updatedFile = replaceCrmparserImageInCompose(compose.composeFile, imageRef);
await client.composeUpdate({ ...compose, composeId, composeFile: updatedFile });
await client.composeDeploy(
  composeId,
  `Rollback crmparser ${manifest.snapshotId}`,
  `Pinned image ${imageRef} from snapshot manifest`,
);

console.log(JSON.stringify({ composeId, imageRef, snapshotId: manifest.snapshotId }));
