
import { execFile as execFileCallback } from 'child_process';
import { promisify } from 'util';
import { rm } from 'fs/promises';

const execFile = promisify(execFileCallback);

export interface MergeResult {

  success: boolean;

  conflicts?: string[];

  error?: string;
}

export async function getCurrentBranch(workdir: string): Promise<string> {
  try {
    const { stdout } = await execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: workdir,
    });
    return stdout.trim();
  } catch {

    try {
      const { stdout } = await execFile('git', ['symbolic-ref', '--short', 'HEAD'], {
        cwd: workdir,
      });
      return stdout.trim();
    } catch {
      return 'main';
    }
  }
}

export async function switchBranch(workdir: string, branchName: string): Promise<void> {
  try {
    await execFile('git', ['checkout', branchName], {
      cwd: workdir,
    });
  } catch (error) {
    throw new Error(`Failed to switch to branch ${branchName}: ${error}`);
  }
}

export async function mergeBranch(
  workdir: string,
  sourceBranch: string
): Promise<MergeResult> {
  try {
    await execFile('git', ['merge', sourceBranch, '--no-edit'], {
      cwd: workdir,
    });
    return { success: true };
  } catch (error) {
    const errorMessage = String(error);

    try {
      const { stdout } = await execFile(
        'git',
        ['diff', '--name-only', '--diff-filter=U'],
        { cwd: workdir }
      );
      const conflicts = stdout
        .trim()
        .split('\n')
        .filter((line) => line.length > 0);

      if (conflicts.length > 0) {
        return { success: false, conflicts };
      }
    } catch {

    }

    return {
      success: false,
      conflicts: [],
      error: `Failed to merge branch ${sourceBranch}: ${errorMessage}`,
    };
  }
}

export async function deleteBranch(workdir: string, branchName: string): Promise<void> {
  try {
    await execFile('git', ['branch', '-D', branchName], {
      cwd: workdir,
    });
  } catch (error) {
    throw new Error(`Failed to delete branch ${branchName}: ${error}`);
  }
}

export async function abortMerge(workdir: string): Promise<void> {
  try {
    await execFile('git', ['merge', '--abort'], {
      cwd: workdir,
    });
  } catch (error) {
    throw new Error(`Failed to abort merge: ${error}`);
  }
}

export async function commitAll(workdir: string, message: string, options?: { verify?: boolean }): Promise<void> {
  try {

    const { stdout: status } = await execFile('git', ['status', '--porcelain'], {
      cwd: workdir,
    });
    if (status.trim().length === 0) {
      return;
    }

    await execFile('git', ['add', '-A'], {
      cwd: workdir,
    });

    const args = ['commit', '-m', message];
    if (!options?.verify) {
      args.push('--no-verify');
    }
    await execFile('git', args, {
      cwd: workdir,
    });
  } catch (error) {
    throw new Error(`Failed to commit changes: ${error}`);
  }
}

export async function addWorktree(
  mainWorkdir: string,
  worktreePath: string,
  branchName: string,
  startPoint?: string
): Promise<void> {
  try {
    const args = ['worktree', 'add', '-b', branchName, worktreePath];
    if (startPoint) {
      args.push(startPoint);
    }
    await execFile('git', args, {
      cwd: mainWorkdir,
    });
  } catch (error) {
    throw new Error(`Failed to add worktree at ${worktreePath} on branch ${branchName}: ${error}`);
  }
}

export async function removeWorktree(
  mainWorkdir: string,
  worktreePath: string
): Promise<void> {
  try {
    await execFile('git', ['worktree', 'remove', '--force', worktreePath], {
      cwd: mainWorkdir,
    });
  } catch (error) {

    try {
      await rm(worktreePath, { recursive: true, force: true });

      await execFile('git', ['worktree', '.hugr'], { cwd: mainWorkdir });
    } catch (cleanupError) {
      console.warn(`Worktree cleanup failed for ${worktreePath}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
    }

  }
}

export async function listWorktrees(workdir: string): Promise<string[]> {
  try {
    const { stdout } = await execFile('git', ['worktree', 'list', '--porcelain'], {
      cwd: workdir,
    });
    const paths: string[] = [];
    for (const line of stdout.split('\n')) {
      if (line.startsWith('worktree ')) {
        paths.push(line.slice('worktree '.length));
      }
    }
    return paths;
  } catch (error) {
    throw new Error(`Failed to list worktrees: ${error}`);
  }
}

export async function listHugrBranches(workdir: string): Promise<
  { branch: string; iteration: number; timestamp: string }[]
> {
  try {

    const { stdout } = await execFile(
      'git',
      ['for-each-ref', '--sort=creatordate', '--format=%(refname:short) %(creatordate:iso-strict)', 'refs/heads/hugr/'],
      { cwd: workdir }
    );

    const branches: { branch: string; iteration: number; timestamp: string }[] = [];
    for (const line of stdout.trim().split('\n')) {
      if (!line) continue;
      const spaceIdx = line.indexOf(' ');
      const branch = spaceIdx > 0 ? line.slice(0, spaceIdx) : line;
      const timestamp = spaceIdx > 0 ? line.slice(spaceIdx + 1) : new Date().toISOString();

      const match = branch.match(/^hugr\/(?:v|worktree)-(\d+)$/);
      if (match) {
        branches.push({
          branch,
          iteration: parseInt(match[1], 10),
          timestamp,
        });
      }
    }

    return branches.sort((a, b) => a.iteration - b.iteration);
  } catch {
    return [];
  }
}
