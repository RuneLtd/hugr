import { ToolRegistry } from './registry.js';

export function createMistralToolRegistry(): ToolRegistry {
    const registry = new ToolRegistry();

    registry.registerTool({ name: 'web_search', capabilities: { web: true, search: true }, provider: 'mistral' });
    registry.registerTool({ name: 'code_interpreter', capabilities: { execute: true }, provider: 'mistral' });
    registry.registerTool({ name: 'image_generation', capabilities: {}, provider: 'mistral' });
    registry.registerTool({ name: 'document_library', capabilities: { read: true, search: true }, provider: 'mistral' });

    registry.registerAccessLevel('full', ['web_search', 'code_interpreter', 'image_generation', 'document_library']);
    registry.registerAccessLevel('read-only', ['web_search', 'document_library']);
    registry.registerAccessLevel('execute', ['code_interpreter']);

    registry.registerNameMapping('search', 'web_search');
    registry.registerNameMapping('execute', 'code_interpreter');
    registry.registerNameMapping('read', 'document_library');
    registry.registerNameMapping('write', 'code_interpreter');
    registry.registerNameMapping('web', 'web_search');

    return registry;
}
