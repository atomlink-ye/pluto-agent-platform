import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { PlaybookResolutionError, resolvePlaybook } from '../../src/loader/playbook-resolver.js';

describe('resolvePlaybook', () => {
  it('resolves the playbook relative to the spec file directory', async () => {
    const { specPath, playbookPath } = writeSpecFixture('# Lead\n\nUse the repo state.\n');

    const resolved = await resolvePlaybook({
      specPath,
      playbookRef: 'playbooks/team-lead.md',
    });

    expect(resolved.ref).toBe('playbooks/team-lead.md');
    expect(resolved.absolutePath).toBe(playbookPath);
  });

  it('reads the playbook as utf8 and computes sha256 from the body', async () => {
    const body = '# Lead\n\nStep 1. Coordinate.\n';
    const { specPath } = writeSpecFixture(body);

    const resolved = await resolvePlaybook({
      specPath,
      playbookRef: 'playbooks/team-lead.md',
    });

    expect(resolved.body).toBe(body);
    expect(resolved.sha256).toBe(createHash('sha256').update(body).digest('hex'));
  });

  it('rejects non-markdown playbook references', async () => {
    const { specPath } = writeSpecFixture('# Lead\n');

    await expect(
      resolvePlaybook({
        specPath,
        playbookRef: 'playbooks/team-lead.txt',
      }),
    ).rejects.toThrow(/agentic.*playbookRef.*markdown/i);
  });

  it('throws PlaybookResolutionError when the playbook is missing', async () => {
    const { specPath } = writeSpecFixture('# Lead\n');

    await expect(
      resolvePlaybook({
        specPath,
        playbookRef: 'playbooks/missing.md',
      }),
    ).rejects.toThrow(PlaybookResolutionError);

    await expect(
      resolvePlaybook({
        specPath,
        playbookRef: 'playbooks/missing.md',
      }),
    ).rejects.toThrow(/agentic.*playbookRef/i);
  });
});

function writeSpecFixture(playbookBody: string): { specPath: string; playbookPath: string } {
  const tempDir = mkdtempSync(join(tmpdir(), 'pluto-v2-runtime-playbook-'));
  const playbookDir = join(tempDir, 'playbooks');
  const specPath = join(tempDir, 'scenario.yaml');
  const playbookPath = join(playbookDir, 'team-lead.md');

  mkdirSync(playbookDir, { recursive: true });
  writeFileSync(specPath, 'runId: run-1\n', 'utf8');
  writeFileSync(playbookPath, playbookBody, 'utf8');

  return { specPath, playbookPath };
}
