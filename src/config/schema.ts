
export type BuiltInPresetName = 'fast' | 'balanced' | 'thorough' | 'verified';
export type PresetName = BuiltInPresetName | (string & {});

export type AutonomyLevel = 'supervised' | 'auto';

export interface AutonomyConfig {
  level: AutonomyLevel;
}

export type ProviderType = 'claude-code' | (string & {});

export interface ProviderConfig {
  type: ProviderType;

  url?: string;
  model?: string;
  apiKey?: string;

  timeout?: number;
  maxRetries?: number;
}

export interface ExecutionConfig {

  taskTimeout: number;

  autoResume?: boolean;

  agentTeams?: boolean;
}

export type ArchitectMode = 'thorough' | 'quick' | 'off';

export interface ArchitectConfig {

  mode: ArchitectMode;
}

export type RavenMode = 'fixed' | 'auto' | 'manual';

export interface RavenPresetConfig {

  iterations: number;

  mode: RavenMode;

  maxIterations: number;
}

export type BuiltInAgentId = 'architect' | 'coder' | 'raven' | 'reviewer';
export type AgentId = BuiltInAgentId | (string & {});

export type ToolAccessLevel = 'full' | 'read-only' | 'read-write-no-bash';

export type AgentToolName = 'Read' | 'Write' | 'Edit' | 'Bash' | 'Glob' | 'Grep' | 'WebSearch' | 'WebFetch' | (string & {});

export type AgentModelChoice = 'sonnet' | 'opus';

export interface CustomAgentConfig {

  name: string;

  instructions: string;

  toolAccess: ToolAccessLevel;

  allowedTools?: AgentToolName[];

  model?: AgentModelChoice;

  temperature?: number;

  selfReview?: boolean;

  canLoop?: boolean;

  maxLoops?: number;

  skills?: string[];

  color?: string;

  role?: string;

  handoffMessage?: string;
}

export interface PipelineStep {

  agentId: AgentId;

  mode?: string;

  iterations?: number;

  loopUntilDone?: boolean;

  manualPause?: boolean;

  maxIterations?: number;

  enabled: boolean;

  agentConfig?: CustomAgentConfig;
}

export interface PipelineConfig {

  id: string;

  name: string;

  steps: PipelineStep[];

  description?: string;
}

export interface HugrConfig {
  preset: PresetName;
  autonomy: AutonomyConfig;
  provider: ProviderConfig;
  execution: ExecutionConfig;

  architect: ArchitectConfig;

  raven: RavenPresetConfig;

  pipeline?: PipelineConfig;
}

export type PartialHugrConfig = {
  preset?: PresetName;
  autonomy?: Partial<AutonomyConfig>;
  provider?: Partial<ProviderConfig>;
  execution?: Partial<ExecutionConfig>;
  architect?: Partial<ArchitectConfig>;
  raven?: Partial<RavenPresetConfig>;
  pipeline?: PipelineConfig;
};

export type IsolationMode = 'full' | 'lightweight' | 'none' | (string & {});

export interface SessionImage {
    id: string;
    name: string;
    mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
    base64: string;
}

export interface SessionFile {
    id: string;
    name: string;
    size: number;
    mimeType: string;
    base64: string;
}
