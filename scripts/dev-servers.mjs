import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [backend, mise, ...frontendArguments] = process.argv.slice(2);

async function runServers() {
  if (!backend || !mise) throw new Error('Backend binary and mise executable are required.');
  await access(backend, constants.X_OK);
  const children = [];
  let stopping = false;
  let status = 0;
  let forceTimer;
  let forced = false;
  let finish;
  const completed = new Promise((resolve) => {
    finish = resolve;
  });

  const stopChild = (entry, force) => {
    if (!entry.process.pid) return;
    if (process.platform === 'win32') {
      if (entry.closed || entry.killer) return;
      const killer = spawn('taskkill', ['/PID', String(entry.process.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      entry.killer = killer;
      killer.on('error', (error) => {
        console.error(error.message);
        entry.process.kill();
      });
      killer.on('exit', (code) => {
        if (code) entry.process.kill();
      });
      return;
    }
    try {
      process.kill(-entry.process.pid, force ? 'SIGKILL' : 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') {
        console.error(error.message);
        status ||= 1;
      }
    }
  };

  const groupExists = (entry) => {
    if (!entry.process.pid) return false;
    try {
      process.kill(-entry.process.pid, 0);
      return true;
    } catch (error) {
      if (error.code === 'ESRCH') return false;
      throw error;
    }
  };

  const finishIfStopped = () => {
    if (!children.every((child) => child.closed)) return;
    if (!forced && process.platform !== 'win32' && children.some(groupExists)) return;
    clearTimeout(forceTimer);
    finish();
  };

  const shutdown = (code) => {
    if (stopping) return;
    stopping = true;
    status = code;
    for (const child of children) stopChild(child, false);
    forceTimer = setTimeout(() => {
      forced = true;
      for (const child of children) stopChild(child, true);
      finishIfStopped();
    }, 3000);
  };

  const start = (command, arguments_, cwd) => {
    const child = spawn(command, arguments_, {
      cwd,
      stdio: 'inherit',
      detached: process.platform !== 'win32',
    });
    const entry = { process: child, closed: false };
    children.push(entry);
    child.once('error', (error) => {
      console.error(error.message);
      shutdown(1);
    });
    child.once('close', (code, signal) => {
      entry.closed = true;
      shutdown(code ?? (signal === 'SIGINT' ? 130 : 143));
      finishIfStopped();
    });
  };

  const interrupted = () => shutdown(130);
  const terminated = () => shutdown(143);
  process.on('SIGINT', interrupted);
  process.on('SIGTERM', terminated);
  try {
    start(backend, [], resolve(root, 'backend'));
    start(mise, ['run', 'fe:dev', ...(frontendArguments.length ? ['--', ...frontendArguments] : [])], root);
    await completed;
    process.exitCode = status;
  } finally {
    process.off('SIGINT', interrupted);
    process.off('SIGTERM', terminated);
  }
}

runServers().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
