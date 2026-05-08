import { accessSync, constants, readFileSync } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, extname, resolve } from 'node:path';

export interface ResolvedPlaybook {
  readonly ref: string;
  readonly absolutePath: string;
  readonly body: string;
  readonly sha256: string;
}

export class PlaybookResolutionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PlaybookResolutionError';
  }
}

function assertMarkdownPlaybookRef(playbookRef: string): void {
  if (playbookRef.trim().length === 0) {
    throw new PlaybookResolutionError('agentic playbookRef must be a non-empty markdown path');
  }

  if (extname(playbookRef).toLowerCase() !== '.md') {
    throw new PlaybookResolutionError('agentic playbookRef must reference a markdown file');
  }
}

function resolvePlaybookAbsolutePath(specPath: string, playbookRef: string): string {
  return resolve(dirname(specPath), playbookRef);
}

export function resolvePlaybookSync(args: {
  readonly specPath: string;
  readonly playbookRef: string;
}): ResolvedPlaybook {
  const { specPath, playbookRef } = args;
  assertMarkdownPlaybookRef(playbookRef);

  const absolutePath = resolvePlaybookAbsolutePath(specPath, playbookRef);

  try {
    accessSync(absolutePath, constants.R_OK);
  } catch (error) {
    throw new PlaybookResolutionError(
      `agentic playbookRef could not be read relative to the spec file: ${playbookRef}`,
      { cause: error },
    );
  }

  try {
    const body = readFileSync(absolutePath, 'utf8');
    return {
      ref: playbookRef,
      absolutePath,
      body,
      sha256: createHash('sha256').update(body).digest('hex'),
    };
  } catch (error) {
    throw new PlaybookResolutionError(`agentic playbookRef could not be read as UTF-8: ${playbookRef}`, {
      cause: error,
    });
  }
}

export async function resolvePlaybook(args: {
  readonly specPath: string;
  readonly playbookRef: string;
}): Promise<ResolvedPlaybook> {
  const { specPath, playbookRef } = args;
  assertMarkdownPlaybookRef(playbookRef);

  const absolutePath = resolvePlaybookAbsolutePath(specPath, playbookRef);

  try {
    await access(absolutePath, constants.R_OK);
  } catch (error) {
    throw new PlaybookResolutionError(
      `agentic playbookRef could not be read relative to the spec file: ${playbookRef}`,
      { cause: error },
    );
  }

  try {
    const body = await readFile(absolutePath, 'utf8');
    return {
      ref: playbookRef,
      absolutePath,
      body,
      sha256: createHash('sha256').update(body).digest('hex'),
    };
  } catch (error) {
    throw new PlaybookResolutionError(`agentic playbookRef could not be read as UTF-8: ${playbookRef}`, {
      cause: error,
    });
  }
}
