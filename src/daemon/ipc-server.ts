import { createServer, Server, Socket } from 'net';
import { existsSync, unlinkSync } from 'fs';
import type { IPCRequest, IPCResponse } from '../types/index.js';
import { AgentManager } from './agent-manager.js';
import { getIpcPath } from '../utils/paths.js';

/**
 * IPC server for CLI <-> daemon communication.
 * Uses Unix domain socket on macOS/Linux, named pipe on Windows.
 * Replaces SIGUSR1 and other signal-based IPC.
 */
export class IPCServer {
  private server: Server | null = null;
  private socketPath: string;
  private agentManager: AgentManager;

  constructor(agentManager: AgentManager, instanceId: string = 'default') {
    this.agentManager = agentManager;
    this.socketPath = getIpcPath(instanceId);
  }

  /**
   * Start listening for IPC connections.
   */
  async start(): Promise<void> {
    // Clean up stale socket
    if (process.platform !== 'win32' && existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath);
      } catch {
        // Ignore
      }
    }

    return new Promise((resolve, reject) => {
      this.server = createServer((socket: Socket) => {
        let data = '';
        socket.on('data', (chunk) => {
          data += chunk.toString();
          // Try to parse complete JSON messages
          try {
            const request: IPCRequest = JSON.parse(data);
            data = '';
            this.handleRequest(request, socket);
          } catch {
            // Incomplete JSON, wait for more data
          }
        });

        socket.on('error', () => {
          // Client disconnected
        });
      });

      this.server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          // Race: process was killed after unlink but before bind completed.
          // Clean up the re-created socket and retry once.
          try { unlinkSync(this.socketPath); } catch { /* ignore */ }
          this.server!.listen(this.socketPath, () => {
            console.log(`[ipc] Listening on ${this.socketPath} (recovered from stale socket)`);
            resolve();
          });
        } else {
          reject(err);
        }
      });

      this.server.listen(this.socketPath, () => {
        console.log(`[ipc] Listening on ${this.socketPath}`);
        resolve();
      });
    });
  }

  /**
   * Stop the IPC server.
   */
  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }

    // Clean up socket file
    if (process.platform !== 'win32' && existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath);
      } catch {
        // Ignore
      }
    }
  }

  /**
   * Handle an incoming IPC request.
   */
  private handleRequest(request: IPCRequest, socket: Socket): void {
    let response: IPCResponse;

    try {
      switch (request.type) {
        case 'status':
          response = {
            success: true,
            data: this.agentManager.getAllStatuses(),
          };
          break;

        case 'list-agents':
          response = {
            success: true,
            data: this.agentManager.getAgentNames(),
          };
          break;

        case 'start-agent':
          if (!request.agent) {
            response = { success: false, error: 'Agent name required' };
          } else {
            // Start is async, respond immediately
            this.agentManager.startAgent(
              request.agent,
              (request.data?.dir as string) || '',
            ).catch(err => console.error(`Failed to start ${request.agent}:`, err));
            response = { success: true, data: `Starting ${request.agent}` };
          }
          break;

        case 'stop-agent':
          if (!request.agent) {
            response = { success: false, error: 'Agent name required' };
          } else {
            this.agentManager.stopAgent(request.agent)
              .catch(err => console.error(`Failed to stop ${request.agent}:`, err));
            response = { success: true, data: `Stopping ${request.agent}` };
          }
          break;

        case 'restart-agent':
          if (!request.agent) {
            response = { success: false, error: 'Agent name required' };
          } else {
            this.agentManager.restartAgent(request.agent)
              .catch(err => console.error(`Failed to restart ${request.agent}:`, err));
            response = { success: true, data: `Restarting ${request.agent}` };
          }
          break;

        case 'wake':
          // Wake a specific agent's fast checker (replaces SIGUSR1)
          if (request.agent) {
            const checker = this.agentManager.getFastChecker(request.agent);
            if (checker) {
              response = { success: true, data: 'Woke fast checker' };
            } else {
              response = { success: false, error: `Agent ${request.agent} not found` };
            }
          } else {
            response = { success: false, error: 'Agent name required' };
          }
          break;

        default:
          response = { success: false, error: `Unknown command: ${request.type}` };
      }
    } catch (err) {
      response = { success: false, error: String(err) };
    }

    try {
      socket.write(JSON.stringify(response));
      socket.end();
    } catch {
      // Client disconnected
    }
  }
}

/**
 * IPC client for sending commands to the daemon.
 * Used by CLI commands.
 */
export class IPCClient {
  private socketPath: string;

  constructor(instanceId: string = 'default') {
    this.socketPath = getIpcPath(instanceId);
  }

  /**
   * Send a command to the daemon and get the response.
   */
  async send(request: IPCRequest): Promise<IPCResponse> {
    const { createConnection } = require('net');

    return new Promise((resolve, reject) => {
      const socket = createConnection(this.socketPath, () => {
        socket.write(JSON.stringify(request));
      });

      let data = '';
      socket.on('data', (chunk: Buffer) => {
        data += chunk.toString();
      });

      socket.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error('Invalid response from daemon'));
        }
      });

      socket.on('error', (err: Error) => {
        if ((err as any).code === 'ECONNREFUSED' || (err as any).code === 'ENOENT') {
          resolve({
            success: false,
            error: 'Daemon is not running. Start it with: cortextos start',
          });
        } else {
          reject(err);
        }
      });

      // Timeout after 5 seconds
      socket.setTimeout(5000, () => {
        socket.destroy();
        reject(new Error('IPC request timed out'));
      });
    });
  }

  /**
   * Check if the daemon is running.
   */
  async isDaemonRunning(): Promise<boolean> {
    try {
      const response = await this.send({ type: 'status' });
      return response.success;
    } catch {
      return false;
    }
  }
}
