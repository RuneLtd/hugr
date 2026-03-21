import type { AgentRuntime } from '../runtime/types.js';
import type { VCSProvider } from '../vcs/types.js';
import type { StorageProvider } from '../storage/types.js';
import type { SkillLoader } from '../skills/types.js';
import type { ToolDefinition } from '../tools/types.js';

export interface HugrPlugin {
    name: string;
    version: string;

    agents?: Array<{ id: string; [key: string]: unknown }>;
    tools?: ToolDefinition[];
    presets?: Array<{ id: string; [key: string]: unknown }>;

    setup?(context: PluginContext): Promise<void>;
}

export interface PluginContext {
    registerAgent(id: string, handler: unknown): void;
    registerTool(tool: ToolDefinition): void;
    registerPreset(id: string, preset: unknown): void;
}
