import { ToolRegistry } from './registry.js';

export function createGroqToolRegistry(): ToolRegistry {
    const registry = new ToolRegistry();

    registry.registerTool({ name: 'web_search', capabilities: { web: true, search: true }, provider: 'groq' });
    registry.registerTool({ name: 'code_interpreter', capabilities: { execute: true }, provider: 'groq' });
    registry.registerTool({ name: 'visit_website', capabilities: { web: true, read: true }, provider: 'groq' });
    registry.registerTool({ name: 'browser_automation', capabilities: { web: true, read: true, write: true, execute: true }, provider: 'groq' });
    registry.registerTool({ name: 'wolfram_alpha', capabilities: { execute: true }, provider: 'groq' });

    registry.registerAccessLevel('full', ['web_search', 'code_interpreter', 'visit_website', 'browser_automation', 'wolfram_alpha']);
    registry.registerAccessLevel('read-only', ['web_search', 'visit_website']);
    registry.registerAccessLevel('search', ['web_search', 'visit_website']);
    registry.registerAccessLevel('execute', ['code_interpreter', 'wolfram_alpha']);

    registry.registerNameMapping('search', 'web_search');
    registry.registerNameMapping('read', 'visit_website');
    registry.registerNameMapping('execute', 'code_interpreter');
    registry.registerNameMapping('web', 'visit_website');
    registry.registerNameMapping('computer', 'browser_automation');

    return registry;
}
