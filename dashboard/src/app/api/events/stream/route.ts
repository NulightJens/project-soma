import { NextRequest } from 'next/server';
import { initWatcher, onSSEEvent } from '@/lib/watcher';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  // Security (H7): Authenticate SSE via NextAuth session cookie.
  const session = await auth();
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }
  // Auth passed — proceed with stream

  // Ensure watcher is running
  try {
    initWatcher();
  } catch (err) {
    console.error('[sse] Failed to initialize watcher:', err);
    return new Response('Internal Server Error', { status: 500 });
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Send initial connection comment
      controller.enqueue(encoder.encode(': connected\n\n'));

      // Subscribe to SSE events from the watcher emitter
      const unsubscribe = onSSEEvent((event) => {
        if (request.signal.aborted) return;
        try {
          const data = JSON.stringify(event);
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          // Client disconnected, ignore
        }
      });

      // 30s heartbeat to keep connection alive
      const keepalive = setInterval(() => {
        if (request.signal.aborted) {
          clearInterval(keepalive);
          return;
        }
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          clearInterval(keepalive);
        }
      }, 30_000);

      // Clean up on client disconnect
      request.signal.addEventListener('abort', () => {
        unsubscribe();
        clearInterval(keepalive);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
