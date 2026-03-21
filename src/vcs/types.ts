export interface IsolatedWorkspace {
    id: string;
    path: string;
    ref: string;
    iteration: number;
    timestamp: Date;
    summary?: string;
    metadata?: Record<string, unknown>;
}

export type IsolationMode = 'full' | 'lightweight' | 'none' | (string & {});

export interface VCSProvider {
    name: string;

    isAvailable(projectPath: string): Promise<boolean>;

    createWorkspace(opts: {
        projectPath: string;
        iteration: number;
        basedOn?: string;
        isolationMode: IsolationMode;
    }): Promise<IsolatedWorkspace>;

    removeWorkspace(projectPath: string, workspace: IsolatedWorkspace): Promise<void>;

    commitChanges(workspacePath: string, message: string): Promise<void>;

    mergeWorkspace(
        projectPath: string,
        workspace: IsolatedWorkspace,
    ): Promise<{ success: boolean; conflicts?: string[]; error?: string }>;

    cleanStaleWorkspaces(projectPath: string): Promise<void>;

    findNextIteration(projectPath: string): Promise<number>;

    getCurrentRef(workdir: string): Promise<string>;

    listWorkspaces(projectPath: string): Promise<IsolatedWorkspace[]>;
}
