import { ToolRegistry } from './registry.js';

export function createAnthropicToolRegistry(): ToolRegistry {
    const registry = new ToolRegistry();

    registry.registerTool({ name: 'web_search_20250305', capabilities: { web: true, search: true }, provider: 'anthropic' });
    registry.registerTool({ name: 'web_fetch_20250910', capabilities: { web: true, read: true }, provider: 'anthropic' });
    registry.registerTool({ name: 'computer_use_20250124', capabilities: { read: true, write: true, execute: true }, provider: 'anthropic' });
    registry.registerTool({ name: 'text_editor_20250124', capabilities: { read: true, write: true }, provider: 'anthropic' });
    registry.registerTool({ name: 'bash_20250124', capabilities: { execute: true }, provider: 'anthropic' });

    registry.registerAccessLevel('full', ['web_search_20250305', 'web_fetch_20250910', 'computer_use_20250124', 'text_editor_20250124', 'bash_20250124']);
    registry.registerAccessLevel('read-only', ['web_search_20250305', 'web_fetch_20250910', 'text_editor_20250124']);
    registry.registerAccessLevel('read-write-no-bash', ['web_search_20250305', 'web_fetch_20250910', 'text_editor_20250124']);
    registry.registerAccessLevel('server-only', ['web_search_20250305', 'web_fetch_20250910']);

    registry.registerNameMapping('search', 'web_search_20250305');
    registry.registerNameMapping('web', 'web_fetch_20250910');
    registry.registerNameMapping('read', 'text_editor_20250124');
    registry.registerNameMapping('write', 'text_editor_20250124');
    registry.registerNameMapping('execute', 'bash_20250124');
    registry.registerNameMapping('computer', 'computer_use_20250124');

    return registry;
}
