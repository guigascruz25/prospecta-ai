import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
config({ quiet: true });
mkdirSync('logs', { recursive: true });
const action = process.argv[2] === 'start' ? 'start' : 'dev';
const children = [
  spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), action, '--hostname', '127.0.0.1', '--port', process.env.APP_PORT || '3100'], { stdio: 'inherit' }),
  spawn(process.execPath, ['--import', 'tsx', resolve('src/worker/index.ts')], { stdio: 'inherit' })
];
writeFileSync('logs/processes.json', JSON.stringify({ launcher: process.pid, children: children.map(child => child.pid), root: resolve('.'), started: new Date().toISOString() }));
let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const child of children) {
  child.on('error', error => { console.error(error.message); close(1); });
  child.on('exit', code => close(code || 0));
}
process.on('SIGINT', () => close());
process.on('SIGTERM', () => close());
if (!existsSync('.env')) console.warn('Configuração local ausente. Usando modo de simulação.');
