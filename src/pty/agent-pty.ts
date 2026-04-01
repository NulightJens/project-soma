import { platform } from 'os';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import type { AgentConfig, CtxEnv } from '../types/index.js';
import { OutputBuffer } from './output-buffer.js';
import { ensureDir } from '../utils/atomic.js';

// node-pty types
interface IPty {
  pid: number;
  write(data: string): void;
  onData(callback: (data: string) => void): { dispose(): void };
  onExit(callback: (e: { exitCode: number; signal?: number }) => void): { dispose(): void };
  kill(signal?: string): void;
  resize(cols: number, rows: number): void;
}

interface IPtySpawnOptions {
  name?: string;
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string>;
}

type SpawnFn = (file: string, args: string[], options: IPtySpawnOptions) => IPty;

/**
 * Manages a single Claude Code PTY session.
 * Replaces the tmux session management in agent-wrapper.sh.
 */
export class AgentPTY {
  private pty: IPty | null = null;
  private outputBuffer: OutputBuffer;
  private env: CtxEnv;
  private config: AgentConfig;
  private onExitHandler: ((exitCode: number, signal?: number) => void) | null = null;
  private spawnFn: SpawnFn | null = null;

  constructor(env: CtxEnv, config: AgentConfig, logPath?: string) {
    this.env = env;
    this.config = config;
    this.outputBuffer = new OutputBuffer(1000, logPath);
  }

  /**
   * Spawn Claude Code in a PTY process.
   *
   * @param mode 'fresh' for new conversation, 'continue' for preserving history
   * @param prompt The startup or continue prompt to pass to Claude
   */
  async spawn(mode: 'fresh' | 'continue', prompt: string): Promise<void> {
    if (this.pty) {
      throw new Error('PTY already spawned. Kill first.');
    }

    // Lazy-load node-pty (native addon)
    if (!this.spawnFn) {
      const nodePty = require('node-pty');
      this.spawnFn = nodePty.spawn;
    }

    const shell = this.getDefaultShell();
    const cwd = this.config.working_directory || this.env.agentDir || process.cwd();

    // Build environment variables for the PTY process
    const ptyEnv: Record<string, string> = {
      ...this.getBaseEnv(),
      CTX_INSTANCE_ID: this.env.instanceId,
      CTX_ROOT: this.env.ctxRoot,
      CTX_FRAMEWORK_ROOT: this.env.frameworkRoot,
      CTX_AGENT_NAME: this.env.agentName,
      CTX_ORG: this.env.org,
      CTX_AGENT_DIR: this.env.agentDir,
      CTX_PROJECT_ROOT: this.env.projectRoot,
      // Backward compat
      CRM_AGENT_NAME: this.env.agentName,
      CRM_TEMPLATE_ROOT: this.env.frameworkRoot,
    };

    // Source org-level shared secrets first (orgs/{org}/.env).
    // These are shared across all agents in the org: OPENAI_KEY, APIFY_TOKEN, etc.
    // Agent .env is loaded after and overrides org values — agent-specific keys win.
    if (this.env.org && this.env.projectRoot) {
      const orgEnvFile = join(this.env.projectRoot, 'orgs', this.env.org, '.env');
      if (existsSync(orgEnvFile)) {
        const content = readFileSync(orgEnvFile, 'utf-8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            ptyEnv[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
          }
        }
      }
    }

    // Source agent .env file (overrides org .env for same key names).
    // Contains agent-specific secrets: BOT_TOKEN, CHAT_ID, CLAUDE_CODE_OAUTH_TOKEN.
    const agentEnvFile = join(this.env.agentDir, '.env');
    if (existsSync(agentEnvFile)) {
      const content = readFileSync(agentEnvFile, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          ptyEnv[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
        }
      }
    }

    this.pty = this.spawnFn!(shell, [], {
      name: 'xterm-256color',
      cols: 200,
      rows: 50,
      cwd,
      env: ptyEnv,
    });

    // Set up output capture
    this.pty.onData((data: string) => {
      this.outputBuffer.push(data);
    });

