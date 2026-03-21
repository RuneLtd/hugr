import { mkdir } from 'fs/promises';
import { join } from 'path';
import { resolveHugrDir } from '../paths.js';
import { VCSProvider, IsolatedWorkspace, IsolationMode } from './types.js';

export class NoopVCSProvider implements VCSProvider {
  name = 'noop';

  async isAvailable(projectPath: string): Promise<boolean> {
    return true;
  }

  async createWorkspace(opts: {
    projectPath: string;
    iteration: number;
    basedOn?: string;
    isolationMode: IsolationMode;
  }): Promise<IsolatedWorkspace> {
    const { projectPath, iteration } = opts;

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
  }

  async commitChanges(workspacePath: string, message: string): Promise<void> {
  }

  async mergeWorkspace(
    projectPath: string,
    workspace: IsolatedWorkspace,
  ): Promise<{ success: boolean; conflicts?: string[]; error?: string }> {
    return { success: true };
  }

  async cleanStaleWorkspaces(projectPath: string): Promise<void> {
  }

  async findNextIteration(projectPath: string): Promise<number> {
    return 1;
  }

  async getCurrentRef(workdir: string): Promise<string> {
    return 'HEAD';
  }

  async listWorkspaces(projectPath: string): Promise<IsolatedWorkspace[]> {
    return [];
  }
}
