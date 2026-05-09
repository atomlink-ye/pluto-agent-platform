import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RUNTIME_SOURCE_DIRS = [join(PACKAGE_ROOT, 'src'), join(PACKAGE_ROOT, 'scripts')];
const CROSS_PACKAGE_SRC_IMPORT_PATTERN = /\b(?:from\s*['"]|import\s*\(\s*['"])\.\.\/.*pluto-v2-core\/src\//;

function collectTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTypeScriptFiles(entryPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(entryPath);
    }
  }

  return files;
}

describe('runtime source boundaries', () => {
  it('contains no direct imports from pluto-v2-core/src', () => {
    const violations: string[] = [];

    for (const dir of RUNTIME_SOURCE_DIRS) {
      for (const filePath of collectTypeScriptFiles(dir)) {
        const lines = readFileSync(filePath, 'utf8').split('\n');

        for (const [index, line] of lines.entries()) {
          if (CROSS_PACKAGE_SRC_IMPORT_PATTERN.test(line)) {
            violations.push(`${relative(PACKAGE_ROOT, filePath)}:${index + 1}: ${line.trim()}`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
