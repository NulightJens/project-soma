import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { AgentConfig, AgentStatus, CtxEnv, BusPaths } from '../types/index.js';
import { AgentProcess } from './agent-process.js';
import { FastChecker } from './fast-checker.js';
import { TelegramAPI } from '../telegram/api.js';
import { TelegramPoller } from '../telegram/poller.js';
import { resolvePaths } from '../utils/paths.js';
import { resolveEnv } from '../utils/env.js';
import { logInboundMessage, cacheLastSent, logOutboundMessage } from '../telegram/logging.js';
import { collectTelegramCommands, registerTelegramCommands } from '../bus/metrics.js';

/**
 * Manages all agents in a cortextOS instance.
 */
export class AgentManager {
  private agents: Map<string, { process: AgentProcess; checker: FastChecker }> = new Map();
  private instanceId: string;
  private ctxRoot: string;
  private frameworkRoot: string;
  private org: string;

  constructor(instanceId: string, ctxRoot: string, frameworkRoot: string, org: string) {
    this.instanceId = instanceId;
    this.ctxRoot = ctxRoot;
    this.frameworkRoot = frameworkRoot;
    this.org = org;
  }

  /**
   * Discover and start all enabled agents.
   */
  async discoverAndStart(): Promise<void> {
    const agentDirs = this.discoverAgents();
    for (const { name, dir, config } of agentDirs) {
      if (config.enabled === false) {
        console.log(`[agent-manager] Skipping disabled agent: ${name}`);
        continue;
      }
      await this.startAgent(name, dir, config);
    }
  }

  /**
   * Start a specific agent.
   */
  async startAgent(name: string, agentDir: string, config?: AgentConfig): Promise<void> {
    if (this.agents.has(name)) {
      console.log(`[agent-manager] Agent ${name} already running`);
      return;
    }

    // Auto-discover agent directory if not provided (e.g. when started via IPC)
    if (!agentDir || !existsSync(agentDir)) {
      const discovered = join(this.frameworkRoot, 'orgs', this.org, 'agents', name);
      if (existsSync(discovered)) {
        agentDir = discovered;
      } else {
        console.error(`[agent-manager] Agent directory not found for ${name}: tried ${discovered}`);
        return;
      }
    }

    if (!config) {
      config = this.loadAgentConfig(agentDir);
    }

    const env: CtxEnv = {
      instanceId: this.instanceId,
      ctxRoot: this.ctxRoot,
      frameworkRoot: this.frameworkRoot,
      agentName: name,
      agentDir,
      org: this.org,
      projectRoot: this.frameworkRoot,
    };

    const paths = resolvePaths(name, this.instanceId, this.org);

    const log = (msg: string) => {
      console.log(`[${name}] ${msg}`);
    };

    // Read agent .env for Telegram credentials
    const agentEnvFile = join(agentDir, '.env');
    let telegramApi: TelegramAPI | undefined;
    let chatId: string | undefined;
    let allowedUserId: string | undefined;
    let botToken: string | undefined;

    if (existsSync(agentEnvFile)) {
      const envContent = readFileSync(agentEnvFile, 'utf-8');
      const botTokenMatch = envContent.match(/^BOT_TOKEN=(.+)$/m);
      const chatIdMatch = envContent.match(/^CHAT_ID=(.+)$/m);
      const allowedUserMatch = envContent.match(/^ALLOWED_USER=(.+)$/m);
      botToken = botTokenMatch?.[1]?.trim();
      chatId = chatIdMatch?.[1]?.trim();
      allowedUserId = allowedUserMatch?.[1]?.trim() || undefined;

      // ALLOWED_USER must be a numeric Telegram user ID, not a username
      if (allowedUserId && !/^\d+$/.test(allowedUserId)) {
        log(`WARNING: ALLOWED_USER="${allowedUserId}" is not a numeric ID. Telegram user IDs are numbers (e.g. 7940429114). Messages will be blocked. Fix the .env file.`);
        allowedUserId = undefined; // Disable the gate rather than silently block all messages
      }

      if (botToken && chatId) {
        telegramApi = new TelegramAPI(botToken);
        log(`Telegram configured (chat_id: ${chatId}${allowedUserId ? `, allowed_user: ${allowedUserId}` : ''})`);
      }
    }

    const agentProcess = new AgentProcess(name, env, config, log);
    const checker = new FastChecker(agentProcess, paths, this.frameworkRoot, { log, telegramApi, chatId });

    this.agents.set(name, { process: agentProcess, checker });

    // Start agent
    await agentProcess.start();

    // Start fast checker in background
    checker.start().catch(err => {
      console.error(`[${name}] Fast checker error:`, err);
    });

    // Register Telegram slash commands at startup (fix for issue #1)
    if (telegramApi && botToken) {
      const scanDirs = [agentDir, this.frameworkRoot].filter(Boolean);
      const commands = collectTelegramCommands(scanDirs);
      registerTelegramCommands(botToken, commands).then((result) => {
        if (result.status === 'ok') {
          log(`Telegram commands registered (${result.count} commands)`);
        }
      }).catch(() => { /* non-fatal */ });
    }

    // Start Telegram poller if credentials are available
    if (telegramApi && chatId) {
      const stateDir = join(this.ctxRoot, 'state', name);
      const poller = new TelegramPoller(telegramApi, stateDir);

      poller.onMessage((msg) => {
        // ALLOWED_USER gate: if configured, ignore messages from other users
        if (allowedUserId && msg.from?.id !== undefined) {
          if (String(msg.from.id) !== allowedUserId) {
            log(`Ignoring message from unauthorized user ${msg.from.id} (allowed: ${allowedUserId})`);
            return;
          }
        }

        const from = msg.from?.first_name || msg.from?.username || 'Unknown';
        const text = msg.text || '';
        const msgChatId = msg.chat?.id;
        const stateDir = join(this.ctxRoot, 'state', name);

        // Log inbound message to JSONL
        logInboundMessage(this.ctxRoot, name, {
          message_id: msg.message_id,
          from: msg.from?.id,
          from_name: from,
          chat_id: msgChatId,
          text,
          timestamp: new Date().toISOString(),
        });

        // Get last-sent context for conversation continuity
        const lastSent = FastChecker.readLastSent(stateDir, msgChatId ?? chatId ?? '');

        // Get reply-to text if this is a reply
        const replyToText = msg.reply_to_message?.text;

        // Format using standard formatter with context
        const formatted = FastChecker.formatTelegramTextMessage(
          from,
          msgChatId ?? chatId ?? '',
          text,
          this.frameworkRoot,
          replyToText,
          lastSent ?? undefined,
        );

        checker.queueTelegramMessage(formatted);
      });

      poller.onCallback((query) => {
        // Route to fast-checker for hook response handling (perm_allow/deny, askopt, etc.)
        // handleCallback writes hook-response files and edits Telegram messages
        checker.handleCallback(query).catch(err => {
          log(`Callback handling error: ${err}`);
        });
      });

      poller.start().catch(err => {
        log(`Telegram poller error: ${err}`);
      });
      log('Telegram poller started');
    }
  }

