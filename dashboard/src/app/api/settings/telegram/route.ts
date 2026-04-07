import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getOrgs, getAgentsForOrg, getAgentDir } from '@/lib/config';

export const dynamic = 'force-dynamic';

function maskToken(token: string): string {
  if (token.length <= 8) return '****';
  return token.slice(0, 4) + '****' + token.slice(-4);
}

export async function GET(_request: NextRequest) {
  try {
    const configs: Array<{ agent: string; org: string; botToken: string; chatId: string }> = [];
    const orgs = getOrgs();

    for (const org of orgs) {
      const agents = getAgentsForOrg(org);
      for (const agent of agents) {
        const agentDir = getAgentDir(agent, org);
        const envPath = path.join(agentDir, '.env');
        if (!fs.existsSync(envPath)) continue;

        const content = fs.readFileSync(envPath, 'utf-8');
        let botToken = '';
        let chatId = '';

        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (trimmed.startsWith('#')) continue;
          const match = trimmed.match(/^(\w+)=(.*)$/);
          if (!match) continue;
          const [, key, value] = match;
          const v = value.replace(/^["']|["']$/g, '');
          if (key === 'TELEGRAM_BOT_TOKEN' || key === 'TG_BOT_TOKEN' || key === 'BOT_TOKEN') botToken = v;
          else if (key === 'TELEGRAM_CHAT_ID' || key === 'TG_CHAT_ID' || key === 'CHAT_ID') chatId = v;
        }

        if (botToken || chatId) {
          configs.push({
            agent,
            org,
            botToken: botToken ? maskToken(botToken) : '-',
            chatId: chatId || '-',
          });
        }
      }
    }

    return Response.json({ configs });
  } catch (err) {
    console.error('[api/settings/telegram] GET error:', err);
    return Response.json({ error: 'Failed to fetch telegram configs' }, { status: 500 });
  }
}
