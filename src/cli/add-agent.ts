import { Command } from 'commander';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { join, resolve } from 'path';

export const addAgentCommand = new Command('add-agent')
  .argument('<name>', 'Agent name')
  .option('--template <type>', 'Agent template (orchestrator, analyst, agent)', 'agent')
  .option('--org <org>', 'Organization name')
  .description('Add a new agent to the organization')
  .action(async (name: string, options: { template: string; org?: string }) => {
    const projectRoot = process.cwd();

    // Auto-detect org if not specified
    let org = options.org;
    if (!org) {
      const orgsDir = join(projectRoot, 'orgs');
      if (existsSync(orgsDir)) {
        const orgs = readdirSync(orgsDir, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => d.name);
        if (orgs.length === 1) {
          org = orgs[0];
        } else if (orgs.length > 1) {
          console.error('Multiple organizations found. Specify one with --org <name>');
          process.exit(1);
        }
      }
    }

    if (!org) {
      console.error('No organization found. Run "cortextos init <org>" first.');
      process.exit(1);
    }

    const agentDir = join(projectRoot, 'orgs', org, 'agents', name);
    if (existsSync(agentDir)) {
      console.error(`Agent "${name}" already exists at ${agentDir}`);
      process.exit(1);
    }

    console.log(`\nAdding agent: ${name}`);
    console.log(`  Template: ${options.template}`);
    console.log(`  Organization: ${org}`);
    console.log(`  Directory: ${agentDir}\n`);

    // Create agent directory
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(join(agentDir, 'memory'), { recursive: true });
    mkdirSync(join(agentDir, '.claude', 'skills'), { recursive: true });

    // Copy template files
    const templateDir = findTemplateDir(projectRoot, options.template);
    if (templateDir) {
      copyTemplateFiles(templateDir, agentDir, name, org);
      console.log(`  Copied template files from ${options.template}`);
    } else {
      // Create minimal files
      createMinimalAgent(agentDir, name, org, options.template);
      console.log('  Created minimal agent files');
    }

    // Create config.json
    const configPath = join(agentDir, 'config.json');
    if (!existsSync(configPath)) {
      writeFileSync(configPath, JSON.stringify({
        agent_name: name,
        startup_delay: 0,
        max_session_seconds: 255600,
        enabled: true,
        crons: [],
      }, null, 2) + '\n', 'utf-8');
    }

    // Create .env placeholder with helpful comments
    const envPath = join(agentDir, '.env');
    if (!existsSync(envPath)) {
      writeFileSync(envPath, [
        `# Agent environment for ${name}`,
        '#',
        '# BOT_TOKEN: Create a Telegram bot with @BotFather and paste the token here',
        '# CHAT_ID: Send a message to your bot, then run:',
        '#   curl -s "https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates" | jq \'.result[-1].message.chat.id\'',
        '#',
        'BOT_TOKEN=',
        'CHAT_ID=',
        '',
      ].join('\n'), 'utf-8');
    }

    // Generate SYSTEM.md from context.json (static org context only).
    // This overwrites whatever the template wrote — context.json is the source of truth.
    // Dynamic data (agent roster, health) is discovered live via list-agents + read-all-heartbeats.
    const contextPath = join(projectRoot, 'orgs', org, 'context.json');
    if (existsSync(contextPath)) {
      try {
        const ctx = JSON.parse(readFileSync(contextPath, 'utf-8'));
        const orgName = ctx.name || org;
        const timezone = ctx.timezone || 'UTC';
        const orchestrator = ctx.orchestrator || '(not set)';
        const dashboardUrl = ctx.dashboard_url || '(not configured)';
        const systemMd = [
          '# System Context',
          '',
          `**Organization:** ${orgName}`,
          `**Timezone:** ${timezone}`,
          `**Orchestrator:** ${orchestrator}`,
          `**Dashboard:** ${dashboardUrl}`,
          '**Framework:** cortextOS Node.js',
          '',
          '---',
          '',
          'This file contains static org context only. For the live agent roster, run:',
          '```bash',
          'cortextos list-agents',
          '```',
          '',
          'For agent health (last heartbeat per agent), run:',
          '```bash',
          'cortextos bus read-all-heartbeats',
          '```',
          '',
        ].join('\n');
        writeFileSync(join(agentDir, 'SYSTEM.md'), systemMd, 'utf-8');
      } catch { /* leave template SYSTEM.md in place if context.json is unreadable */ }
    }

    // Update org context.json if this is the orchestrator
    if (options.template === 'orchestrator') {
      const contextPath = join(projectRoot, 'orgs', org, 'context.json');
      if (existsSync(contextPath)) {
        try {
          const context = JSON.parse(readFileSync(contextPath, 'utf-8'));
          if (!context.orchestrator) {
            context.orchestrator = name;
            writeFileSync(contextPath, JSON.stringify(context, null, 2) + '\n', 'utf-8');
          }
        } catch { /* ignore */ }
      }
    }

    console.log(`\n  Agent "${name}" created.`);
    console.log(`\n  Next steps:`);
    console.log(`    1. Edit ${join('orgs', org, 'agents', name, '.env')} with your Telegram settings`);
    console.log(`    2. Customize identity files (IDENTITY.md, SOUL.md, GOALS.md)`);
    console.log(`    3. Start: cortextos start ${name}\n`);
  });

