#!/usr/bin/env node

import { execSync, spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardDir = join(__dirname, '..', 'dashboard');

const args = process.argv.slice(2);
const isDev = args.includes('--dev');
const portArg = args.find((a) => a.startsWith('--port='));
const port = portArg ? portArg.split('=')[1] : '3141';

if (!existsSync(join(dashboardDir, 'node_modules'))) {
  console.log('📦 Installing dashboard dependencies...');
  execSync('npm install', { cwd: dashboardDir, stdio: 'inherit' });
}

if (!isDev && !existsSync(join(dashboardDir, '.next'))) {
  console.log('🔨 Building dashboard...');
  execSync('npx next build', { cwd: dashboardDir, stdio: 'inherit' });
}

const command = isDev ? 'dev' : 'start';

console.log(`\n🚀 hugr dashboard starting on http://localhost:${port}\n`);

const child = spawn('npx', ['next', command, '--port', port], {
  cwd: dashboardDir,
  stdio: 'inherit',
  env: { ...process.env, FORCE_COLOR: '1' },
});

const openUrl = `http://localhost:${port}`;
setTimeout(() => {
  try {
    const platform = process.platform;
    if (platform === 'darwin') execSync(`open ${openUrl}`);
    else if (platform === 'linux') execSync(`xdg-open ${openUrl}`);
    else if (platform === 'win32') execSync(`start ${openUrl}`);
  } catch {}
}, 2000);

child.on('exit', (code) => process.exit(code ?? 0));

process.on('SIGINT', () => {
  child.kill('SIGINT');
  process.exit(0);
});

process.on('SIGTERM', () => {
  child.kill('SIGTERM');
  process.exit(0);
});
