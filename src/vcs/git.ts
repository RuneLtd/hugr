import { execFile as execFileCallback } from 'child_process';
import { promisify } from 'util';
import { mkdir } from 'fs/promises';
import { resolve, join, basename } from 'path';
import {
  getCurrentBranch,
  switchBranch,
  mergeBranch,
  deleteBranch,
  commitAll,
  addWorktree,
  removeWorktree,
  listWorktrees,
  listHugrBranches,
} from '../git/operations.js';
import { resolveHugrDir, resolveWorktreeDir } from '../paths.js';
import { VCSProvider, IsolatedWorkspace, IsolationMode } from './types.js';

const execFile = promisify(execFileCallback);

export class GitVCSProvider implements VCSProvider {
  name = 'git';

  async isAvailable(projectPath: string): Promise<boolean> {
    try {
      await execFile('git', ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  async createWorkspace(opts: {
    projectPath: string;
    iteration: number;
    basedOn?: string;
    isolationMode: IsolationMode;
  }): Promise<IsolatedWorkspace> {
    const { projectPath, iteration, basedOn, isolationMode } = opts;

    if (isolationMode === 'full') {
      return this.createWorktreeWorkspace(projectPath, iteration, basedOn);
    } else if (isolationMode === 'lightweight') {
      return this.createBranchWorkspace(projectPath, iteration, basedOn);
    } else if (isolationMode === 'none') {
      return this.createLocalWorkspace(projectPath, iteration);
    } else {
      throw new Error(`Unknown isolation mode: ${isolationMode}`);
    }
  }

  private async createWorktreeWorkspace(
    projectPath: string,
    iteration: number,
    basedOn?: string,
  ): Promise<IsolatedWorkspace> {
    const branchName = `hugr/worktree-${iteration}`;
    const worktreeDir = resolveWorktreeDir(projectPath);
    const worktreePath = join(worktreeDir, `iteration-${iteration}`);

    await mkdir(worktreeDir, { recursive: true });

    const currentBranch = basedOn || (await getCurrentBranch(projectPath));
    await addWorktree(projectPath, worktreePath, branchName, currentBranch);

    const timestamp = new Date();

    return {
      id: branchName,
      path: worktreePath,
      ref: branchName,
      iteration,
      timestamp,
    };
  }

  private async createBranchWorkspace(
    projectPath: string,
    iteration: number,
    basedOn?: string,
  ): Promise<IsolatedWorkspace> {
    const branchName = `hugr/v-${iteration}`;
    const currentBranch = basedOn || (await getCurrentBranch(projectPath));

    try {
      await execFile('git', ['branch', branchName, currentBranch], {
        cwd: projectPath,
      });
    } catch (error) {
      throw new Error(`Failed to create branch ${branchName}: ${error}`);
    }

    const timestamp = new Date();

    return {
      id: branchName,
      path: projectPath,
      ref: branchName,
      iteration,
      timestamp,
    };
  }

  private async createLocalWorkspace(
    projectPath: string,
    iteration: number,
  ): Promise<IsolatedWorkspace> {
    const hugrDir = resolveHugrDir(projectPath);
    const localPath = join(hugrDir, `local-${iteration}`);

    await mkdir(localPath, { recursive: true });

    const timestamp = new Date();

    return {
      id: `local-${iteration}`,
      path: localPath,
      ref: 'HEAD',
      iteration,
      timestamp,
    };
  }

  async removeWorkspace(projectPath: string, workspace: IsolatedWorkspace): Promise<void> {
    if (workspace.ref.startsWith('hugr/worktree-')) {
      try {
        await removeWorktree(projectPath, workspace.path);
      } catch (error) {
        throw new Error(`Failed to remove worktree: ${error}`);
      }
    } else if (workspace.ref.startsWith('hugr/v-')) {
      try {
        await deleteBranch(projectPath, workspace.ref);
      } catch (error) {
        throw new Error(`Failed to delete branch: ${error}`);
      }
    }
  }

  async commitChanges(workspacePath: string, message: string): Promise<void> {
    await commitAll(workspacePath, message);
  }

  async mergeWorkspace(
    projectPath: string,
    workspace: IsolatedWorkspace,
  ): Promise<{ success: boolean; conflicts?: string[]; error?: string }> {
    const currentBranch = await getCurrentBranch(projectPath);

    const result = await mergeBranch(projectPath, workspace.ref);

    if (!result.success) {
      try {
        await execFile('git', ['merge', '--abort'], { cwd: projectPath });
      } catch {
      }
    }

    return result;
  }

  async cleanStaleWorkspaces(projectPath: string): Promise<void> {
    try {
      const worktrees = await listWorktrees(projectPath);
      const hugrBranches = await listHugrBranches(projectPath);

      const activeIterations = new Set(hugrBranches.map((b) => b.iteration));

      for (const worktreePath of worktrees) {
        const match = worktreePath.match(/iteration-(\d+)$/);
        if (match) {
          const iteration = parseInt(match[1], 10);
          if (!activeIterations.has(iteration)) {
            try {
              await removeWorktree(projectPath, worktreePath);
            } catch (error) {
              console.warn(`Failed to remove stale worktree at ${worktreePath}: ${error}`);
            }
          }
        }
      }
    } catch (error) {
      throw new Error(`Failed to clean stale workspaces: ${error}`);
    }
  }

  async findNextIteration(projectPath: string): Promise<number> {
    try {
      const { stdout } = await execFile(
        'git',
        ['for-each-ref', '--format=%(refname:short)', 'refs/heads/hugr/'],
        { cwd: projectPath },
      );

      let maxIteration = 0;

      for (const ref of stdout.trim().split('\n')) {
        if (!ref) continue;

        const match = ref.match(/^hugr\/(?:v|worktree)-(\d+)$/);
        if (match) {
          const iteration = parseInt(match[1], 10);
          maxIteration = Math.max(maxIteration, iteration);
        }
      }

      return maxIteration + 1;
    } catch {
      return 1;
    }
  }

  async getCurrentRef(workdir: string): Promise<string> {
    return getCurrentBranch(workdir);
  }

  async listWorkspaces(projectPath: string): Promise<IsolatedWorkspace[]> {
    try {
      const hugrBranches = await listHugrBranches(projectPath);
      const worktrees = await listWorktrees(projectPath);

      const workspaces: IsolatedWorkspace[] = [];

      for (const branch of hugrBranches) {
        if (branch.branch.startsWith('hugr/worktree-')) {
          const iteration = branch.iteration;
          const worktreePath = join(
            resolveWorktreeDir(projectPath),
            `iteration-${iteration}`,
          );

          if (worktrees.includes(worktreePath)) {
            workspaces.push({
              id: branch.branch,
              path: worktreePath,
              ref: branch.branch,
              iteration: branch.iteration,
              timestamp: new Date(branch.timestamp),
            });
          }
        } else if (branch.branch.startsWith('hugr/v-')) {
          workspaces.push({
            id: branch.branch,
            path: projectPath,
            ref: branch.branch,
            iteration: branch.iteration,
            timestamp: new Date(branch.timestamp),
          });
        }
      }

      return workspaces;
    } catch (error) {
      throw new Error(`Failed to list workspaces: ${error}`);
    }
  }
}
