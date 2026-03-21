
import { readFile } from 'fs/promises';
import { join } from 'path';

import type {
  HugrConfig,
  PartialHugrConfig,
  PresetName,
  AutonomyLevel,
  ProviderType,
  PipelineStep,
} from './schema.js';
import { DEFAULT_CONFIG } from './defaults.js';
import { getPreset } from './presets.js';

export interface LoadConfigOptions {

  projectPath?: string;

  preset?: string;

  provider?: string;

  model?: string;

  autonomy?: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<HugrConfig> {
  const projectPath = options.projectPath ?? process.cwd();

  let config: HugrConfig = structuredClone(DEFAULT_CONFIG);

  const fileConfig = await loadConfigFile(projectPath);

  const presetName = (options.preset ?? fileConfig?.preset ?? 'balanced') as PresetName;
  const preset = getPreset(presetName);
  config.preset = presetName;

  config.pipeline = structuredClone(preset.pipeline);
  config.autonomy.level = preset.autonomy;

  if (fileConfig) {
    mergeProjectConfig(config, fileConfig);

    if (fileConfig.pipeline) {
      config.pipeline = fileConfig.pipeline;
    } else if (fileConfig.architect || fileConfig.raven) {
      config.pipeline = undefined;
    }
  }

  if (options.provider) {
    config.provider.type = options.provider as ProviderType;
  }
  if (options.model) {
    config.provider.model = options.model;
  }
  if (options.autonomy) {
    config.autonomy.level = options.autonomy as AutonomyLevel;
  }

  const validation = validateConfig(config);
  if (!validation.valid) {
    throw new ConfigError(`Invalid configuration: ${validation.errors.join(', ')}`);
  }

  return ensurePipeline(config);
}

async function loadConfigFile(projectPath: string): Promise<PartialHugrConfig | null> {
  const configPath = join(projectPath, 'config.yaml');

  try {
    const content = await readFile(configPath, 'utf-8');
    const yaml = await import('yaml');
    return yaml.parse(content) as PartialHugrConfig;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw new ConfigError(`Failed to load config: ${error.message}`);
  }
}

function mergeProjectConfig(config: HugrConfig, fileConfig: PartialHugrConfig): void {
  if (fileConfig.autonomy) {
    Object.assign(config.autonomy, fileConfig.autonomy);
  }
  if (fileConfig.provider) {
    Object.assign(config.provider, fileConfig.provider);
  }
  if (fileConfig.execution) {
    Object.assign(config.execution, fileConfig.execution);
  }
  if (fileConfig.architect) {
    Object.assign(config.architect, fileConfig.architect);
  }
  if (fileConfig.raven) {
    Object.assign(config.raven, fileConfig.raven);
  }
}

export function getDefaultConfig(presetName?: string): HugrConfig {
  const config = structuredClone(DEFAULT_CONFIG);

  if (presetName) {
    const preset = getPreset(presetName as PresetName);
    config.preset = presetName as PresetName;
    config.pipeline = structuredClone(preset.pipeline);
    config.autonomy.level = preset.autonomy;
  }

  return ensurePipeline(config);
}

function ensurePipeline(config: HugrConfig): HugrConfig {
  if (config.pipeline) {
    return config;
  }

  const steps: PipelineStep[] = [];

  if (config.architect.mode !== 'off') {
    steps.push({
      agentId: 'architect',
      mode: config.architect.mode,
      enabled: true,
    });
  }

  steps.push({ agentId: 'coder', enabled: true });

  if (config.raven.iterations > 0) {
    steps.push({
      agentId: 'raven',
      iterations: config.raven.iterations,
      loopUntilDone: config.raven.mode === 'auto',
      maxIterations: config.raven.maxIterations,
      enabled: true,
    });
  }

  const desc = [
    config.architect.mode !== 'off' ? `Architect(${config.architect.mode})` : null,
    'Coder',
    config.raven.iterations > 0 ? `Raven(${config.raven.iterations}×)` : null,
  ].filter(Boolean).join(' → ');

  return {
    ...config,
    pipeline: {
      id: 'default',
      name: 'Default Pipeline',
      steps,
      description: desc,
    },
  };
}

export function validateConfig(config: HugrConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.provider?.type) {
    errors.push('provider.type is required');
  }

  if (!config.autonomy?.level) {
    errors.push('autonomy.level is required');
  }

  const validAutonomy = ['supervised', 'auto'];
  if (config.autonomy?.level && !validAutonomy.includes(config.autonomy.level)) {
    errors.push(`Invalid autonomy level: ${config.autonomy.level}`);
  }

  const validArchitectModes = ['thorough', 'quick', 'off'];
  if (config.architect?.mode && !validArchitectModes.includes(config.architect.mode)) {
    errors.push(`Invalid architect mode: ${config.architect.mode}`);
  }

  const validRavenModes = ['fixed', 'auto', 'manual'];
  if (config.raven?.mode && !validRavenModes.includes(config.raven.mode)) {
    errors.push(`Invalid raven mode: ${config.raven.mode}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export async function serializeConfig(config: HugrConfig): Promise<string> {
  const yaml = await import('yaml');
  return yaml.stringify(config);
}
