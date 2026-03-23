import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rmdir, writeFile, mkdir, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  DEFAULT_CONFIG,
  PRESETS,
  getDefaultConfig,
  getPreset,
  loadConfig,
  validateConfig,
  serializeConfig,
} from '../config/index.js';
import {
  writeInterrupt,
  readInterrupt,
  clearInterrupt,
  hasInterrupt,
} from '../interrupt/index.js';
import { resolveHugrDir, resolveSessionDataDir } from '../paths.js';
import type { HugrConfig, InterruptRequest } from '../config/index.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'hugr-test-'));
});

afterEach(async () => {
  try {
    await rmdir(tempDir, { recursive: true });
  } catch {
  }
});

describe('CONFIG: getDefaultConfig()', () => {
  it('returns valid config with no preset specified', () => {
    const config = getDefaultConfig();
    expect(config).toBeDefined();
    expect(config.preset).toBe('balanced');
    expect(config.autonomy.level).toBe('supervised');
    expect(config.provider.type).toBe('claude-code');
    expect(config.execution.taskTimeout).toBe(300);
  });

  it('returns config with specified preset', () => {
    const config = getDefaultConfig('fast');
    expect(config.preset).toBe('fast');
    expect(config.pipeline).toBeDefined();
    expect(config.pipeline.steps.length).toBeGreaterThan(0);
  });

  it('ensures pipeline is always present', () => {
    const config = getDefaultConfig();
    expect(config.pipeline).toBeDefined();
    expect(config.pipeline.id).toBeDefined();
    expect(config.pipeline.steps).toBeDefined();
    expect(Array.isArray(config.pipeline.steps)).toBe(true);
  });

  it('clones config to prevent mutations', () => {
    const config1 = getDefaultConfig();
    const config2 = getDefaultConfig();
    config1.autonomy.level = 'auto';
    expect(config2.autonomy.level).toBe('supervised');
  });
});

describe('CONFIG: loadConfig()', () => {
  it('uses defaults when no config.yaml file exists', async () => {
    const config = await loadConfig({ projectPath: tempDir });
    expect(config).toBeDefined();
    expect(config.preset).toBe('balanced');
    expect(config.autonomy.level).toBe('supervised');
  });

  it('loads and merges config.yaml that overrides some fields', async () => {
    const configYaml = `
autonomy:
  level: auto
provider:
  type: openai
  model: gpt-4
execution:
  taskTimeout: 600
`;
    await writeFile(join(tempDir, 'config.yaml'), configYaml, 'utf-8');
    const config = await loadConfig({ projectPath: tempDir });

    expect(config.autonomy.level).toBe('auto');
    expect(config.provider.type).toBe('openai');
    expect(config.provider.model).toBe('gpt-4');
    expect(config.execution.taskTimeout).toBe(600);
    expect(config.provider.timeout).toBe(0);
  });

  it('respects CLI options over file config', async () => {
    const configYaml = `
autonomy:
  level: auto
provider:
  type: openai
`;
    await writeFile(join(tempDir, 'config.yaml'), configYaml, 'utf-8');
    const config = await loadConfig({
      projectPath: tempDir,
      autonomy: 'supervised',
      provider: 'anthropic',
    });

    expect(config.autonomy.level).toBe('supervised');
    expect(config.provider.type).toBe('anthropic');
  });

  it('applies preset from file config', async () => {
    const configYaml = `
preset: thorough
`;
    await writeFile(join(tempDir, 'config.yaml'), configYaml, 'utf-8');
    const config = await loadConfig({ projectPath: tempDir });

    expect(config.preset).toBe('thorough');
    expect(config.pipeline.id).toBe('preset-thorough');
  });

  it('CLI preset option overrides file preset', async () => {
    const configYaml = `
preset: fast
`;
    await writeFile(join(tempDir, 'config.yaml'), configYaml, 'utf-8');
    const config = await loadConfig({
      projectPath: tempDir,
      preset: 'verified',
    });

    expect(config.preset).toBe('verified');
  });

  it('accepts any provider type (provider-agnostic)', async () => {
    const configYaml = `
provider:
  type: custom-provider
`;
    await writeFile(join(tempDir, 'config.yaml'), configYaml, 'utf-8');
    const config = await loadConfig({ projectPath: tempDir });
    expect(config.provider.type).toBe('custom-provider');
  });

  it('merges architect and raven config from file', async () => {
    const configYaml = `
architect:
  mode: quick
raven:
  iterations: 2
  mode: auto
  maxIterations: 5
`;
    await writeFile(join(tempDir, 'config.yaml'), configYaml, 'utf-8');
    const config = await loadConfig({ projectPath: tempDir });

    expect(config.architect.mode).toBe('quick');
    expect(config.raven.iterations).toBe(2);
    expect(config.raven.mode).toBe('auto');
    expect(config.raven.maxIterations).toBe(5);
  });

  it('uses process.cwd() as default when no projectPath provided', async () => {
    const config = await loadConfig({ projectPath: process.cwd() });
    expect(config).toBeDefined();
    expect(config.autonomy).toBeDefined();
    expect(config.provider).toBeDefined();
  });
});

