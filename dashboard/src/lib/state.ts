import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const DEFAULT_HUGR_HOME = join(homedir(), '.hugr');
const CONFIG_FILE = join(DEFAULT_HUGR_HOME, 'dashboard-config.json');

function getHugrHome(): string {
  try {
    if (existsSync(CONFIG_FILE)) {
      const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
      if (raw.hugrHome && typeof raw.hugrHome === 'string') return raw.hugrHome;
    }
  } catch {}
  return DEFAULT_HUGR_HOME;
}

export function getDataPaths() {
  const hugrHome = getHugrHome();
  return {
    hugrHome,
    dashboardDir: join(hugrHome, 'dashboard'),
    sessionsDir: join(hugrHome, 'sessions'),
    stateFile: join(hugrHome, 'dashboard', 'state.json'),
    configFile: CONFIG_FILE,
  };
}

export function setHugrHome(newPath: string): void {
  mkdirSync(DEFAULT_HUGR_HOME, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify({ hugrHome: newPath }, null, 2), 'utf-8');
}

function getStateDir() { return getDataPaths().dashboardDir; }
function getStateFile() { return getDataPaths().stateFile; }

export interface PipelineStep {
  agentId: string;
  enabled: boolean;
  mode?: string;
  iterations?: number;
  maxIterations?: number;
  loopUntilDone?: boolean;
  selfReview?: boolean;
  skipGitTracking?: boolean;
}

export interface SavedPipeline {
  id: string;
  name: string;
  description?: string;
  steps: PipelineStep[];
}

export interface SessionRecord {
  id: string;
  task: string;
  projectPath?: string;
  status: string;
  pipeline: { name: string; steps: PipelineStep[] };
  startedAt: string;
  completedAt?: string;
  currentPhase: string;
  currentIteration: number;
  duration?: number;
  stepResults?: Array<{ agentName: string; summary: string }>;
}

export interface ActivityRecord {
  id: string;
  type: string;
  message: string;
  agentId: string;
  timestamp: string;
  details?: string;
}

export interface CustomAgentRecord {
  id: string;
  name: string;
  type: 'custom';
  description: string;
  systemPrompt?: string;
  tools?: string[];
  selfReview?: boolean;
  skipGitTracking?: boolean;
  createdAt?: string;
}

export interface DashboardState {
  pipelines: SavedPipeline[];
  sessions: SessionRecord[];
  activities: Record<string, ActivityRecord[]>;
  customAgents: CustomAgentRecord[];
  providerKeys: Record<string, { key: string; updatedAt: string }>;
}

const DEFAULT_STATE: DashboardState = {
  pipelines: [],
  sessions: [],
  activities: {},
  customAgents: [],
  providerKeys: {},
};

export function getDashboardState(): DashboardState {
  try {
    const stateFile = getStateFile();
    if (existsSync(stateFile)) {
      const raw = readFileSync(stateFile, 'utf-8');
      return { ...DEFAULT_STATE, ...JSON.parse(raw) };
    }
  } catch {}

  return { ...DEFAULT_STATE };
}

export function saveDashboardState(state: DashboardState): void {
  try {
    mkdirSync(getStateDir(), { recursive: true });
    writeFileSync(getStateFile(), JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save dashboard state:', err);
  }
}

