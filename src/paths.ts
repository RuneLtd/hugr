
import { createHash } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import { homedir } from 'node:os';

const HUGR_HOME = '.hugr';

const SESSIONS_DIR = 'sessions';

const SESSION_DATA_DIR = 'session-data';

const WORKTREES_DIR = 'worktrees';

function projectHash(projectPath: string): string {
  const absPath = resolve(projectPath);
  return createHash('sha256').update(absPath).digest('hex').slice(0, 8);
}

export function resolveHugrDir(projectPath: string): string {
  const name = basename(resolve(projectPath));
  const hash = projectHash(projectPath);
  return join(homedir(), HUGR_HOME, SESSIONS_DIR, `${name}-${hash}`);
}

export function resolveSessionDataDir(projectPath: string): string {
  return join(resolveHugrDir(projectPath), SESSION_DATA_DIR);
}

export function resolveWorktreeDir(projectPath: string): string {
  return join(resolveHugrDir(projectPath), WORKTREES_DIR);
}
