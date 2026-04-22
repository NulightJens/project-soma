import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { getSkoolSupabase } from '@/lib/supabase-client';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const SCRIPT_PATH = path.resolve(
  process.cwd(),
  '..',
  'orgs',
  'lifeos',
  'agents',
  'skoolio',
  'scripts',
  'execute-crm-outreach.js',
);
// Minimal sanity pattern for Skool handles we write to outreach rows
const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{2,79}$/i;

interface RunResult {
  success: boolean;
  mode?: string;
  results?: Array<Record<string, unknown>>;
  error?: string;
  stdoutTail?: string;
  stderrTail?: string;
}

function runScript(args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn('node', [SCRIPT_PATH, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      const lastJson = (() => {
        const lines = stdout.trim().split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
          try { return JSON.parse(lines[i]); } catch { /* keep searching */ }
        }
        return null;
      })();
      if (lastJson && typeof lastJson === 'object') {
        resolve({
          success: code === 0,
          ...lastJson,
          stderrTail: stderr.slice(-500) || undefined,
        });
      } else {
        resolve({
          success: false,
          error: `script exited ${code}; no JSON output`,
          stdoutTail: stdout.slice(-500) || undefined,
          stderrTail: stderr.slice(-500) || undefined,
        });
      }
    });
    child.on('error', (err) => {
      resolve({ success: false, error: `spawn failed: ${err.message}` });
    });
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'missing outreach id' }, { status: 400 });
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body ok */ }
  const testHandleRaw = typeof body.test_handle === 'string' ? body.test_handle.trim() : '';
  const testHandle = testHandleRaw.replace(/^@+/, '').toLowerCase();
  if (testHandle && !HANDLE_RE.test(testHandle)) {
    return NextResponse.json({ error: 'invalid test_handle' }, { status: 400 });
  }
  const dryRun = body.dry_run === true;

  // Pre-check: only proceed if the row is in status=ready (server-side guard;
  // the script re-checks too, but failing fast here avoids a spawn + helpful error).
  const sb = getSkoolSupabase();
  const { data: row, error } = await sb
    .from('crm_outreach')
    .select('id, status, member_handle')
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: `lookup: ${error.message}` }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'outreach row not found' }, { status: 404 });
  if (row.status !== 'ready') {
    return NextResponse.json(
      { error: `row is not in ready state (current: ${row.status})` },
      { status: 409 },
    );
  }

  const args: string[] = ['--outreach-id=' + id, '--max=1', '--json'];
  if (!dryRun) args.push('--live', '--i-really-want-to-send');
  if (testHandle) args.push('--test-handle=' + testHandle);

  const result = await runScript(args);
  if (!result.success) {
    return NextResponse.json({ error: result.error || 'script failed', detail: result }, { status: 500 });
  }
  return NextResponse.json(result);
}