  /**
   * Stop a specific agent.
   */
  async stopAgent(name: string): Promise<void> {
    const entry = this.agents.get(name);
    if (!entry) {
      console.log(`[agent-manager] Agent ${name} not found`);
      return;
    }

    entry.checker.stop();
    await entry.process.stop();
    this.agents.delete(name);
  }

  /**
   * Restart a specific agent.
   */
  async restartAgent(name: string): Promise<void> {
    const entry = this.agents.get(name);
    if (entry) {
      entry.checker.stop();
      await entry.process.stop();
      await entry.process.start();
      entry.checker.start().catch(() => {});
    }
  }

  /**
   * Stop all agents.
   */
  async stopAll(): Promise<void> {
    const names = [...this.agents.keys()];
    for (const name of names) {
      await this.stopAgent(name);
    }
  }

  /**
   * Get status of all agents.
   */
  getAllStatuses(): AgentStatus[] {
    const statuses: AgentStatus[] = [];
    for (const [, entry] of this.agents) {
      statuses.push(entry.process.getStatus());
    }
    return statuses;
  }

  /**
   * Get status of a specific agent.
   */
  getAgentStatus(name: string): AgentStatus | null {
    const entry = this.agents.get(name);
    return entry ? entry.process.getStatus() : null;
  }

  /**
   * Get the FastChecker for an agent (for Telegram message routing).
   */
  getFastChecker(name: string): FastChecker | null {
    return this.agents.get(name)?.checker || null;
  }

  /**
   * Get all agent names.
   */
  getAgentNames(): string[] {
    return [...this.agents.keys()];
  }

  /**
   * Discover agents from the organization directory structure.
   */
  private discoverAgents(): Array<{ name: string; dir: string; config: AgentConfig }> {
    const agents: Array<{ name: string; dir: string; config: AgentConfig }> = [];

    // Look for agents in orgs/{org}/agents/
    const agentsBase = join(this.frameworkRoot, 'orgs', this.org, 'agents');
    if (!existsSync(agentsBase)) return agents;

    try {
      const dirs = readdirSync(agentsBase, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

      for (const name of dirs) {
        const dir = join(agentsBase, name);
        const config = this.loadAgentConfig(dir);
        agents.push({ name, dir, config });
      }
    } catch {
      // Ignore read errors
    }

    return agents;
  }

  /**
   * Load agent config from config.json.
   */
  private loadAgentConfig(agentDir: string): AgentConfig {
    const configPath = join(agentDir, 'config.json');
    try {
      if (existsSync(configPath)) {
        return JSON.parse(readFileSync(configPath, 'utf-8'));
      }
    } catch {
      // Ignore parse errors
    }
    return {}; // Default config
  }
}
