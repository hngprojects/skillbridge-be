import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hooksPath = resolve(repoRoot, '.githooks');

if (!existsSync(resolve(repoRoot, '.git'))) {
  process.exit(0);
}

try {
  execFileSync('git', ['config', 'core.hooksPath', hooksPath], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
} catch {
  // Ignore hook setup failures so installs still succeed.
}
