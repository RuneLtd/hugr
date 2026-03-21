import { ToolRegistry } from './registry.js';

export function createClaudeCodeToolRegistry(): ToolRegistry {
    const registry = new ToolRegistry();

    registry.registerTool({ name: 'Read', capabilities: { read: true } });
    registry.registerTool({ name: 'Write', capabilities: { write: true } });
    registry.registerTool({ name: 'Edit', capabilities: { write: true } });
    registry.registerTool({ name: 'Bash', capabilities: { execute: true } });
    registry.registerTool({ name: 'Glob', capabilities: { search: true } });
    registry.registerTool({ name: 'Grep', capabilities: { search: true } });
    registry.registerTool({ name: 'WebSearch', capabilities: { web: true } });
    registry.registerTool({ name: 'WebFetch', capabilities: { web: true } });
    registry.registerTool({ name: 'TodoWrite', capabilities: {} });
    registry.registerTool({ name: 'Task', capabilities: {} });
    registry.registerTool({ name: 'AskUserQuestion', capabilities: {} });

    registry.registerAccessLevel('full', ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep']);
    registry.registerAccessLevel('read-only', ['Read', 'Glob', 'Grep']);
    registry.registerAccessLevel('read-write-no-bash', ['Read', 'Write', 'Edit', 'Glob', 'Grep']);

    return registry;
}
