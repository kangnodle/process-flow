import assert from 'node:assert/strict';
import { test } from 'node:test';
import { access, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { launcherFixture, eventually } from './fixtures.mjs';

const shells =
  process.platform === 'win32'
    ? []
    : [
        {
          name: 'bash',
          script: 'dev.sh',
          shell: 'bash',
          flags: {
            memory: '--mem',
            backendPort: '--be-port',
            port: '--port',
            host: '--host',
            demo: '--demo',
            noInstall: '--no-install',
            noRun: '--no-run',
            help: '--help',
          },
        },
      ];
if (process.platform !== 'win32' && process.env.PWSH_PATH)
  shells.push({
    name: 'PowerShell',
    script: 'dev.ps1',
    shell: process.env.PWSH_PATH,
    flags: {
      memory: '-Mem',
      backendPort: '-BePort',
      port: '-Port',
      host: '-ListenHost',
      demo: '-Demo',
      noInstall: '-NoInstall',
      noRun: '-NoRun',
      help: '-Help',
    },
  });
if (process.platform === 'win32') test('launcher fixtures require POSIX process groups', { skip: true }, () => {});

for (const { name, script, shell, flags } of shells) {
  const frontendArguments = name === 'bash' ? ['--port', '41234', '--host'] : ['--host', '--port', '41234'];
  test(`${name}: missing binary gives a build command before any tool invocation`, async (t) => {
    const fixture = await launcherFixture({ binary: false });
    t.after(fixture.cleanup);
    const result = await fixture.start(script, [], {}, shell).done;
    assert.notEqual(result.code, 0, result.output);
    assert.match(result.output, /cargo build -p process-flow-server/);
    assert.deepEqual(await fixture.events(), []);
  });

  test(`${name}: help needs neither a binary nor tools`, async (t) => {
    const fixture = await launcherFixture({ binary: false });
    t.after(fixture.cleanup);
    const result = await fixture.start(script, [flags.help], {}, shell).done;
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /cargo build -p process-flow-server/);
    assert.deepEqual(await fixture.events(), []);
  });

  test(`${name}: backend-only runs from backend without Cargo or mise`, async (t) => {
    const fixture = await launcherFixture();
    t.after(fixture.cleanup);
    const result = await fixture.start(
      script,
      ['backend', flags.backendPort, '31234'],
      { FAKE_BACKEND_EXIT: '0' },
      shell,
    ).done;
    assert.equal(result.code, 0, result.output);
    const events = await fixture.events();
    assert.deepEqual(
      events.map((event) => event.kind),
      ['backend'],
    );
    assert.equal(events[0].cwd, `${fixture.root}/backend`);
    assert.equal(events[0].port, '31234');
  });

  test(`${name}: frontend-only retains preparation build and port options`, async (t) => {
    const fixture = await launcherFixture({ binary: false });
    t.after(fixture.cleanup);
    const result = await fixture.start(
      script,
      ['frontend', flags.port, '41234', flags.host, flags.demo],
      { FAKE_FRONTEND_EXIT: '0' },
      shell,
    ).done;
    assert.equal(result.code, 0, result.output);
    const events = await fixture.events();
    assert.equal(
      events.some((event) => event.kind === 'cargo' || event.kind === 'backend'),
      false,
    );
    assert.deepEqual(
      events.filter((event) => event.kind === 'mise' && event.args[0] === 'run').map((event) => event.args),
      [
        ['run', 'fe:install'],
        ['run', 'fe:build'],
        ['run', 'fe:dev', '--', ...frontendArguments],
      ],
    );
    assert.equal(events.find((event) => event.kind === 'frontend').demo, 'true');
  });

  test(`${name}: default starts both and cleans memory storage and children on interrupt`, async (t) => {
    const fixture = await launcherFixture();
    const running = fixture.start(
      script,
      [flags.memory, flags.backendPort, '31234', flags.port, '41234', flags.host, flags.demo, flags.noInstall],
      {},
      shell,
    );
    t.after(async () => {
      running.stop();
      await running.done;
      await fixture.cleanup();
    });
    const events = await eventually(
      fixture.events,
      (entries) =>
        entries.some((event) => event.kind === 'backend') && entries.some((event) => event.kind === 'frontend'),
    ).catch(async (error) => {
      error.message += `\n${running.output()}\n${JSON.stringify(await fixture.events())}`;
      throw error;
    });
    const backend = events.find((event) => event.kind === 'backend');
    assert.equal(backend.cwd, `${fixture.root}/backend`);
    assert.equal(backend.sqlite, 'sqlite::memory:');
    assert.equal(backend.port, '31234');
    const frontend = events.find((event) => event.kind === 'frontend');
    assert.deepEqual(frontend.args, ['run', 'fe:dev', '--', ...frontendArguments]);
    assert.equal(frontend.demo, 'true');
    assert.equal(
      events.some((event) => event.kind === 'cargo'),
      false,
    );
    assert.equal(
      events.some((event) => event.kind === 'mise' && event.args.some((arg) => /^(be:|install$|build$)/.test(arg))),
      false,
    );
    running.stop();
    await running.done;
    await eventually(
      fixture.events,
      (entries) =>
        entries.some((event) => event.kind === 'backend-stopped') &&
        entries.some((event) => event.kind === 'frontend-stopped'),
    );
    await assert.rejects(access(dirname(backend.lance)), { code: 'ENOENT' });
  });

  test(`${name}: backend failure stops the frontend and returns failure`, async (t) => {
    const fixture = await launcherFixture();
    t.after(fixture.cleanup);
    const running = fixture.start(script, [flags.noInstall], { FAKE_BACKEND_EXIT: '7' }, shell);
    const result = await running.done;
    assert.notEqual(result.code, 0, result.output);
    const events = await fixture.events();
    assert.equal(
      events.some((event) => event.kind === 'cargo'),
      false,
    );
    for (const event of events.filter((event) => event.kind === 'frontend'))
      assert.throws(() => process.kill(event.pid, 0), { code: 'ESRCH' });
  });

  test(`${name}: interrupt also stops descendants after their parent exits`, async (t) => {
    const fixture = await launcherFixture();
    const running = fixture.start(script, [flags.noInstall], { FAKE_FRONTEND_DESCENDANT: '1' }, shell);
    let descendant;
    t.after(async () => {
      running.stop();
      await running.done;
      if (descendant) {
        try {
          process.kill(descendant.pid, 'SIGKILL');
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
      await fixture.cleanup();
    });
    const events = await eventually(fixture.events, (entries) => entries.some((event) => event.kind === 'descendant'));
    descendant = events.find((event) => event.kind === 'descendant');
    running.stop();
    await running.done;
    await eventually(
      async () => {
        try {
          process.kill(descendant.pid, 0);
          return false;
        } catch (error) {
          if (error.code === 'ESRCH') return true;
          throw error;
        }
      },
      Boolean,
      5000,
    );
  });

  test(`${name}: no-run respects no-install and prepares only frontend`, async (t) => {
    const fixture = await launcherFixture();
    t.after(fixture.cleanup);
    const result = await fixture.start(script, [flags.noInstall, flags.noRun], {}, shell).done;
    assert.equal(result.code, 0, result.output);
    const events = await fixture.events();
    assert.deepEqual(
      events.filter((event) => event.kind === 'mise' && event.args[0] === 'run').map((event) => event.args),
      [['run', 'fe:build']],
    );
    assert.equal(
      events.some((event) => ['cargo', 'backend', 'frontend'].includes(event.kind)),
      false,
    );
  });

  test(`${name}: no-install reports missing frontend dependencies without installing`, async (t) => {
    const fixture = await launcherFixture();
    t.after(fixture.cleanup);
    await rm(`${fixture.root}/frontend/node_modules`, { recursive: true });
    const result = await fixture.start(script, [flags.noInstall, flags.noRun], {}, shell).done;
    assert.notEqual(result.code, 0, result.output);
    assert.match(result.output, /npm ci/);
    assert.equal(
      (await fixture.events()).some((event) => event.kind === 'cargo' || event.args?.[0] === 'run'),
      false,
    );
  });

  test(`${name}: frontend failure stops the backend`, async (t) => {
    const fixture = await launcherFixture();
    t.after(fixture.cleanup);
    const result = await fixture.start(script, [flags.noInstall], { FAKE_FRONTEND_EXIT: '9' }, shell).done;
    assert.notEqual(result.code, 0, result.output);
    const events = await fixture.events();
    for (const event of events.filter((event) => event.kind === 'backend'))
      assert.throws(() => process.kill(event.pid, 0), { code: 'ESRCH' });
  });

  test(`${name}: explicit target keeps backend aliases and no-run`, async (t) => {
    const fixture = await launcherFixture();
    t.after(fixture.cleanup);
    const target = name === 'bash' ? '--target' : '-Target';
    const result = await fixture.start(script, [target, 'api', flags.noRun], {}, shell).done;
    assert.equal(result.code, 0, result.output);
    assert.deepEqual(await fixture.events(), []);
  });

  test(`${name}: normal run script retains the backend build task`, async (t) => {
    const fixture = await launcherFixture({ binary: false });
    t.after(fixture.cleanup);
    const result = await fixture.start(
      name === 'bash' ? 'run.sh' : 'run.ps1',
      ['be', 'build', flags.noInstall],
      { FAKE_ALLOW_LEGACY: '1' },
      shell,
    ).done;
    assert.equal(result.code, 0, result.output);
    assert.deepEqual(
      (await fixture.events())
        .filter((event) => event.kind === 'mise' && event.args[0] === 'run')
        .map((event) => event.args),
      [['run', 'be:build']],
    );
  });

  test(`${name}: custom relative Cargo target directory resolves from backend`, async (t) => {
    const fixture = await launcherFixture({ targetDirectory: 'custom target' });
    t.after(fixture.cleanup);
    const result = await fixture.start(
      script,
      ['be'],
      { CARGO_TARGET_DIR: 'custom target', FAKE_BACKEND_EXIT: '0' },
      shell,
    ).done;
    assert.equal(result.code, 0, result.output);
    assert.equal((await fixture.events())[0].kind, 'backend');
  });

  if (name === 'PowerShell')
    test(`${name}: backend no-run clears an earlier native failure`, async (t) => {
      const fixture = await launcherFixture();
      t.after(fixture.cleanup);
      const result = await fixture.start(script, ['be', flags.noRun], {}, shell, 37).done;
      assert.equal(result.code, 0, result.output);
      assert.deepEqual(await fixture.events(), []);
    });
}