function findTemplateDir(projectRoot: string, template: string): string | null {
  // Check for templates in the project
  const candidates = [
    join(projectRoot, 'templates', template),
    join(projectRoot, 'node_modules', 'cortextos', 'templates', template),
    // Relative to this file for development
    join(__dirname, '..', '..', 'templates', template),
  ];

  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return null;
}

function copyTemplateFiles(templateDir: string, agentDir: string, name: string, org: string): void {
  const files = readdirSync(templateDir);
  for (const file of files) {
    const srcPath = join(templateDir, file);
    const destPath = join(agentDir, file);
    try {
      const stat = require('fs').statSync(srcPath);
      if (stat.isFile()) {
        let content = readFileSync(srcPath, 'utf-8');
        // Replace template placeholders
        content = content.replace(/\{\{agent_name\}\}/g, name);
        content = content.replace(/\{\{org\}\}/g, org);
        content = content.replace(/\{\{current_timestamp\}\}/g, new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
        writeFileSync(destPath, content, 'utf-8');
      } else if (stat.isDirectory() && file !== 'node_modules') {
        mkdirSync(destPath, { recursive: true });
        copyTemplateFiles(srcPath, destPath, name, org);
      }
    } catch { /* skip files that can't be read */ }
  }
}

function createMinimalAgent(agentDir: string, name: string, org: string, template: string): void {
  const role = template === 'orchestrator' ? 'Orchestrator'
    : template === 'analyst' ? 'Analyst'
    : 'Agent';

  writeFileSync(join(agentDir, 'IDENTITY.md'), `# ${name}\n\nYou are ${name}, a ${role} for ${org}.\n`);
  writeFileSync(join(agentDir, 'SOUL.md'), `# Soul\n\nYou are helpful, precise, and proactive.\n`);
  writeFileSync(join(agentDir, 'GOALS.md'), `# Goals\n\n- Awaiting goal configuration\n`);
  writeFileSync(join(agentDir, 'HEARTBEAT.md'), `# Heartbeat Checklist\n\n- [ ] Check inbox\n- [ ] Update heartbeat\n`);
  writeFileSync(join(agentDir, 'MEMORY.md'), `# Long-Term Memory\n\nNothing recorded yet.\n`);
  writeFileSync(join(agentDir, 'USER.md'), `# User Profile\n\nNot configured yet.\n`);
  writeFileSync(join(agentDir, 'SYSTEM.md'), `# System Context\n\nOrganization: ${org}\n`);
  writeFileSync(join(agentDir, 'TOOLS.md'), `# Available Tools\n\nUse \`cortextos bus <command>\` for bus operations.\n`);
  writeFileSync(join(agentDir, 'CLAUDE.md'), createClaudeMd(name, org, template));
}

function createClaudeMd(name: string, org: string, template: string): string {
  return `# cortextOS ${template.charAt(0).toUpperCase() + template.slice(1)}

## BOOTSTRAP PROTOCOL - READ EVERY FILE BEFORE DOING ANYTHING

Read these files at the start of EVERY session:
1. IDENTITY.md
2. SOUL.md
3. GOALS.md
4. HEARTBEAT.md
5. MEMORY.md
6. memory/$(date -u +%Y-%m-%d).md (today's session state)
7. TOOLS.md
8. SYSTEM.md
9. config.json
10. USER.md

## Bus Commands

Send messages: \`cortextos bus send-message <agent> <priority> "<text>"\`
Check inbox: \`cortextos bus check-inbox\`
ACK messages: \`cortextos bus ack-inbox <id>\`
Create tasks: \`cortextos bus create-task "<title>" --assignee <agent> --priority <p>\`
Update tasks: \`cortextos bus update-task <id> <status>\`
Complete tasks: \`cortextos bus complete-task <id> --result "<text>"\`
Log events: \`cortextos bus log-event <category> <event> <severity>\`
Update heartbeat: \`cortextos bus update-heartbeat "<status>"\`
Send Telegram: \`cortextos bus send-telegram <chat_id> "<text>"\`
`;
}
