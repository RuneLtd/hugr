export interface SkillLoader {
    loadSkill(skillPath: string): Promise<string | undefined>;
    loadAgentSkill(agentName: string, projectPath: string, configuredSkills?: string[]): Promise<string | undefined>;
    loadMultiple(paths: string[]): Promise<string | undefined>;
}
