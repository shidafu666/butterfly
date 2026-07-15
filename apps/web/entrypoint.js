#!/usr/bin/env node
// PID-1 supervisor for the merged butterfly/web container.
// Launches NestJS backend (127.0.0.1:3001) and Next.js frontend (0.0.0.0:3000).
// - Forwards SIGTERM / SIGINT to both children.
// - Exits the container when EITHER child exits (fail-fast).
'use strict';

const { spawn } = require('child_process');

let exiting = false;

function launch(label, cmd, args, cwd, extraEnv) {
  const proc = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
  });

  proc.on('error', (err) => {
    console.error(`[entrypoint] ${label} spawn error: ${err.message}`);
    if (!exiting) teardown(1);
  });

  proc.on('exit', (code, signal) => {
    if (exiting) return;
    console.error(
      `[entrypoint] ${label} exited (code=${code ?? 'null'}, signal=${signal ?? 'null'}); terminating container`,
    );
    teardown(code ?? 1);
  });

  return proc;
}

function appendNodeOption(current, option) {
  return [current, option].filter(Boolean).join(' ');
}

// Backend: NestJS bound to loopback only; Next.js proxies /api and /health.
const backend = launch('backend', 'node', ['dist/main.js'], '/app', {
  PORT: '3001',
  HOST: '127.0.0.1',
});

// Frontend: Next.js standalone, listening on all interfaces.
// BACKEND_ORIGIN is fixed to loopback so the server-side rewrite works.
const frontend = launch('frontend', 'node', ['apps/frontend/server.js'], '/frontend', {
  PORT: '3000',
  HOSTNAME: '0.0.0.0',
  BACKEND_ORIGIN: 'http://127.0.0.1:3001',
  NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS, '--require=/next-server-timeouts.js'),
});

function teardown(exitCode) {
  exiting = true;
  try { backend.kill('SIGTERM'); } catch (_) {}
  try { frontend.kill('SIGTERM'); } catch (_) {}
  // Give children 5 s to finish before forcing exit.
  setTimeout(() => process.exit(exitCode), 5000).unref();
}

process.on('SIGTERM', () => {
  console.log('[entrypoint] SIGTERM received, forwarding to children');
  teardown(0);
});

process.on('SIGINT', () => {
  console.log('[entrypoint] SIGINT received, forwarding to children');
  teardown(0);
});
