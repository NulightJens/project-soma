import { Command } from 'commander';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

export const ecosystemCommand = new Command('ecosystem')
  .option('--instance <id>', 'Instance ID', 'default')
  .option('--org <name>', 'Organization name (auto-detected if not specified)')
  .option('--output <path>', 'Output file', 'ecosystem.config.js')
  .description('Generate PM2 ecosystem.config.js from agent configs')
  .action(async (options: { instance: string; org?: string; output: string }) => {
    const ctxRoot = join(homedir(), '.cortextos', options.instance);
    // BUG-035 (companion fix): same project-root discovery as enable-agent.ts
    // so `cortextos ecosystem` works from outside ~/cortextos.
    let projectRoot: string;
    if (process.env.CTX_FRAMEWORK_ROOT) {
      projectRoot = process.env.CTX_FRAMEWORK_ROOT;
    } else if (process.env.CTX_PROJECT_ROOT) {
      projectRoot = process.env.CTX_PROJECT_ROOT;
    } else {
      const canonical = join(homedir(), 'SOMA');
      projectRoot = existsSync(join(canonical, 'orgs')) ? canonical : process.cwd();
    }

    // Find all agents
    const agents: Array<{ name: string; dir: string; org?: string }> = [];

    // Scan orgs/*/agents/*
    const orgsDir = join(projectRoot, 'orgs');
    if (existsSync(orgsDir)) {
      for (const org of readdirSync(orgsDir, { withFileTypes: true })) {
        if (!org.isDirectory()) continue;
        const agentsDir = join(orgsDir, org.name, 'agents');
        if (!existsSync(agentsDir)) continue;
        for (const agent of readdirSync(agentsDir, { withFileTypes: true })) {
          if (!agent.isDirectory()) continue;
          agents.push({ name: agent.name, dir: join(agentsDir, agent.name), org: org.name });
        }
      }
    }

    if (agents.length === 0) {
      console.log('No agents found. Add agents first: cortextos add-agent <name>');
      return;
    }

    // Determine org: use --org flag, or auto-detect from first agent found
    const detectedOrg = options.org || agents.find(a => a.org)?.org || '';
    if (!detectedOrg) {
      console.error('Could not determine org. Use --org <name>.');
      return;
    }

    // Use dist/ in project root for all scripts
    const distDir = join(projectRoot, 'dist');
    const daemonScript = join(distDir, 'daemon.js');
    const dashboardDir = join(projectRoot, 'dashboard');
    // BUG-019 + cycle-2 finding: require BOTH package.json AND node_modules/.bin/next.
    // Without the second check, running `cortextos ecosystem` before
    // `npm install` in dashboard/ produces a crash-looped PM2 entry that the
    // user sees as "dashboard keeps restarting". Better to silently skip the
    // dashboard entry if its deps aren't installed yet — the user can re-run
    // `cortextos ecosystem` after `npm install` to add it.
    const hasDashboard = existsSync(join(dashboardDir, 'package.json')) &&
      existsSync(join(dashboardDir, 'node_modules', '.bin', 'next'));

    // BUG-002 fix: emit ecosystem.config.js as raw JS that resolves
    // process.env.CTX_INSTANCE_ID at PM2-startup time, not at generation time.
    // The previous JSON.stringify approach baked the instance id into the
    // generated file, so instance switching required regenerating the file.
    // Now: `CTX_INSTANCE_ID=other pm2 restart cortextos-daemon` just works.
    //
    // BUG-016 fix: bumped max_restarts from 10 to 50. PM2's max_restarts
    // controls how many times PM2 itself restarts cortextos-daemon if it
    // crashes — independent of in-daemon agent crash counting. 10 was too
    // low: a transient infrastructure wobble could exhaust retries before
    // the daemon stabilized. 50 leaves real headroom.
    //
    // BUG-019 fix: emit a SOMA-dashboard PM2 entry alongside the daemon
    // so the dashboard runs under PM2 supervision instead of as an orphan
    // `npm run dev &` background shell job started by /onboarding. Now it
    // gets restart-on-crash, log files in ~/.pm2/logs/, and reboot survival
    // via `pm2 startup`/`pm2 save`. The dashboard PM2 entry is only added
    // if dashboard/package.json exists (to keep the generator working in
    // minimal/test installs).
    const dashboardAppBlock = hasDashboard
      ? `,
    {
      name: 'SOMA-dashboard',
      script: 'npm',
      args: 'run dev',
      cwd: ${JSON.stringify(dashboardDir)},
      env: {
        PORT: process.env.PORT || '3000',
      },
      // Dashboard reads its real config from dashboard/.env.local — populated
      // by /onboarding Phase 7. PM2 just supervises the npm process.
      max_restarts: 50,
      restart_delay: 5000,
      autorestart: true,
    }`
      : '';

    // SOMA: Minions worker entry. Runs `cortextos jobs work` under PM2
    // so the queue drains even when nobody's at a terminal. Default
    // --handlers = echo,noop,sleep (always safe). Optional gated handlers:
    //   - `shell` — SOMA_ALLOW_SHELL_JOBS=1 (RCE surface).
    //   - `subagent` + `subagent_aggregator` — SOMA_ALLOW_SUBAGENT_JOBS=1
    //     (unified runner; spawns `claude -p` under the subscription engine
    //     by default per ADR-008; `data.engine='api'` is reserved but
    //     unimplemented until the API-engine follow-up slot lands).
    // To enable either in the PM2-supervised worker, add the name(s) to
    // SOMA_WORKER_HANDLERS AND set the matching env flag. Submitting jobs
    // under these protected names also requires a trusted submitter (CLI
    // --trusted flag); see src/minions/protected-names.ts. SIGKILL of the
    // worker triggers the Minions stall-rescue path in the queue (see
    // tests/minions-worker.test.ts).
    const cliScript = join(distDir, 'cli.js');
    const minionsDb = join(ctxRoot, 'minions.db');
    const jobsWorkerBlock = `,
    {
      name: 'cortextos-jobs-worker',
      script: ${JSON.stringify(cliScript)},
      args: [
        'jobs', 'work',
        '--instance', process.env.CTX_INSTANCE_ID || ${JSON.stringify(options.instance)},
        '--db', process.env.SOMA_MINIONS_DB || ${JSON.stringify(minionsDb)},
        '--queue', process.env.SOMA_WORKER_QUEUE || 'default',
        '--concurrency', process.env.SOMA_WORKER_CONCURRENCY || '1',
        '--handlers', process.env.SOMA_WORKER_HANDLERS || 'echo,noop,sleep',
      ],
      cwd: ${JSON.stringify(projectRoot)},
      env: {
        CTX_INSTANCE_ID: process.env.CTX_INSTANCE_ID || ${JSON.stringify(options.instance)},
      },
      max_restarts: 50,
      restart_delay: 5000,
      autorestart: true,
    }`;

    const content = `// AUTO-GENERATED by \`cortextos ecosystem\`. Do NOT edit by hand.
// Re-run \`cortextos ecosystem\` to regenerate.
//
// Note: env vars use process.env.X || 'default' so PM2 picks up the value
// from the calling shell at startup time. This means \`CTX_INSTANCE_ID=foo
// pm2 restart cortextos-daemon\` switches instances without regenerating.
module.exports = {
  apps: [
    {
      name: 'cortextos-daemon',
      script: ${JSON.stringify(daemonScript)},
      args: '--instance ' + (process.env.CTX_INSTANCE_ID || ${JSON.stringify(options.instance)}),
      cwd: ${JSON.stringify(projectRoot)},
      env: {
        CTX_INSTANCE_ID: process.env.CTX_INSTANCE_ID || ${JSON.stringify(options.instance)},
        CTX_ROOT: process.env.CTX_ROOT || ${JSON.stringify(ctxRoot)},
        CTX_FRAMEWORK_ROOT: ${JSON.stringify(projectRoot)},
        CTX_PROJECT_ROOT: ${JSON.stringify(projectRoot)},
        CTX_ORG: process.env.CTX_ORG || ${JSON.stringify(detectedOrg)},
      },
      max_restarts: 50,
      restart_delay: 5000,
      autorestart: true,
    }${dashboardAppBlock}${jobsWorkerBlock},
  ],
};
`;

    writeFileSync(options.output, content, 'utf-8');
    console.log(`Generated ${options.output} with daemon (manages ${agents.length} agents)${hasDashboard ? ' + dashboard' : ''} + jobs-worker`);
    console.log('\nStart with:');
    console.log(`  pm2 start ${options.output}`);
    console.log('  pm2 save');
  });
