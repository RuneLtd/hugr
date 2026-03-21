import { ToolRegistry } from './registry.js';

export function createOpenAIToolRegistry(): ToolRegistry {
    const registry = new ToolRegistry();

    registry.registerTool({ name: 'web_search', capabilities: { web: true }, provider: 'openai' });
    registry.registerTool({ name: 'file_search', capabilities: { read: true, search: true }, provider: 'openai' });
    registry.registerTool({ name: 'computer_use', capabilities: { read: true, write: true, execute: true }, provider: 'openai' });

    registry.registerAccessLevel('full', ['web_search', 'file_search', 'computer_use']);
    registry.registerAccessLevel('read-only', ['file_search']);
    registry.registerAccessLevel('search', ['web_search', 'file_search']);

    registry.registerNameMapping('search', 'web_search');
    registry.registerNameMapping('read', 'file_search');
    registry.registerNameMapping('computer', 'computer_use');

    return registry;
}
