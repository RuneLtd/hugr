import { ToolRegistry } from './registry.js';

export function createBedrockToolRegistry(): ToolRegistry {
    const registry = new ToolRegistry();

    registry.registerTool({ name: 'computer_20241022', capabilities: { read: true, write: true, execute: true }, provider: 'bedrock' });
    registry.registerTool({ name: 'bash_20241022', capabilities: { execute: true }, provider: 'bedrock' });
    registry.registerTool({ name: 'text_editor_20241022', capabilities: { read: true, write: true }, provider: 'bedrock' });

    registry.registerAccessLevel('full', ['computer_20241022', 'bash_20241022', 'text_editor_20241022']);
    registry.registerAccessLevel('read-only', ['text_editor_20241022']);
    registry.registerAccessLevel('read-write-no-bash', ['text_editor_20241022']);

    registry.registerNameMapping('computer', 'computer_20241022');
    registry.registerNameMapping('execute', 'bash_20241022');
    registry.registerNameMapping('read', 'text_editor_20241022');
    registry.registerNameMapping('write', 'text_editor_20241022');

    return registry;
}
