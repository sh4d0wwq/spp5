import path from 'node:path';
import { spawn } from 'node:child_process';
import { ports, rootDir } from '../shared/paths.js';

const flags = ['--disable-warning=ExperimentalWarning'];
const children = [];
let shuttingDown = false;

function start(name, args) {
  const child = spawn(process.execPath, [...flags, ...args], { cwd: rootDir, stdio: 'inherit' });
  child.on('exit', (code, signal) => {
    if (!shuttingDown && code && code !== 0) {
      console.error(`[dev] ${name} завершился с кодом ${code}`);
      shutdown(code);
    } else if (!shuttingDown && signal) {
      console.error(`[dev] ${name} остановлен сигналом ${signal}`);
    }
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill();
  }
  setTimeout(() => process.exit(code), 400);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const services = [
  ['catalog', 'services/catalog/index.js'],
  ['artists', 'services/artists/index.js'],
  ['reviews', 'services/reviews/index.js'],
  ['platform', 'services/platform/index.js'],
];

for (const [name, file] of services) start(name, [file]);

try {
  await Promise.all([
    waitFor(ports.catalog),
    waitFor(ports.artists),
    waitFor(ports.reviews),
    waitFor(ports.platform),
  ]);
  start('gateway', ['gateway/index.js']);
  await waitFor(ports.gateway);
  const vite = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');
  start('client', [vite, '--config', 'client/vite.config.js', '--host', '127.0.0.1', '--port', String(ports.client)]);
  console.log(`\nATLAS готов: http://127.0.0.1:${ports.client}\nGraphQL:    http://127.0.0.1:${ports.gateway}/graphql\n`);
} catch (error) {
  console.error(`[dev] ${error.message}`);
  shutdown(1);
}

async function waitFor(port) {
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch { /* процесс ещё поднимается */ }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`сервис на порту ${port} не ответил на /health`);
}
