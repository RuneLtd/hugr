export interface StorageProvider {
    read(key: string): Promise<string | null>;
    write(key: string, data: string): Promise<void>;
    delete(key: string): Promise<void>;
    exists(key: string): Promise<boolean>;
    list(prefix: string): Promise<string[]>;
    append(key: string, line: string): Promise<void>;
    readLines(key: string): Promise<string[]>;
    resolvePath(...segments: string[]): string;
    mkdir(path: string): Promise<void>;
}

export interface PathResolver {
    resolveSessionDir(projectPath: string): string;
    resolveSessionDataDir(projectPath: string): string;
    resolveWorkspaceDir(projectPath: string): string;
}
