import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
const files = readdirSync(testsDirectory)
  .filter(name => name.endsWith('.test.mjs'))
  .sort()
  .map(name => path.join(testsDirectory, name));

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
