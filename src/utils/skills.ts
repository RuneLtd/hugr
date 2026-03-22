import { readFile, stat as fsStat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export async function loadSkillFromPath(skillPath: string): Promise<string | undefined> {
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

export async function loadSkills(skillPaths: string[]): Promise<string | undefined> {
    const parts: string[] = [];
    for (const sp of skillPaths) {
        const content = await loadSkillFromPath(sp);
        if (content) parts.push(content);
    }
    return parts.length > 0 ? parts.join('\n\n---\n\n') : undefined;
}

export async function loadDefaultSkill(agentName: string, projectPath: string, skillPrefix?: string): Promise<string | undefined> {
    const prefix = skillPrefix || 'hugr';
    const fileName = `${prefix}-${agentName}.md`;
    const paths = [
        join(projectPath, '.claude', 'skills', fileName),
        join(homedir(), '.claude', 'skills', fileName),
    ];

    for (const p of paths) {
        try {
            return await readFile(p, 'utf-8');
        } catch {}
    }
    return undefined;
}

export async function loadAgentSkills(
    agentName: string,
    projectPath: string,
    configuredSkills?: string[],
    skillPrefix?: string
): Promise<string | undefined> {
    if (configuredSkills && configuredSkills.length > 0) {
        return loadSkills(configuredSkills);
    }
    return loadDefaultSkill(agentName, projectPath, skillPrefix);
}
