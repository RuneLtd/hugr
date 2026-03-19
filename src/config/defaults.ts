
import type { HugrConfig } from './schema.js';

export const DEFAULT_CONFIG: HugrConfig = {
    preset: 'balanced',

    autonomy: {
        level: 'supervised',
    },

    provider: {
        type: 'claude-code',
        timeout: 0,
        maxRetries: 2,
    },

    execution: {
        taskTimeout: 300,
        autoResume: true,
        agentTeams: false,
    },

    architect: {
        mode: 'thorough',
    },

    raven: {
        iterations: 1,
        mode: 'fixed',
        maxIterations: 3,
    },
};
