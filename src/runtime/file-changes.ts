import type { FileChange } from './types.js';

export interface FileChangeDetector {
    snapshot(workdir: string): Promise<string>;
    diff(workdir: string, snapshotId: string): Promise<FileChange[]>;
    cleanup(workdir: string, snapshotId: string): Promise<void>;
}
