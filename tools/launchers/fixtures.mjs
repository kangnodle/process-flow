import { mkdtemp, mkdir, cp, writeFile, chmod, readFile, realpath, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const repository = fileURLToPath(new URL('../..', import.meta.url));

export async function launcherFixture({ binary = true, targetDirectory = 'target' } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'process flow launcher-')));
  await cp(join(repository, 'scripts'), join(root, 'scripts'), {
    recursive: true,
  });
  await mkdir(join(root, 'frontend/node_modules'), { recursive: true });
  await mkdir(join(root, 'backend'), { recursive: true });
  await writeFile(join(root, 'mise.toml'), '');
  const bin = join(root, 'fake bin');
  await mkdir(bin);
  const events = join(root, 'events.jsonl');
  const program = `#!${process.execPath}
const {appendFileSync}=require('node:fs');
const {spawn}=require('node:child_process');
const {basename}=require('node:path');
const args=process.argv.slice(2);
const name=basename(process.argv[1]);
const log=(event)=>appendFileSync(process.env.LAUNCHER_EVENTS,JSON.stringify({...event,pid:process.pid,cwd:process.cwd(),port:process.env.APP_PORT,sqlite:process.env.SQLITE_URL,lance:process.env.LANCEDB_URI,demo:process.env.VITE_DEMO})+'\\n');
if(name==='cargo'){log({kind:'cargo',args});process.exit(99);}
if(name==='mise'){
  log({kind:'mise',args});
  if(args[0]==='--version'){console.log('test-mise');process.exit(0);}
  if(args[0]==='trust'||args[0]==='which')process.exit(0);
  if(args[0]==='exec'){
    const command=args.slice(args.indexOf('--')+1);
    const child=spawn(command[0],command.slice(1),{stdio:'inherit'});
    for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{if(!child.killed)child.kill(signal);});
    child.on('error',()=>process.exit(98));
    child.on('exit',(code,signal)=>process.exit(code??(signal==='SIGINT'?130:143)));
  }else if(args[0]==='run'&&args[1]==='fe:dev'){
    log({kind:'frontend',args});
    if(process.env.FAKE_FRONTEND_DESCENDANT==='1')spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});require('node:fs').appendFileSync(process.env.LAUNCHER_EVENTS,JSON.stringify({kind:'descendant',pid:process.pid})+'\\\\n');setInterval(()=>{},1000)"],{stdio:'ignore'});
    if(process.env.FAKE_FRONTEND_EXIT!==undefined)process.exit(Number(process.env.FAKE_FRONTEND_EXIT));
    process.on('SIGTERM',()=>{log({kind:'frontend-stopped'});process.exit(0);});
    process.on('SIGINT',()=>{log({kind:'frontend-stopped'});process.exit(0);});
    setInterval(()=>{},1000);
  }else if(args[0]==='run'&&(['fe:install','fe:build'].includes(args[1])||process.env.FAKE_ALLOW_LEGACY==='1'))process.exit(0);
  else process.exit(97);
}else{
  log({kind:'backend',args});
  if(process.env.FAKE_BACKEND_EXIT!==undefined)process.exit(Number(process.env.FAKE_BACKEND_EXIT));
  process.on('SIGTERM',()=>{log({kind:'backend-stopped'});process.exit(0);});
  process.on('SIGINT',()=>{log({kind:'backend-stopped'});process.exit(0);});
  setInterval(()=>{},1000);
}
`;
  for (const name of ['mise', 'cargo']) {
    await writeFile(join(bin, name), program);
    await chmod(join(bin, name), 0o755);
  }
  const binaryPath = resolve(root, 'backend', targetDirectory, 'debug/process-flow-server');
  if (binary) {
    await mkdir(dirname(binaryPath), { recursive: true });
    await writeFile(binaryPath, program);
    await chmod(binaryPath, 0o755);
  }
  const environment = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    LAUNCHER_EVENTS: events,
  };
  return {
    root,
    binaryPath,
    async events() {
      try {
        return (await readFile(events, 'utf8'))
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line));
      } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
      }
    },
    start(script, args = [], extra = {}, shell = 'bash', initialExitCode) {
      const scriptPath = join(root, 'scripts', script);
      const quote = (value) => `'${value.replaceAll("'", "''")}'`;
      const shellArgs =
        shell === 'bash'
          ? [scriptPath, ...args]
          : initialExitCode === undefined
            ? ['-NoProfile', '-NonInteractive', '-File', scriptPath, ...args]
            : [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                `$global:LASTEXITCODE=${initialExitCode}; & ${quote(scriptPath)} ${args.map((value) => (value.startsWith('-') ? value : quote(value))).join(' ')}`,
              ];
      const child = spawn(shell, shellArgs, {
        cwd: tmpdir(),
        env: { ...environment, ...extra },
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (data) => {
        output += data;
      });
      child.stderr.on('data', (data) => {
        output += data;
      });
      const done = new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code, signal) => resolve({ code, signal, output }));
      });
      return {
        child,
        done,
        output: () => output,
        stop() {
          if (child.exitCode === null && child.signalCode === null) process.kill(-child.pid, 'SIGINT');
        },
      };
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

export async function eventually(read, predicate, timeout = 10000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = await read();
    if (predicate(value)) return value;
    await delay(20);
  }
  throw new Error('Launcher condition was not reached');
}
