import fs from 'fs';

export function ensureExportDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}
