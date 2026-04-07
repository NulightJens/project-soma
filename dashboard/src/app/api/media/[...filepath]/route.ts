import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getCTXRoot } from '@/lib/config';

export const dynamic = 'force-dynamic';

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.json': 'application/json',
};

/**
 * GET /api/media/[...filepath]
 * Serve a local media file by its path relative to CTX_ROOT.
 * Used by the mobile app to display images/audio sent by agents or users.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ filepath: string[] }> }
) {
  const { filepath } = await params;
  const ctxRoot = getCTXRoot();

  // Reconstruct the relative path from segments
  const relativePath = filepath.join('/');

  // Security: ensure the path stays within CTX_ROOT — prevent directory traversal
  const fullPath = path.resolve(ctxRoot, relativePath);

  // Security: resolve symlinks on both sides to prevent escape via symlinks inside CTX_ROOT
  let realFullPath: string;
  let realCtxRoot: string;
  try {
    realFullPath = fs.realpathSync(fullPath);
    realCtxRoot = fs.realpathSync(path.resolve(ctxRoot));
  } catch {
    return new Response('Not found', { status: 404 });
  }

  const rootWithSep = realCtxRoot.endsWith(path.sep) ? realCtxRoot : realCtxRoot + path.sep;
  if (realFullPath !== realCtxRoot && !realFullPath.startsWith(rootWithSep)) {
    return new Response('Forbidden', { status: 403 });
  }

  const targetPath = fs.existsSync(realFullPath) ? realFullPath : null;

  if (!targetPath || !fs.existsSync(targetPath)) {
    return new Response('Not found', { status: 404 });
  }

  const ext = path.extname(targetPath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
  const fileBuffer = fs.readFileSync(targetPath);

  return new Response(fileBuffer, {
    status: 200,
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(fileBuffer.length),
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
