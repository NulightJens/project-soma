/**
 * /jobs/submit — freeform + structured job submission UI.
 *
 * Per ADR-014:
 *   - Primary tab is Freeform: user types a phrase, server's pattern parser
 *     resolves it into a structured intent (handler name + JSON data), the
 *     UI shows a confirmation card before any actual submission.
 *   - Advanced tab gives full control — handler dropdown, JSON data, queue,
 *     priority, max_attempts, idempotency_key.
 *
 * Untrusted submitter (ADR-014 invariant): never sends `--trusted`.
 * Protected names (shell, subagent, subagent_aggregator) get a 422 with the
 * equivalent CLI command pre-rendered for the operator to copy/paste.
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  IconRefresh,
  IconAlertTriangle,
  IconTerminal2,
  IconCircleCheck,
} from '@tabler/icons-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';

interface IntentPayload {
  name: string;
  data?: Record<string, unknown>;
  queue?: string;
  priority?: number;
}

interface ParseSuccess {
  ok: true;
  intent: IntentPayload;
  hint: string;
  source: string;
}

interface ParseFailure {
  ok: false;
  error: string;
  suggestions: string[];
}

type ParseResponse = ParseSuccess | ParseFailure;

interface SubmitSuccess {
  job: { id: number; name: string; queue: string; status: string };
}

interface ProtectedNameRefusal {
  error: 'protected_job_name';
  detail: string;
  cli_command: string;
}

type SubmitResponse =
  | SubmitSuccess
  | ProtectedNameRefusal
  | { error: string; detail?: string };

const HANDLER_OPTIONS: Array<{ value: string; label: string; hint: string }> = [
  { value: 'echo', label: 'echo', hint: 'returns input data + attempt number' },
  { value: 'noop', label: 'noop', hint: 'returns {}; smoke-tests claim+complete' },
  { value: 'sleep', label: 'sleep', hint: 'pauses for data.ms milliseconds' },
];

export default function JobSubmitPage() {
  const router = useRouter();

  // ── Freeform tab state ───────────────────────────────────
  const [freeformText, setFreeformText] = useState('');
  const [parseResult, setParseResult] = useState<ParseResponse | null>(null);
  const [parseLoading, setParseLoading] = useState(false);

  // ── Advanced tab state ───────────────────────────────────
  const [advName, setAdvName] = useState('echo');
  const [advData, setAdvData] = useState('{\n  "msg": "hello"\n}');
  const [advQueue, setAdvQueue] = useState('default');
  const [advPriority, setAdvPriority] = useState('0');
  const [advMaxAttempts, setAdvMaxAttempts] = useState('3');
  const [advIdempotencyKey, setAdvIdempotencyKey] = useState('');
  const [advError, setAdvError] = useState<string | null>(null);

  // ── Shared submit state ──────────────────────────────────
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitResult, setSubmitResult] = useState<SubmitResponse | null>(null);

  async function handleParse() {
    setParseLoading(true);
    setParseResult(null);
    setSubmitResult(null);
    try {
      const r = await fetch('/api/intents/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: freeformText }),
      });
      const json = (await r.json()) as ParseResponse;
      setParseResult(json);
    } catch (err) {
      setParseResult({
        ok: false,
        error: err instanceof Error ? err.message : 'network error',
        suggestions: [],
      });
    } finally {
      setParseLoading(false);
    }
  }

  async function submitIntent(intent: IntentPayload) {
    setSubmitLoading(true);
    setSubmitResult(null);
    try {
      const r = await fetch('/api/jobs/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(intent),
      });
      const json = (await r.json()) as SubmitResponse;
      setSubmitResult(json);
      if (r.ok && 'job' in json) {
        // Brief delay so the operator sees the success message, then route.
        setTimeout(() => router.push(`/jobs?focus=${json.job.id}`), 800);
      }
    } catch (err) {
      setSubmitResult({ error: err instanceof Error ? err.message : 'network error' });
    } finally {
      setSubmitLoading(false);
    }
  }

  async function handleAdvancedSubmit() {
    setAdvError(null);
    let parsedData: Record<string, unknown>;
    try {
      parsedData = advData.trim().length > 0 ? JSON.parse(advData) : {};
      if (typeof parsedData !== 'object' || parsedData === null || Array.isArray(parsedData)) {
        setAdvError('data must be a JSON object');
        return;
      }
    } catch (err) {
      setAdvError(`data is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    const priority = Number(advPriority);
    if (!Number.isInteger(priority)) {
      setAdvError('priority must be an integer');
      return;
    }
    const maxAttempts = Number(advMaxAttempts);
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      setAdvError('max_attempts must be a positive integer');
      return;
    }
    const intent: IntentPayload = {
      name: advName.trim(),
      data: parsedData,
      queue: advQueue.trim() || 'default',
      priority,
    };
    const fullPayload = {
      ...intent,
      max_attempts: maxAttempts,
      idempotency_key: advIdempotencyKey.trim() || undefined,
    };
    setSubmitLoading(true);
    setSubmitResult(null);
    try {
      const r = await fetch('/api/jobs/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullPayload),
      });
      const json = (await r.json()) as SubmitResponse;
      setSubmitResult(json);
      if (r.ok && 'job' in json) {
        setTimeout(() => router.push(`/jobs?focus=${json.job.id}`), 800);
      }
    } catch (err) {
      setSubmitResult({ error: err instanceof Error ? err.message : 'network error' });
    } finally {
      setSubmitLoading(false);
    }
  }

  return (
    <div className="container mx-auto p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Submit a job</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Adds a job to the SOMA Minions queue. The dashboard submits as an
          untrusted client — protected handlers (<code>shell</code>,{' '}
          <code>subagent</code>, <code>subagent_aggregator</code>) require the
          operator CLI.
        </p>
      </div>

      <Tabs defaultValue="freeform" className="w-full">
        <TabsList className="grid w-full max-w-xs grid-cols-2">
          <TabsTrigger value="freeform">Freeform</TabsTrigger>
          <TabsTrigger value="advanced">Advanced</TabsTrigger>
        </TabsList>

        {/* ── Freeform tab ───────────────────────────────── */}
        <TabsContent value="freeform" className="space-y-4">
          <Card className="p-4 space-y-3">
            <Label htmlFor="freeform-input">Describe the job</Label>
            <Textarea
              id="freeform-input"
              placeholder={'e.g. "echo hello", "sleep 5 seconds", "noop", or "<handler> {\\"key\\":\\"value\\"}"'}
              rows={3}
              value={freeformText}
              onChange={(e) => setFreeformText(e.target.value)}
              className="font-mono text-sm"
            />
            <div className="flex gap-2">
              <Button
                onClick={handleParse}
                disabled={parseLoading || freeformText.trim().length === 0}
              >
                {parseLoading ? (
                  <IconRefresh className="h-4 w-4 animate-spin" />
                ) : null}
                Parse intent
              </Button>
              {parseResult ? (
                <Button variant="ghost" onClick={() => { setParseResult(null); setFreeformText(''); }}>
                  Clear
                </Button>
              ) : null}
            </div>
          </Card>

          {parseResult && parseResult.ok ? (
            <Card className="p-4 space-y-3 border-foreground/40">
              <div className="flex items-start gap-3">
                <IconCircleCheck className="h-5 w-5 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <div className="font-medium">{parseResult.hint}</div>
                  <div className="text-xs text-muted-foreground font-mono">
                    matched: {parseResult.source}
                  </div>
                </div>
              </div>
              <Separator />
              <div className="font-mono text-xs whitespace-pre-wrap rounded bg-muted/50 p-3">
                {JSON.stringify(parseResult.intent, null, 2)}
              </div>
              <div className="flex gap-2">
                <Button onClick={() => submitIntent(parseResult.intent)} disabled={submitLoading}>
                  {submitLoading ? <IconRefresh className="h-4 w-4 animate-spin" /> : null}
                  Confirm and submit
                </Button>
                <Button variant="ghost" onClick={() => setParseResult(null)}>Edit</Button>
              </div>
            </Card>
          ) : null}

          {parseResult && !parseResult.ok ? (
            <Card className="p-4 space-y-2">
              <div className="flex items-start gap-2 text-sm">
                <IconAlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>{parseResult.error}</div>
              </div>
              {parseResult.suggestions.length > 0 ? (
                <ul className="text-xs text-muted-foreground space-y-1 ml-6 list-disc">
                  {parseResult.suggestions.map((s, i) => (
                    <li key={i} className="font-mono">{s}</li>
                  ))}
                </ul>
              ) : null}
            </Card>
          ) : null}
        </TabsContent>

        {/* ── Advanced tab ──────────────────────────────── */}
        <TabsContent value="advanced" className="space-y-4">
          <Card className="p-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="adv-name">Handler name</Label>
              <Input
                id="adv-name"
                value={advName}
                onChange={(e) => setAdvName(e.target.value)}
                placeholder="echo"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Built-in handlers: {HANDLER_OPTIONS.map((h) => `${h.label} (${h.hint})`).join(' · ')}.
                Other registered handlers also accepted.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="adv-data">Data (JSON object)</Label>
              <Textarea
                id="adv-data"
                value={advData}
                onChange={(e) => setAdvData(e.target.value)}
                rows={6}
                className="font-mono text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="adv-queue">Queue</Label>
                <Input id="adv-queue" value={advQueue} onChange={(e) => setAdvQueue(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="adv-priority">Priority (lower = sooner)</Label>
                <Input
                  id="adv-priority"
                  type="number"
                  value={advPriority}
                  onChange={(e) => setAdvPriority(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="adv-max">Max attempts</Label>
                <Input
                  id="adv-max"
                  type="number"
                  min={1}
                  value={advMaxAttempts}
                  onChange={(e) => setAdvMaxAttempts(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="adv-idem">Idempotency key (optional)</Label>
                <Input
                  id="adv-idem"
                  value={advIdempotencyKey}
                  onChange={(e) => setAdvIdempotencyKey(e.target.value)}
                  placeholder="leave empty for no dedup"
                />
              </div>
            </div>

            {advError ? (
              <div className="flex items-start gap-2 text-sm rounded bg-muted/50 p-2">
                <IconAlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>{advError}</div>
              </div>
            ) : null}

            <Button onClick={handleAdvancedSubmit} disabled={submitLoading}>
              {submitLoading ? <IconRefresh className="h-4 w-4 animate-spin" /> : null}
              Submit
            </Button>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Shared result panel ────────────────────────── */}
      {submitResult && 'job' in submitResult ? (
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm">
            <IconCircleCheck className="h-5 w-5" />
            <div>
              Submitted job <strong>#{submitResult.job.id}</strong> ({submitResult.job.name}) to queue{' '}
              <code>{submitResult.job.queue}</code> · status{' '}
              <code>{submitResult.job.status}</code>. Redirecting to /jobs…
            </div>
          </div>
        </Card>
      ) : null}

      {submitResult && 'error' in submitResult && submitResult.error === 'protected_job_name' ? (
        <Card className="p-4 space-y-3">
          <div className="flex items-start gap-2">
            <IconTerminal2 className="h-5 w-5 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Operator CLI required</div>
              <div className="text-sm text-muted-foreground">
                {(submitResult as ProtectedNameRefusal).detail}
              </div>
            </div>
          </div>
          <pre className="text-xs font-mono rounded bg-muted/50 p-3 overflow-x-auto">
            {(submitResult as ProtectedNameRefusal).cli_command}
          </pre>
          <p className="text-xs text-muted-foreground">
            Copy/paste this into a terminal where the SOMA CLI is available.
          </p>
        </Card>
      ) : null}

      {submitResult && 'error' in submitResult && submitResult.error !== 'protected_job_name' ? (
        <Card className="p-4 space-y-1">
          <div className="flex items-start gap-2 text-sm">
            <IconAlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Submission failed</div>
              <div className="text-muted-foreground">
                {submitResult.error}
                {'detail' in submitResult && submitResult.detail ? `: ${submitResult.detail}` : null}
              </div>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
