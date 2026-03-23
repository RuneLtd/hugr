import { ToolRegistry } from './registry.js';

export function createXAIToolRegistry(): ToolRegistry {
    const registry = new ToolRegistry();

    registry.registerTool({ name: 'web_search', capabilities: { web: true, search: true }, provider: 'xai' });
    registry.registerTool({ name: 'x_search', capabilities: { web: true, search: true }, provider: 'xai' });
    registry.registerTool({ name: 'code_execution', capabilities: { execute: true }, provider: 'xai' });

    registry.registerAccessLevel('full', ['web_search', 'x_search', 'code_execution']);
    registry.registerAccessLevel('read-only', ['web_search', 'x_search']);
    registry.registerAccessLevel('search', ['web_search', 'x_search']);
    registry.registerAccessLevel('execute', ['code_execution']);

    registry.registerNameMapping('search', 'web_search');
    registry.registerNameMapping('read', 'web_search');
    registry.registerNameMapping('execute', 'code_execution');
    registry.registerNameMapping('web', 'web_search');

    return registry;
}
