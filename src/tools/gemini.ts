import { ToolRegistry } from './registry.js';

export function createGeminiToolRegistry(): ToolRegistry {
    const registry = new ToolRegistry();

    registry.registerTool({ name: 'google_search', capabilities: { web: true, search: true }, provider: 'gemini' });
    registry.registerTool({ name: 'code_execution', capabilities: { execute: true }, provider: 'gemini' });
    registry.registerTool({ name: 'computer_use', capabilities: { read: true, write: true, execute: true }, provider: 'gemini' });
    registry.registerTool({ name: 'file_search', capabilities: { read: true, search: true }, provider: 'gemini' });
    registry.registerTool({ name: 'google_maps', capabilities: { search: true }, provider: 'gemini' });
    registry.registerTool({ name: 'url_context', capabilities: { web: true, read: true }, provider: 'gemini' });

    registry.registerAccessLevel('full', ['google_search', 'code_execution', 'computer_use', 'file_search', 'google_maps', 'url_context']);
    registry.registerAccessLevel('read-only', ['google_search', 'file_search', 'url_context']);
    registry.registerAccessLevel('search', ['google_search', 'file_search', 'google_maps']);
    registry.registerAccessLevel('execute', ['code_execution', 'computer_use']);

    registry.registerNameMapping('search', 'google_search');
    registry.registerNameMapping('execute', 'code_execution');
    registry.registerNameMapping('read', 'file_search');
    registry.registerNameMapping('web', 'url_context');
    registry.registerNameMapping('computer', 'computer_use');

    return registry;
}
