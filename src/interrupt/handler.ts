
import { readFile, writeFile, unlink, access } from 'fs/promises';
import { join } from 'path';
import { AGENT_OUTPUT_FILES } from '../constants.js';
import { resolveSessionDataDir } from '../paths.js';
import type { InterruptRequest } from './types.js';

function getInterruptPath(projectPath: string): string {
  return join(resolveSessionDataDir(projectPath), AGENT_OUTPUT_FILES.interrupt);
}

export async function writeInterrupt(
  projectPath: string,
  request: InterruptRequest
): Promise<void> {
  const interruptPath = getInterruptPath(projectPath);
  try {
    await writeFile(interruptPath, JSON.stringify(request, null, 2), 'utf-8');
    console.log(`   ⚡ Interrupt written: ${request.type} — ${request.reason}`);
  } catch (error) {
    console.error(`   ⚠️ Failed to write interrupt: ${error}`);
    throw error;
  }
}

export async function readInterrupt(
  projectPath: string,
  sessionStartTime?: Date
): Promise<InterruptRequest | null> {
  const interruptPath = getInterruptPath(projectPath);
  try {
    const content = await readFile(interruptPath, 'utf-8');
    let interrupt: unknown;

    try {
      interrupt = JSON.parse(content);
    } catch (parseError) {
      console.warn(`   ⚠️ Corrupt interrupt file, deleting: ${interruptPath}`);
      await clearInterrupt(projectPath);
      return null;
    }

    if (!isValidInterruptRequest(interrupt)) {
      console.warn(`   ⚠️ Invalid interrupt structure, deleting: ${interruptPath}`);
      await clearInterrupt(projectPath);
      return null;
    }

    if (sessionStartTime) {
      const interruptTime = new Date(interrupt.timestamp);
      if (interruptTime < sessionStartTime) {
        console.warn(`   ⚠️ Stale interrupt detected (from previous session), deleting: ${interruptPath}`);
        await clearInterrupt(projectPath);
        return null;
      }
    }

    return interrupt as InterruptRequest;
  } catch {
    return null;
  }
}

function isValidInterruptRequest(obj: unknown): obj is InterruptRequest {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }
  const req = obj as Record<string, unknown>;
  return (
    typeof req.type === 'string' &&
    typeof req.reason === 'string' &&
    typeof req.timestamp === 'string'
  );
}

export async function clearInterrupt(projectPath: string): Promise<void> {
  const interruptPath = getInterruptPath(projectPath);
  try {
    await unlink(interruptPath);
  } catch {

  }
}

export async function hasInterrupt(projectPath: string): Promise<boolean> {
  const interruptPath = getInterruptPath(projectPath);
  try {
    await access(interruptPath);
    return true;
  } catch {
    return false;
  }
}
