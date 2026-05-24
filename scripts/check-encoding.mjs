import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const bad = [];
function walk(dir) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    if (name.name === 'node_modules' || name.name === '.git') continue;
    const p = path.join(dir, name.name);
    if (name.isDirectory()) walk(p);
    else if (name.name.endsWith('.ts') || name.name.endsWith('.tsx')) {
      const b = fs.readFileSync(p);
      if (b.length >= 2 && b[1] === 0) bad.push(path.relative(root, p));
    }
  }
}
walk(path.join(root, 'src'));
walk(path.join(root, 'tests'));
if (bad.length) { console.error('UTF-16:', bad.join(', ')); process.exit(1); }
console.log('encoding check OK');