    // Set up exit handler
    this.pty.onExit(({ exitCode, signal }) => {
      this.pty = null;
      if (this.onExitHandler) {
        this.onExitHandler(exitCode, signal);
      }
    });

    // Build and send the Claude command
    const claudeCmd = this.buildClaudeCommand(mode, prompt);
    // Export env vars in shell first, then run claude
    const exportCmd = Object.entries(ptyEnv)
      .filter(([k]) => k.startsWith('CTX_') || k.startsWith('CRM_'))
      .map(([k, v]) => `export ${k}='${v.replace(/'/g, "'\\''")}'`)
      .join(' && ');

    if (exportCmd) {
      this.pty.write(exportCmd + '\r');
    }

    // Small delay for env to take effect, then launch claude
    setTimeout(() => {
      if (this.pty) {
        this.pty.write(claudeCmd + '\r');

        // Claude Code shows a "trust this folder?" prompt on first run in a new directory.
        // Auto-accept by sending Enter after the prompt appears.
        // The prompt takes ~3-5s to render; we send Enter at 5s and 8s for reliability.
        setTimeout(() => {
          if (this.pty) {
            const recent = this.outputBuffer.getRecent();
            if (recent.includes('trust') || recent.includes('Yes')) {
              this.pty.write('\r');
            }
          }
        }, 5000);
        setTimeout(() => {
          if (this.pty) {
            const recent = this.outputBuffer.getRecent();
            if (recent.includes('trust') || recent.includes('Yes')) {
              this.pty.write('\r');
            }
          }
        }, 8000);
      }
    }, 500);
  }

  /**
   * Build the claude CLI command string.
   */
  private buildClaudeCommand(mode: 'fresh' | 'continue', prompt: string): string {
    const parts = ['claude'];

    if (mode === 'continue') {
      parts.push('--continue');
    }

    parts.push('--dangerously-skip-permissions');

    if (this.config.model) {
      parts.push('--model', this.config.model);
    }

    // Escape single quotes in prompt for shell
    const escapedPrompt = prompt.replace(/'/g, "'\\''");
    parts.push(`'${escapedPrompt}'`);

    return parts.join(' ');
  }

  /**
   * Write data to the PTY.
   */
  write(data: string): void {
    if (!this.pty) {
      throw new Error('PTY not spawned');
    }
    this.pty.write(data);
  }

  /**
   * Kill the PTY process.
   */
  kill(): void {
    if (this.pty) {
      this.pty.kill();
      this.pty = null;
    }
  }

  /**
   * Check if the PTY process is alive.
   */
  isAlive(): boolean {
    if (!this.pty) return false;
    try {
      process.kill(this.pty.pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the PTY PID.
   */
  getPid(): number | null {
    return this.pty?.pid || null;
  }

  /**
   * Register an exit handler.
   */
  onExit(handler: (exitCode: number, signal?: number) => void): void {
    this.onExitHandler = handler;
  }

  /**
   * Get the output buffer for inspection.
   */
  getOutputBuffer(): OutputBuffer {
    return this.outputBuffer;
  }

  /**
   * Get the platform-appropriate default shell.
   */
  private getDefaultShell(): string {
    if (platform() === 'win32') {
      return process.env.COMSPEC || 'cmd.exe';
    }
    return process.env.SHELL || '/bin/bash';
  }

  /**
   * Get a clean base environment (excluding potentially harmful vars).
   */
  private getBaseEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    // Copy essential env vars
    const keepVars = [
      'PATH', 'HOME', 'USER', 'SHELL', 'TERM', 'LANG', 'LC_ALL',
      'TMPDIR', 'TEMP', 'TMP', 'ANTHROPIC_API_KEY', 'CLAUDE_API_KEY',
      'NODE_PATH', 'COMSPEC', 'SystemRoot', 'USERPROFILE',
    ];
    for (const key of keepVars) {
      if (process.env[key]) {
        env[key] = process.env[key]!;
      }
    }
    return env;
  }
}
