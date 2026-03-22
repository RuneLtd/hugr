import { NextResponse } from 'next/server';
import { execSync } from 'child_process';

export async function GET() {
  let claudeCodeAvailable = false;
  let claudeCodeVersion: string | undefined;

  try {
    const result = execSync('claude --version 2>/dev/null', { encoding: 'utf-8', timeout: 5000 });
    claudeCodeAvailable = true;
    claudeCodeVersion = result.trim();
  } catch {
    try {
      execSync('which claude 2>/dev/null', { encoding: 'utf-8', timeout: 3000 });
      claudeCodeAvailable = true;
    } catch {}
  }

  return NextResponse.json({
    claudeCode: {
      available: claudeCodeAvailable,
      version: claudeCodeVersion,
    },
  });
}
