import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getCTXRoot } from '@/lib/config';

export const dynamic = 'force-dynamic';

/**
 * POST /api/notifications/register - Register an Expo push token
 *
 * Body: { token: string, device?: string }
 * Stores the token in CTX_ROOT/config/push-tokens.json
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { token, device } = body as { token?: string; device?: string };

  if (!token || typeof token !== 'string') {
    return Response.json({ error: 'token is required' }, { status: 400 });
  }

  // Validate Expo push token format
  if (!token.startsWith('ExponentPushToken[') && !token.startsWith('ExpoPushToken[')) {
    return Response.json({ error: 'Invalid Expo push token format' }, { status: 400 });
  }

  const ctxRoot = getCTXRoot();
  const configDir = path.join(ctxRoot, 'config');
  const tokensFile = path.join(configDir, 'push-tokens.json');

  try {
    // Ensure config directory exists
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // Read existing tokens
    let tokens: Array<{ token: string; device?: string; registeredAt: string }> = [];
    if (fs.existsSync(tokensFile)) {
      try {
        tokens = JSON.parse(fs.readFileSync(tokensFile, 'utf-8'));
      } catch {
        tokens = [];
      }
    }

    // Check for duplicate
    const existing = tokens.findIndex((t) => t.token === token);
    if (existing >= 0) {
      // Update registration time
      tokens[existing].registeredAt = new Date().toISOString();
      if (device) tokens[existing].device = device;
    } else {
      tokens.push({
        token,
        device,
        registeredAt: new Date().toISOString(),
      });
    }

    fs.writeFileSync(tokensFile, JSON.stringify(tokens, null, 2) + '\n', 'utf-8');

    return Response.json({ success: true });
  } catch (err) {
    console.error('[api/notifications/register] Error:', err);
    return Response.json({ error: 'Failed to register token' }, { status: 500 });
  }
}
