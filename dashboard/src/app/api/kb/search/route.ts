import { NextRequest } from 'next/server';
import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import os from 'os';
import { getCTXRoot, getFrameworkRoot } from '@/lib/config';


export const dynamic = 'force-dynamic';

/**
 * GET /api/kb/search?q=<question>&org=<org>&agent=<agent>&scope=<scope>&limit=<n>&threshold=<f>
 *
 * Searches the cortextOS knowledge base via kb-query.sh → mmrag.py → ChromaDB.
 *
 * Response:
 * {
 *   results: Array<{
 *     content: string,
 *     source_file: string,
 *     agent_name?: string,
 *     org: string,
 *     score: number,
 *     doc_type: string
 *   }>,
 *   total: number,
 *   query: string,
 *   collection: string
 * }
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const org = searchParams.get('org') ?? '';
  const agent = searchParams.get('agent') ?? '';
  const q = searchParams.get('q') ?? '';

  // Security (H12): Validate org/agent against allowlist before shell use.
  if (org && !/^[a-z0-9_-]+$/.test(org)) {
    return Response.json({ error: 'Invalid org' }, { status: 400 });
  }
  if (agent && !/^[a-z0-9_-]+$/.test(agent)) {
    return Response.json({ error: 'Invalid agent' }, { status: 400 });
  }
  if (q.length > 500) {
    return Response.json({ error: 'Query too long' }, { status: 400 });
  }

  const scope = searchParams.get('scope') || 'all';
  const limit = parseInt(searchParams.get('limit') || '10', 10);
  const threshold = parseFloat(searchParams.get('threshold') || '0.5');

  if (!q || q.trim().length === 0) {
    return Response.json({ error: 'q parameter required' }, { status: 400 });
  }

  if (!['shared', 'private', 'all'].includes(scope)) {
    return Response.json({ error: 'scope must be shared, private, or all' }, { status: 400 });
  }

  if (isNaN(limit) || limit < 1 || limit > 50) {
    return Response.json({ error: 'limit must be 1-50' }, { status: 400 });
  }

  if (isNaN(threshold) || threshold < 0 || threshold > 1) {
    return Response.json({ error: 'threshold must be 0.0-1.0' }, { status: 400 });
  }

  const frameworkRoot = getFrameworkRoot();
  const ctxRoot = getCTXRoot();

  // Derive instance ID from CTX_ROOT (e.g. ~/.cortextos/e2e-phase → "e2e-phase")
  const instanceId = path.basename(ctxRoot);

  const kbRoot = path.join(os.homedir(), '.cortextos', instanceId, 'orgs', org, 'knowledge-base');
  const chromaDir = path.join(kbRoot, 'chromadb');
  const configPath = path.join(kbRoot, 'config.json');
  const isWin = process.platform === 'win32';
  const venvBin = isWin ? 'Scripts' : 'bin';
  const pythonExe = isWin ? 'python.exe' : 'python3';
  const pythonPath = path.join(frameworkRoot, 'knowledge-base', 'venv', venvBin, pythonExe);
  const mmragPath = path.join(frameworkRoot, 'knowledge-base', 'scripts', 'mmrag.py');

  // Determine collection(s) from scope (matching kb-query.sh logic)
  let collection = '';
  if (scope === 'private') {
    collection = `agent-${agent}`;
  } else if (scope === 'shared') {
    collection = `shared-${org}`;
  }
  // scope === 'all' → collection stays empty, we query both below

  // Load org secrets for GEMINI_API_KEY
  const secretsPath = org
    ? path.join(frameworkRoot, 'orgs', org, 'secrets.env')
    : null;

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    CTX_FRAMEWORK_ROOT: frameworkRoot,
    CTX_INSTANCE_ID: instanceId,
    PATH: process.env.PATH ?? '',
    MMRAG_DIR: kbRoot,
    MMRAG_CHROMADB_DIR: chromaDir,
    MMRAG_CONFIG: configPath,
  };

  if (org) env.CTX_ORG = org;
  if (agent) env.CTX_AGENT_NAME = agent;

  // Load GEMINI_API_KEY from secrets if available
  if (secretsPath) {
    try {
      const secrets = readFileSync(secretsPath, 'utf-8');
      const match = secrets.match(/^GEMINI_API_KEY=(.+)$/m);
      if (match) env.GEMINI_API_KEY = match[1].trim();
    } catch {
      // No secrets file — GEMINI_API_KEY may be in process.env already
    }
  }
  if (!env.GEMINI_API_KEY && process.env.GEMINI_API_KEY) {
    env.GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  }

  if (!env.GEMINI_API_KEY) {
    return Response.json(
      { error: 'GEMINI_API_KEY not configured. Add it to orgs/{org}/secrets.env' },
      { status: 503 }
    );
  }

  // Pre-flight: check venv exists
  if (!existsSync(path.join(frameworkRoot, 'knowledge-base', 'venv'))) {
    return Response.json({ results: [], total: 0, query: q, collection: `shared-${org}` });
  }

  /**
   * Run a single mmrag.py query against one collection.
   */
  function runQuery(col: string): string {
    const pyArgs = [
      mmragPath, 'query', q,
      '--collection', col,
      '--top-k', String(limit),
      '--threshold', String(threshold),
      '--json',
    ];
    return execFileSync(pythonPath, pyArgs, {
      timeout: 30000,
      encoding: 'utf-8',
      env: env as NodeJS.ProcessEnv,
    });
  }

  // Helper: parse mmrag.py JSON output from a single query
  function parseQueryOutput(output: string): Array<{
    content?: string; result?: string; similarity?: number;
    source?: string; type?: string; filename?: string;
  }> {
    const trimmed = output.trim();
    const jsonStart = trimmed.indexOf('{');
    if (jsonStart === -1) return [];
    try {
      const parsed = JSON.parse(trimmed.slice(jsonStart));
      return parsed.results || [];
    } catch { return []; }
  }

  try {
    let allResults: Array<{
      content?: string; result?: string; similarity?: number;
      source?: string; type?: string; filename?: string;
    }> = [];

    if (collection) {
      // Single collection query
      const stdout = runQuery(collection);
      allResults = parseQueryOutput(stdout);
    } else {
      // "all" scope: query shared, then agent-private if agent set, merge results
      try { allResults.push(...parseQueryOutput(runQuery(`shared-${org}`))); } catch { /* ignore */ }
      if (agent) {
        try { allResults.push(...parseQueryOutput(runQuery(`agent-${agent}`))); } catch { /* ignore */ }
      }
    }

    if (allResults.length === 0) {
      return Response.json({ results: [], total: 0, query: q, collection: `shared-${org}` });
    }

    // Build a synthetic raw object for the existing mapping code below
    const raw = { results: allResults } as {
      results?: Array<{
        content?: string;
        result?: string;
        similarity?: number;
        source?: string;
        type?: string;
        filename?: string;
        chunk_index?: number;
        total_chunks?: number;
        content_full_length?: number;
      }>;
      result_count?: number;
      query?: string;
      collection?: string;
      agent_name?: string;
      org?: string;
    };

    const results = (raw.results || []).map((r) => ({
      content: r.content || r.result || '',
      source_file: r.source || '',
      agent_name: raw.agent_name || agent || undefined,
      org: raw.org || org || '',
      score: r.similarity ?? 0,
      doc_type: r.type || 'text',
      filename: r.filename || '',
      chunk_index: r.chunk_index ?? null,
      total_chunks: r.total_chunks ?? null,
      content_full_length: r.content_full_length ?? null,
    }));

    return Response.json({
      results,
      total: raw.result_count ?? results.length,
      query: q,
      collection: raw.collection || `shared-${org}`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // If knowledge base not set up, return empty rather than 500
    if (message.includes('not set up') || message.includes('No collections')) {
      return Response.json({ results: [], total: 0, query: q, collection: `shared-${org}` });
    }
    console.error('[api/kb/search] Error:', message);
    return Response.json({ error: 'Knowledge base query failed' }, { status: 500 });
  }
}
