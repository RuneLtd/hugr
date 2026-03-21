import type { ToolDefinition, ToolAccessLevel, ToolResolver } from './types.js';

export class ToolRegistry implements ToolResolver {
    private tools = new Map<string, ToolDefinition>();
    private accessLevels = new Map<string, string[]>();
    private nameMap = new Map<string, string>();

    registerTool(tool: ToolDefinition): void {
        this.tools.set(tool.name, tool);
    }

    registerAccessLevel(level: string, toolNames: string[]): void {
        this.accessLevels.set(level, toolNames);
    }

    registerNameMapping(genericName: string, providerName: string): void {
        this.nameMap.set(genericName, providerName);
    }

    resolveTools(accessLevel: ToolAccessLevel, overrides?: string[]): string[] {
        if (overrides && overrides.length > 0) {
            return [...overrides];
        }
        return this.accessLevels.get(accessLevel) ?? [];
    }

    getAvailableTools(): ToolDefinition[] {
        return Array.from(this.tools.values());
    }

    mapToolName(genericName: string): string {
        return this.nameMap.get(genericName) ?? genericName;
    }

    hasTool(name: string): boolean {
        return this.tools.has(name);
    }

    getAccessLevels(): string[] {
        return Array.from(this.accessLevels.keys());
    }
}
