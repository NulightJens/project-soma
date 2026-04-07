import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getCTXRoot } from '@/lib/config';

export const dynamic = 'force-dynamic';

interface MessageEntry {
  id: string;
  timestamp: string;
  agent: string;
  direction: 'inbound' | 'outbound';
  type: string;
  text: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

/**
 * GET /api/messages/history/[agent] - Get message history for an agent
 *
 * Reads from two JSONL files:
 * - outbound-messages.jsonl (agent -> user, from send-telegram.sh)
 * - inbound-messages.jsonl (user -> agent, from mobile app or other sources)
 *
 * Query params:
 *   limit  - max messages (default 50)
 *   before - ISO date cursor for pagination
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agent: string }> }
) {
  const { agent } = await params;

  if (!agent || !/^[a-z0-9_-]+$/.test(agent)) {
    return Response.json({ error: 'Invalid agent name' }, { status: 400 });
  }

  const { searchParams } = request.nextUrl;
  const limit = Math.min(
    Math.max(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 1),
    500
  );
  const before = searchParams.get('before');

  const ctxRoot = getCTXRoot();
  const logDir = path.join(ctxRoot, 'logs', agent);

  const messages: MessageEntry[] = [];

  // Read outbound messages (agent -> user)
  const outboundFile = path.join(logDir, 'outbound-messages.jsonl');
  if (fs.existsSync(outboundFile)) {
    const lines = fs.readFileSync(outboundFile, 'utf-8').trim().split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        messages.push({
          id: entry.message_id || `out-${entry.timestamp}`,
          timestamp: entry.timestamp || entry.ts,
          agent,
          direction: 'outbound',
          type: 'text',
          text: entry.text || '',
          metadata: {
            chat_id: entry.chat_id,
            message_id: entry.message_id,
          },
        });
      } catch {
        // Skip malformed lines
      }
    }
  }

  // Read inbound messages (user -> agent)
  const inboundFile = path.join(logDir, 'inbound-messages.jsonl');
  if (fs.existsSync(inboundFile)) {
    const lines = fs.readFileSync(inboundFile, 'utf-8').trim().split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        messages.push({
          id: entry.id || `in-${entry.timestamp}`,
          timestamp: entry.timestamp,
          agent,
          direction: entry.direction || 'inbound',
          type: entry.type || 'text',
          text: entry.text || '',
          source: entry.source,
        });
      } catch {
        // Skip malformed lines
      }
    }
  }

  // Sort by timestamp ascending
  messages.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Apply cursor filter
  let filtered = messages;
  if (before) {
    const beforeTime = new Date(before).getTime();
    filtered = messages.filter(
      (m) => new Date(m.timestamp).getTime() < beforeTime
    );
  }

  // Take last N messages
  const result = filtered.slice(-limit);

  return Response.json(result);
}
