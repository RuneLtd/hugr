
import type { PresetName, PipelineConfig, AutonomyLevel } from './schema.js';

export interface PresetConfig {

    name: PresetName;

    label: string;

    description: string;

    pipeline: PipelineConfig;

    autonomy: AutonomyLevel;
}

export const PRESETS: Record<string, PresetConfig> = {
    fast: {
        name: 'fast',
        label: 'Fast',
        description: 'Quick architect review + coding. No refinement. Best for prototyping.',
        pipeline: {
            id: 'preset-fast',
            name: 'Fast',
            steps: [
                { agentId: 'architect', mode: 'quick', enabled: true },
                { agentId: 'coder', enabled: true },
            ],
            description: 'Architect (quick) → Coder',
        },
        autonomy: 'supervised',
    },

    balanced: {
        name: 'balanced',
        label: 'Balanced',
        description: 'Thorough architect + coding + one Raven refinement cycle. Good for daily work.',
        pipeline: {
            id: 'preset-balanced',
            name: 'Balanced',
            steps: [
                { agentId: 'architect', mode: 'thorough', enabled: true },
                { agentId: 'coder', enabled: true },
                { agentId: 'raven', iterations: 1, maxIterations: 3, enabled: true },
            ],
            description: 'Architect → Coder ↔ Raven ×1',
        },
        autonomy: 'supervised',
    },

    thorough: {
        name: 'thorough',
        label: 'Thorough',
        description: 'Thorough architect + coding + three Raven refinement cycles. Maximum quality.',
        pipeline: {
            id: 'preset-thorough',
            name: 'Thorough',
            steps: [
                { agentId: 'architect', mode: 'thorough', enabled: true },
                { agentId: 'coder', enabled: true },
                { agentId: 'raven', iterations: 3, maxIterations: 5, enabled: true },
            ],
            description: 'Architect → Coder ↔ Raven ×3',
        },
        autonomy: 'supervised',
    },

};

export function getPreset(name: PresetName): PresetConfig {
    return PRESETS[name] ?? PRESETS.balanced;
}
