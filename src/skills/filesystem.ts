import { readFile, stat as fsStat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { SkillLoader } from './types.js';

export interface FileSystemSkillLoaderOptions {
    skillDirs?: string[];
    filePattern?: string;
}

export class FileSystemSkillLoader implements SkillLoader {
    private skillDirs: string[];
    private filePattern: string;

    constructor(options?: FileSystemSkillLoaderOptions) {
        this.skillDirs = options?.skillDirs || [];
        this.filePattern = options?.filePattern || 'hugr-{name}.md';
    }

    async loadSkill(skillPath: string): Promise<string | undefined> {
        try {
            const stats = await fsStat(skillPath);
            if (stats.isDirectory()) {
                const skillMdPath = join(skillPath, 'SKILL.md');
                let content = await readFile(skillMdPath, 'utf-8');

                const resourcesDir = join(skillPath, 'resources');
                try {
                    const resourceFiles = await readdir(resourcesDir);
                    for (const f of resourceFiles) {
                        try {
                            const resourceContent = await readFile(join(resourcesDir, f), 'utf-8');
                            content += `\n\n---\n\n## Resource File: ${f}\n\nThe following is the exact content of \`resources/${f}\`. Use this content directly — do not create your own version:\n\n\`\`\`\n${resourceContent}\n\`\`\``;
                        } catch {}
                    }
                } catch {}

                return content;
            }
            return await readFile(skillPath, 'utf-8');
        } catch {
            return undefined;
        }
    }

    async loadAgentSkill(agentName: string, projectPath: string, configuredSkills?: string[]): Promise<string | undefined> {
        if (configuredSkills && configuredSkills.length > 0) {
            return this.loadMultiple(configuredSkills);
        }
        return this.loadDefaultSkill(agentName, projectPath);
    }

    async loadMultiple(paths: string[]): Promise<string | undefined> {
        const parts: string[] = [];
        for (const sp of paths) {
            const content = await this.loadSkill(sp);
            if (content) parts.push(content);
        }
        return parts.length > 0 ? parts.join('\n\n---\n\n') : undefined;
    }

    private async loadDefaultSkill(agentName: string, projectPath: string): Promise<string | undefined> {
        const fileName = this.filePattern.replace('{name}', agentName);

        const searchPaths = [
            join(projectPath, '.claude', 'skills', fileName),
            join(homedir(), '.claude', 'skills', fileName),
            ...this.skillDirs.map(d => join(d, fileName)),
        ];

        for (const p of searchPaths) {
            try {
                return await readFile(p, 'utf-8');
            } catch {}
        }
        return undefined;
    }
}
