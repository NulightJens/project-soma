'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CrmCopyTemplate } from '@/lib/data/crm-templates';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface Props {
  templates: CrmCopyTemplate[];
  sequencePurpose: Record<string, { label: string; trigger: string }>;
}

function substitute(body: string | null, name = 'James') {
  if (!body) return '';
  return body.replace(/\[Name\]/g, name);
}

function fmtAge(iso: string) {
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min}m ago`;
  if (min < 1440) return `${Math.floor(min / 60)}h ago`;
  return `${Math.floor(min / 1440)}d ago`;
}

function Row({ tpl, onClick, active }: { tpl: CrmCopyTemplate; onClick: () => void; active: boolean }) {
  const isSeed = tpl.updated_by === 'seed-crm-templates.js';
  return (
    <button
      onClick={onClick}
      data-testid={`template-row-${tpl.sequence_slug}-${tpl.step}-${tpl.variant}`}
      data-active={active ? 'true' : 'false'}
      className={`w-full text-left p-3 rounded border hover:bg-muted/50 transition-colors ${active ? 'bg-muted border-primary' : 'bg-card border-border'}`}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="text-xs font-mono text-muted-foreground">{tpl.sequence_slug} · step {tpl.step}{tpl.variant !== 'default' ? ` · ${tpl.variant}` : ''}</div>
        {isSeed
          ? <Badge variant="secondary" className="text-[10px]">seed</Badge>
          : <Badge className="text-[10px]">edited</Badge>}
      </div>
      <div className="text-sm line-clamp-2">{tpl.body ? tpl.body.slice(0, 140) : <span className="italic text-muted-foreground">empty — write it</span>}</div>
      <div className="text-[11px] text-muted-foreground mt-1">updated {fmtAge(tpl.updated_at)}{tpl.updated_by ? ` · by ${tpl.updated_by}` : ''}</div>
    </button>
  );
}

export function TemplateEditor({ templates, sequencePurpose }: Props) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(templates[0]?.id ?? null);
  const selected = templates.find((t) => t.id === selectedId) || null;

  const [body, setBody] = useState(selected?.body ?? '');
  const [cta, setCta] = useState(selected?.cta ?? '');
  const [notes, setNotes] = useState(selected?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  function select(id: string) {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setSelectedId(id);
    setBody(t.body ?? '');
    setCta(t.cta ?? '');
    setNotes(t.notes ?? '');
    setError(null);
    setSaved(null);
  }

  async function save() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch(`/api/crm/templates/${selected.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body, cta, notes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `status ${res.status}`);
      setSaved('saved');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
    } finally {
      setSaving(false);
    }
  }

  // Group templates by sequence for the left panel.
  const grouped: Record<string, CrmCopyTemplate[]> = {};
  for (const t of templates) {
    if (!grouped[t.sequence_slug]) grouped[t.sequence_slug] = [];
    grouped[t.sequence_slug].push(t);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4" data-testid="template-editor">
      <div className="space-y-4">
        {Object.entries(grouped).map(([slug, rows]) => (
          <Card key={slug}>
            <CardHeader>
              <CardTitle className="text-base">{sequencePurpose[slug]?.label ?? slug}</CardTitle>
              <p className="text-[11px] text-muted-foreground">{sequencePurpose[slug]?.trigger ?? '—'}</p>
            </CardHeader>
            <CardContent className="space-y-2">
              {rows.map((t) => <Row key={t.id} tpl={t} onClick={() => select(t.id)} active={t.id === selected?.id} />)}
            </CardContent>
          </Card>
        ))}
      </div>

      <div>
        {!selected ? (
          <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Select a template from the left to edit.</CardContent></Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{selected.sequence_slug} · step {selected.step}{selected.variant !== 'default' ? ` · ${selected.variant}` : ''}</CardTitle>
              <p className="text-[11px] text-muted-foreground">ID: <code>{selected.id}</code> · last edit {fmtAge(selected.updated_at)} by {selected.updated_by || 'unknown'}</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Body — write like a real DM. [Name] will be replaced with the recipient first name.</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="w-full min-h-[280px] rounded-md border bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-mono"
                  data-testid="template-body"
                  placeholder="Hey [Name], …"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">CTA (optional — use when a clear call-to-action beats a conversational close)</label>
                <Input data-testid="template-cta" value={cta ?? ''} onChange={(e) => setCta(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Internal notes (not sent to members)</label>
                <Input data-testid="template-notes" value={notes ?? ''} onChange={(e) => setNotes(e.target.value)} />
              </div>

              <div className="rounded border bg-muted/30 p-3">
                <div className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">Preview — substituted to James</div>
                <pre className="whitespace-pre-wrap text-[13px] leading-relaxed font-sans" data-testid="template-preview">{substitute(body, 'James')}</pre>
              </div>

              <div className="flex items-center gap-3">
                <Button onClick={save} disabled={saving} data-testid="template-save">
                  {saving ? 'Saving…' : 'Save template'}
                </Button>
                {saved && <span className="text-sm text-green-600" data-testid="template-saved">✓ {saved}</span>}
                {error && <span className="text-sm text-destructive" data-testid="template-error">{error}</span>}
              </div>

              <p className="text-[11px] text-muted-foreground pt-2 border-t">
                Saving updates this template in Supabase. New outreach rows (scheduled after save) automatically use the new copy. Existing ready rows still carry the OLD copy — click Refresh copy on the outreach queue detail modal to pull the latest.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
