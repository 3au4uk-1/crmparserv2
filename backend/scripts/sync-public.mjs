import { cpSync, existsSync, rmSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const backendRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(backendRoot, '..', 'frontend', 'dist');
const dest = path.join(backendRoot, 'public');

if (!existsSync(src)) {
  console.error('frontend/dist not found. Run: npm run build --prefix ../frontend');
  process.exit(1);
}

if (existsSync(dest)) {
  rmSync(dest, { recursive: true });
}
cpSync(src, dest, { recursive: true });
console.log('Synced frontend/dist -> backend/public');
