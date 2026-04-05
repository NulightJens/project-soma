import { AgentManager } from './agent-manager.js';
import { IPCServer } from './ipc-server.js';
import { writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { ensureDir } from '../utils/atomic.js';

/**
 * cortextOS Daemon - single process managing all agents.
 * Run via `pm2 start ecosystem.config.js` or `cortextos ecosystem && pm2 start`.
 */
class Daemon {
  private agentManager: AgentManager | null = null;
  private ipcServer: IPCServer | null = null;
  private instanceId: string;
  private ctxRoot: string;

  constructor() {
    this.instanceId = process.env.CTX_INSTANCE_ID || 'default';
    // Always derive ctxRoot from instanceId to avoid inheriting a parent cortextOS's CTX_ROOT
    this.ctxRoot = join(homedir(), '.cortextos', this.instanceId);
  }

  async start(): Promise<void> {
    console.log(`[daemon] Starting cortextOS daemon (instance: ${this.instanceId})`);

    const frameworkRoot = process.env.CTX_FRAMEWORK_ROOT || '';
    const org = process.env.CTX_ORG || '';

    if (!frameworkRoot) {
      console.error('[daemon] CTX_FRAMEWORK_ROOT not set');
      process.exit(1);
    }

    // Write PID file
    const pidFile = join(this.ctxRoot, 'daemon.pid');
    ensureDir(this.ctxRoot);
    writeFileSync(pidFile, String(process.pid), 'utf-8');

    // Create agent manager
    this.agentManager = new AgentManager(this.instanceId, this.ctxRoot, frameworkRoot, org);

    // Start IPC server
    this.ipcServer = new IPCServer(this.agentManager, this.instanceId);
    await this.ipcServer.start();

    // Discover and start agents
    await this.agentManager.discoverAndStart();

    console.log(`[daemon] Running (pid: ${process.pid})`);

    // Handle shutdown signals
    const shutdown = async () => {
      console.log('[daemon] Shutting down...');
      try {
        if (this.agentManager) {
          await this.agentManager.stopAll();
        }
      } catch (err) {
        console.error('[daemon] Error during shutdown:', err);
      }
      if (this.ipcServer) {
        this.ipcServer.stop();
      }
      // Clean up PID file
      try {
        const { unlinkSync } = require('fs');
        unlinkSync(pidFile);
      } catch { /* ignore */ }
      process.exit(0);
    };

    // Wrap in a synchronous handler that catches unhandled promise rejections
    // so a shutdown error never leaves the process hanging.
    const handleSignal = () => {
      shutdown().catch((err) => {
        console.error('[daemon] Fatal shutdown error:', err);
        process.exit(1);
      });
    };

    process.on('SIGINT', handleSignal);
    process.on('SIGTERM', handleSignal);

    // Fallback cleanup on exit (belt-and-suspenders for Windows)
    process.on('exit', () => {
      if (this.ipcServer) {
        this.ipcServer.stop();
      }
      try {
        const { unlinkSync } = require('fs');
        unlinkSync(pidFile);
      } catch { /* ignore */ }
    });
  }
}

// Start daemon
const daemon = new Daemon();
daemon.start().catch(err => {
  console.error('[daemon] Fatal error:', err);
  process.exit(1);
});
