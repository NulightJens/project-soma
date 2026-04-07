import { Command } from 'commander';
import { IPCClient } from '../daemon/ipc-server.js';

export const stopCommand = new Command('stop')
  .argument('[agent]', 'Specific agent to stop (stops all if omitted)')
  .option('--instance <id>', 'Instance ID', 'default')
  .description('Stop the daemon or a specific agent')
  .action(async (agent: string | undefined, options: { instance: string }) => {
    const ipc = new IPCClient(options.instance);
    const daemonRunning = await ipc.isDaemonRunning();

    if (!daemonRunning) {
      console.log('Daemon is not running.');
      return;
    }

    if (agent) {
      console.log(`Stopping agent: ${agent}`);
      const response = await ipc.send({ type: 'stop-agent', agent });
      if (response.success) {
        console.log(`  ${response.data}`);
      } else {
        console.error(`  Error: ${response.error}`);
      }
    } else {
      console.log('Stopping all agents...');
      const listResponse = await ipc.send({ type: 'list-agents' });
      if (listResponse.success) {
        const agents = listResponse.data as string[];
        for (const a of agents) {
          const response = await ipc.send({ type: 'stop-agent', agent: a });
          console.log(`  ${a}: ${response.success ? 'stopped' : response.error}`);
        }
      }
      console.log('\nTo stop the daemon entirely: pm2 stop cortextos-daemon');
    }
  });