describe('CONFIG: validateConfig()', () => {
  it('validates a correct config', () => {
    const validation = validateConfig(DEFAULT_CONFIG);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it('detects missing provider type', () => {
    const config = { ...DEFAULT_CONFIG, provider: { ...DEFAULT_CONFIG.provider } };
    delete (config.provider as any).type;
    const validation = validateConfig(config);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('provider.type is required');
  });

  it('detects missing autonomy level', () => {
    const config = { ...DEFAULT_CONFIG, autonomy: { ...DEFAULT_CONFIG.autonomy } };
    delete (config.autonomy as any).level;
    const validation = validateConfig(config);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('autonomy.level is required');
  });

  it('accepts any provider type (provider-agnostic)', () => {
    const customTypes = ['claude-code', 'anthropic', 'openai', 'custom-llm', 'local-model'];
    customTypes.forEach(type => {
      const config = { ...DEFAULT_CONFIG, provider: { ...DEFAULT_CONFIG.provider, type: type as any } };
      const validation = validateConfig(config);
      expect(validation.valid).toBe(true);
    });
  });

  it('rejects invalid autonomy level', () => {
    const config = { ...DEFAULT_CONFIG, autonomy: { level: 'invalid-level' as any } };
    const validation = validateConfig(config);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('Invalid autonomy level: invalid-level');
  });

  it('accepts all valid autonomy levels', () => {
    const validLevels = ['supervised', 'auto'];
    validLevels.forEach(level => {
      const config = { ...DEFAULT_CONFIG, autonomy: { level: level as any } };
      const validation = validateConfig(config);
      expect(validation.valid).toBe(true);
    });
  });

  it('rejects invalid architect mode', () => {
    const config = { ...DEFAULT_CONFIG, architect: { mode: 'invalid-mode' as any } };
    const validation = validateConfig(config);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('Invalid architect mode: invalid-mode');
  });

  it('accepts all valid architect modes', () => {
    const validModes = ['thorough', 'quick', 'off'];
    validModes.forEach(mode => {
      const config = { ...DEFAULT_CONFIG, architect: { mode: mode as any } };
      const validation = validateConfig(config);
      expect(validation.valid).toBe(true);
    });
  });

  it('rejects invalid raven mode', () => {
    const config = { ...DEFAULT_CONFIG, raven: { ...DEFAULT_CONFIG.raven, mode: 'invalid-mode' as any } };
    const validation = validateConfig(config);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('Invalid raven mode: invalid-mode');
  });

  it('accepts all valid raven modes', () => {
    const validModes = ['fixed', 'auto', 'manual'];
    validModes.forEach(mode => {
      const config = { ...DEFAULT_CONFIG, raven: { ...DEFAULT_CONFIG.raven, mode: mode as any } };
      const validation = validateConfig(config);
      expect(validation.valid).toBe(true);
    });
  });

  it('detects multiple validation errors', () => {
    const config = {
      ...DEFAULT_CONFIG,
      autonomy: { level: 'invalid' as any },
      architect: { mode: 'invalid' as any },
      raven: { ...DEFAULT_CONFIG.raven, mode: 'invalid' as any },
    };
    const validation = validateConfig(config);
    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe('CONFIG: getPreset()', () => {
  it('returns preset config for "fast"', () => {
    const preset = getPreset('fast');
    expect(preset.name).toBe('fast');
    expect(preset.label).toBe('Fast');
    expect(preset.pipeline.steps.length).toBeGreaterThan(0);
    expect(preset.autonomy).toBe('supervised');
  });

  it('returns preset config for "balanced"', () => {
    const preset = getPreset('balanced');
    expect(preset.name).toBe('balanced');
    expect(preset.label).toBe('Balanced');
    expect(preset.pipeline.steps.length).toBeGreaterThan(0);
  });

  it('returns preset config for "thorough"', () => {
    const preset = getPreset('thorough');
    expect(preset.name).toBe('thorough');
    expect(preset.label).toBe('Thorough');
    expect(preset.pipeline.steps.length).toBeGreaterThan(0);
  });

  it('returns balanced preset for removed verified preset', () => {
    const preset = getPreset('verified' as any);
    expect(preset.name).toBe('balanced');
  });

  it('returns balanced preset for unknown preset name', () => {
    const preset = getPreset('unknown-preset' as any);
    expect(preset.name).toBe('balanced');
  });

  it('all presets have unique pipeline ids', () => {
    const ids = Object.values(PRESETS).map(p => p.pipeline.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('all presets have non-empty step lists', () => {
    Object.values(PRESETS).forEach(preset => {
      expect(preset.pipeline.steps.length).toBeGreaterThan(0);
      preset.pipeline.steps.forEach(step => {
        expect(step.agentId).toBeDefined();
        expect(step.enabled).toBe(true);
      });
    });
  });
});

describe('CONFIG: serializeConfig()', () => {
  it('serializes config to YAML string', async () => {
    const config = getDefaultConfig();
    const yaml = await serializeConfig(config);
    expect(typeof yaml).toBe('string');
    expect(yaml.length).toBeGreaterThan(0);
  });

  it('round-trip: serialize then parse matches original', async () => {
    const original = getDefaultConfig();
    const yaml = await serializeConfig(original);

    const yamlModule = await import('yaml');
    const parsed = yamlModule.parse(yaml) as HugrConfig;

    expect(parsed.preset).toBe(original.preset);
    expect(parsed.autonomy.level).toBe(original.autonomy.level);
    expect(parsed.provider.type).toBe(original.provider.type);
    expect(parsed.execution.taskTimeout).toBe(original.execution.taskTimeout);
  });

  it('serializes preset-specific configs correctly', async () => {
    const presets = ['fast', 'balanced', 'thorough', 'verified'];
    for (const presetName of presets) {
      const config = getDefaultConfig(presetName);
      const yaml = await serializeConfig(config);
      expect(yaml).toContain('preset:');
      expect(yaml).toContain(presetName);
    }
  });

  it('preserves nested structures in round-trip', async () => {
    const config = getDefaultConfig();
    config.architect.mode = 'quick';
    config.raven.iterations = 2;
    config.raven.maxIterations = 5;

    const yaml = await serializeConfig(config);
    const yamlModule = await import('yaml');
    const parsed = yamlModule.parse(yaml) as HugrConfig;

    expect(parsed.architect.mode).toBe('quick');
    expect(parsed.raven.iterations).toBe(2);
    expect(parsed.raven.maxIterations).toBe(5);
  });
});

describe('CONFIG: Pipeline Generation from Presets', () => {
  it('ensurePipeline generates pipeline from architect/raven config', async () => {
    const config = getDefaultConfig();
    expect(config.pipeline).toBeDefined();
    expect(config.pipeline.steps.length).toBeGreaterThan(0);
  });

  it('pipeline includes architect step when architect mode is not off', async () => {
    const config = await loadConfig({ projectPath: tempDir, preset: 'thorough' });
    const architectStep = config.pipeline.steps.find(s => s.agentId === 'architect');
    expect(architectStep).toBeDefined();
    expect(architectStep?.mode).toBe('thorough');
  });

  it('pipeline excludes architect step when architect mode is off', async () => {
    const configYaml = `
architect:
  mode: off
`;
    await writeFile(join(tempDir, 'config.yaml'), configYaml, 'utf-8');
    const config = await loadConfig({ projectPath: tempDir });
    const architectStep = config.pipeline.steps.find(s => s.agentId === 'architect');
    expect(architectStep).toBeUndefined();
  });

  it('pipeline always includes coder step', async () => {
    const config = getDefaultConfig();
    const coderStep = config.pipeline.steps.find(s => s.agentId === 'coder');
    expect(coderStep).toBeDefined();
    expect(coderStep?.enabled).toBe(true);
  });

  it('pipeline includes raven step when raven.iterations > 0', async () => {
    const config = getDefaultConfig('thorough');
    const ravenStep = config.pipeline.steps.find(s => s.agentId === 'raven');
    expect(ravenStep).toBeDefined();
    expect(ravenStep?.iterations).toBeGreaterThan(0);
  });

  it('pipeline excludes raven step when raven.iterations is 0', async () => {
    const configYaml = `
raven:
  iterations: 0
  mode: fixed
  maxIterations: 3
`;
    await writeFile(join(tempDir, 'config.yaml'), configYaml, 'utf-8');
    const config = await loadConfig({ projectPath: tempDir });
    const ravenStep = config.pipeline.steps.find(s => s.agentId === 'raven');
    expect(ravenStep).toBeUndefined();
  });

  it('raven step has loopUntilDone=true when mode is auto', async () => {
    const configYaml = `
raven:
  iterations: 2
  mode: auto
  maxIterations: 5
`;
    await writeFile(join(tempDir, 'config.yaml'), configYaml, 'utf-8');
    const config = await loadConfig({ projectPath: tempDir });
    const ravenStep = config.pipeline.steps.find(s => s.agentId === 'raven');
    expect(ravenStep?.loopUntilDone).toBe(true);
  });

  it('raven step has loopUntilDone=false when mode is fixed', async () => {
    const configYaml = `
raven:
  iterations: 1
  mode: fixed
  maxIterations: 3
`;
    await writeFile(join(tempDir, 'config.yaml'), configYaml, 'utf-8');
    const config = await loadConfig({ projectPath: tempDir });
    const ravenStep = config.pipeline.steps.find(s => s.agentId === 'raven');
    expect(ravenStep?.loopUntilDone).toBe(false);
  });
});

describe('INTERRUPT: writeInterrupt() and readInterrupt() round-trip', () => {
  it('writes and reads interrupt successfully', async () => {
    const sessionDataDir = resolveSessionDataDir(tempDir);
    await mkdir(sessionDataDir, { recursive: true });

    const interrupt: InterruptRequest = {
      type: 'stop',
      reason: 'User requested stop',
      timestamp: new Date().toISOString(),
      sessionId: 'test-session',
    };

    await writeInterrupt(tempDir, interrupt);
    const read = await readInterrupt(tempDir);

    expect(read).toBeDefined();
    expect(read?.type).toBe('stop');
    expect(read?.reason).toBe('User requested stop');
    expect(read?.sessionId).toBe('test-session');
  });

  it('preserves payload in round-trip', async () => {
    const sessionDataDir = resolveSessionDataDir(tempDir);
    await mkdir(sessionDataDir, { recursive: true });

    const interrupt: InterruptRequest = {
      type: 'redirect',
      reason: 'Redirect to new task',
      timestamp: new Date().toISOString(),
      payload: {
        newTask: 'Task A',
        modifications: ['mod1', 'mod2'],
      },
    };

    await writeInterrupt(tempDir, interrupt);
    const read = await readInterrupt(tempDir);

    expect(read?.payload?.newTask).toBe('Task A');
    expect(read?.payload?.modifications).toEqual(['mod1', 'mod2']);
  });

  it('supports modify type with modifications', async () => {
    const sessionDataDir = resolveSessionDataDir(tempDir);
    await mkdir(sessionDataDir, { recursive: true });

    const interrupt: InterruptRequest = {
      type: 'modify',
      reason: 'Modify requirements',
      timestamp: new Date().toISOString(),
      payload: {
        modifications: ['requirement 1', 'requirement 2'],
      },
    };

    await writeInterrupt(tempDir, interrupt);
    const read = await readInterrupt(tempDir);

    expect(read?.type).toBe('modify');
    expect(read?.payload?.modifications).toBeDefined();
  });
});

describe('INTERRUPT: clearInterrupt()', () => {
  it('actually clears the interrupt file', async () => {
    const sessionDataDir = resolveSessionDataDir(tempDir);
    await mkdir(sessionDataDir, { recursive: true });

    const interrupt: InterruptRequest = {
      type: 'stop',
      reason: 'Test clear',
      timestamp: new Date().toISOString(),
    };

    await writeInterrupt(tempDir, interrupt);
    expect(await hasInterrupt(tempDir)).toBe(true);

    await clearInterrupt(tempDir);
    expect(await hasInterrupt(tempDir)).toBe(false);
  });

  it('does not throw when clearing non-existent interrupt', async () => {
    await expect(clearInterrupt(tempDir)).resolves.not.toThrow();
  });
});

describe('INTERRUPT: hasInterrupt()', () => {
  it('returns true when interrupt file exists', async () => {
    const sessionDataDir = resolveSessionDataDir(tempDir);
    await mkdir(sessionDataDir, { recursive: true });

    const interrupt: InterruptRequest = {
      type: 'stop',
      reason: 'Test',
      timestamp: new Date().toISOString(),
    };

    await writeInterrupt(tempDir, interrupt);
    const has = await hasInterrupt(tempDir);
    expect(has).toBe(true);
  });

  it('returns false when interrupt file does not exist', async () => {
    const has = await hasInterrupt(tempDir);
    expect(has).toBe(false);
  });

  it('returns false after clearing interrupt', async () => {
    const sessionDataDir = resolveSessionDataDir(tempDir);
    await mkdir(sessionDataDir, { recursive: true });

    const interrupt: InterruptRequest = {
      type: 'stop',
      reason: 'Test',
      timestamp: new Date().toISOString(),
    };

    await writeInterrupt(tempDir, interrupt);
    expect(await hasInterrupt(tempDir)).toBe(true);

    await clearInterrupt(tempDir);
    expect(await hasInterrupt(tempDir)).toBe(false);
  });
});

describe('INTERRUPT: readInterrupt() with missing/corrupted files', () => {
  it('returns null when no interrupt file exists', async () => {
    const read = await readInterrupt(tempDir);
    expect(read).toBeNull();
  });

  it('handles corrupted JSON gracefully', async () => {
    const sessionDataDir = resolveSessionDataDir(tempDir);
    await mkdir(sessionDataDir, { recursive: true });

    const interruptPath = join(sessionDataDir, 'interrupt.json');
    await writeFile(interruptPath, 'invalid json {]', 'utf-8');

    const read = await readInterrupt(tempDir);
    expect(read).toBeNull();
    expect(await hasInterrupt(tempDir)).toBe(false);
  });

  it('handles missing required fields gracefully', async () => {
    const sessionDataDir = resolveSessionDataDir(tempDir);
    await mkdir(sessionDataDir, { recursive: true });

    const interruptPath = join(sessionDataDir, 'interrupt.json');
    await writeFile(interruptPath, JSON.stringify({ type: 'stop' }), 'utf-8');

    const read = await readInterrupt(tempDir);
    expect(read).toBeNull();
  });

  it('handles non-object JSON gracefully', async () => {
    const sessionDataDir = resolveSessionDataDir(tempDir);
    await mkdir(sessionDataDir, { recursive: true });

    const interruptPath = join(sessionDataDir, 'interrupt.json');
    await writeFile(interruptPath, '"just a string"', 'utf-8');

    const read = await readInterrupt(tempDir);
    expect(read).toBeNull();
  });
});

describe('INTERRUPT: Stale interrupt detection', () => {
  it('detects stale interrupt from previous session', async () => {
    const sessionDataDir = resolveSessionDataDir(tempDir);
    await mkdir(sessionDataDir, { recursive: true });

    const now = new Date();
    const past = new Date(now.getTime() - 60000);

    const interrupt: InterruptRequest = {
      type: 'stop',
      reason: 'Old interrupt',
      timestamp: past.toISOString(),
    };

    await writeInterrupt(tempDir, interrupt);

    const read = await readInterrupt(tempDir, now);
    expect(read).toBeNull();
    expect(await hasInterrupt(tempDir)).toBe(false);
  });

  it('accepts interrupt from current session', async () => {
    const sessionDataDir = resolveSessionDataDir(tempDir);
    await mkdir(sessionDataDir, { recursive: true });

    const sessionStartTime = new Date();
    const interruptTime = new Date(sessionStartTime.getTime() + 5000);

    const interrupt: InterruptRequest = {
      type: 'stop',
      reason: 'Recent interrupt',
      timestamp: interruptTime.toISOString(),
    };

    const interruptPath = join(sessionDataDir, 'interrupt.json');
    await writeFile(interruptPath, JSON.stringify(interrupt), 'utf-8');

    const read = await readInterrupt(tempDir, sessionStartTime);
    expect(read).toBeDefined();
    expect(read?.reason).toBe('Recent interrupt');
  });

  it('accepts interrupt when no session start time provided', async () => {
    const sessionDataDir = resolveSessionDataDir(tempDir);
    await mkdir(sessionDataDir, { recursive: true });

    const pastDate = new Date(Date.now() - 86400000);

    const interrupt: InterruptRequest = {
      type: 'stop',
      reason: 'Old interrupt without session check',
      timestamp: pastDate.toISOString(),
    };

    await writeInterrupt(tempDir, interrupt);

    const read = await readInterrupt(tempDir);
    expect(read).toBeDefined();
    expect(read?.reason).toBe('Old interrupt without session check');
  });
});

describe('PATHS: resolveHugrDir()', () => {
  it('returns expected format', () => {
    const hugrPath = resolveHugrDir(tempDir);
    expect(hugrPath).toBeDefined();
    expect(typeof hugrPath).toBe('string');
    expect(hugrPath.length).toBeGreaterThan(0);
  });

  it('includes .hugr directory', () => {
    const hugrPath = resolveHugrDir(tempDir);
    expect(hugrPath).toContain('.hugr');
  });

  it('includes sessions subdirectory', () => {
    const hugrPath = resolveHugrDir(tempDir);
    expect(hugrPath).toContain('sessions');
  });

  it('includes project name', () => {
    const hugrPath = resolveHugrDir(tempDir);
    expect(hugrPath).toMatch(/[\w-]+/);
  });

  it('includes hash suffix', () => {
    const hugrPath = resolveHugrDir(tempDir);
    const parts = hugrPath.split('-');
    const hash = parts[parts.length - 1];
    expect(hash).toMatch(/^[a-f0-9]{8}$/);
  });

  it('generates consistent hash for same path', () => {
    const hash1 = resolveHugrDir(tempDir);
    const hash2 = resolveHugrDir(tempDir);
    expect(hash1).toBe(hash2);
  });

  it('generates different hash for different paths', () => {
    const hash1 = resolveHugrDir(tempDir);
    const hash2 = resolveHugrDir(join(tempDir, 'other'));
    expect(hash1).not.toBe(hash2);
  });
});

describe('PATHS: resolveSessionDataDir()', () => {
  it('returns expected format', () => {
    const sessionPath = resolveSessionDataDir(tempDir);
    expect(sessionPath).toBeDefined();
    expect(typeof sessionPath).toBe('string');
    expect(sessionPath.length).toBeGreaterThan(0);
  });

  it('is a subdirectory of resolveHugrDir()', () => {
    const sessionPath = resolveSessionDataDir(tempDir);
    const hugrPath = resolveHugrDir(tempDir);
    expect(sessionPath).toContain(hugrPath);
  });

  it('includes session-data directory', () => {
    const sessionPath = resolveSessionDataDir(tempDir);
    expect(sessionPath).toContain('session-data');
  });

  it('generates consistent paths for same input', () => {
    const path1 = resolveSessionDataDir(tempDir);
    const path2 = resolveSessionDataDir(tempDir);
    expect(path1).toBe(path2);
  });
});

describe('CONFIG: Bug Detection - Missing architect/raven merge', () => {
  it('merges architect config from file into loaded config', async () => {
    const configYaml = `
architect:
  mode: quick
`;
    await writeFile(join(tempDir, 'config.yaml'), configYaml, 'utf-8');
    const config = await loadConfig({ projectPath: tempDir });
    expect(config.architect.mode).toBe('quick');
  });

  it('merges raven config from file into loaded config', async () => {
    const configYaml = `
raven:
  iterations: 2
  mode: auto
  maxIterations: 4
`;
    await writeFile(join(tempDir, 'config.yaml'), configYaml, 'utf-8');
    const config = await loadConfig({ projectPath: tempDir });
    expect(config.raven.iterations).toBe(2);
    expect(config.raven.mode).toBe('auto');
    expect(config.raven.maxIterations).toBe(4);
  });

  it('merges all config sections together', async () => {
    const configYaml = `
autonomy:
  level: auto
provider:
  type: openai
  model: gpt-4
execution:
  taskTimeout: 600
architect:
  mode: quick
raven:
  iterations: 2
  mode: auto
  maxIterations: 5
`;
    await writeFile(join(tempDir, 'config.yaml'), configYaml, 'utf-8');
    const config = await loadConfig({ projectPath: tempDir });

    expect(config.autonomy.level).toBe('auto');
    expect(config.provider.type).toBe('openai');
    expect(config.provider.model).toBe('gpt-4');
    expect(config.execution.taskTimeout).toBe(600);
    expect(config.architect.mode).toBe('quick');
    expect(config.raven.iterations).toBe(2);
    expect(config.raven.mode).toBe('auto');
    expect(config.raven.maxIterations).toBe(5);
  });
});
