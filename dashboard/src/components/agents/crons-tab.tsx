'use client';

import { useState, useEffect } from 'react';
import { IconPlus, IconTrash, IconDeviceFloppy, IconClock } from '@tabler/icons-react';

interface Cron {
  name: string;
  type?: 'recurring' | 'once';
  interval?: string;
  fire_at?: string;
  prompt: string;
}

interface CronsTabProps {
  agentName: string;
}

export function CronsTab({ agentName }: CronsTabProps) {
  const [crons, setCrons] = useState<Cron[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetch(`/api/agents/${encodeURIComponent(agentName)}/crons`)
      .then(r => r.json())
      .then(data => {
        setCrons(data.crons || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [agentName]);

  const updateCron = (index: number, field: keyof Cron, value: string | undefined) => {
    setCrons(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
    setDirty(true);
    setMessage(null);
  };

  const addCron = () => {
    setCrons(prev => [...prev, { name: '', type: 'recurring', interval: '1h', prompt: '' }]);
    setDirty(true);
    setMessage(null);
  };

  const removeCron = (index: number) => {
    setCrons(prev => prev.filter((_, i) => i !== index));
    setDirty(true);
    setMessage(null);
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentName)}/crons`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ crons }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: 'error', text: data.error || 'Failed to save' });
      } else {
        setDirty(false);
        setMessage({ type: 'success', text: 'Saved. Agent notified to reload crons.' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error' });
    } finally {
      setSaving(false);
    }
  };

  const intervalToHuman = (cron: Cron): string => {
    if ((cron.type ?? 'recurring') === 'once') {
      if (!cron.fire_at) return 'One-time (no time set)';
      const d = new Date(cron.fire_at);
      return isNaN(d.getTime()) ? 'One-time (invalid time)' : `Once at ${d.toLocaleString()}`;
    }
    const interval = cron.interval ?? '';
    const match = interval.match(/^(\d+)([smhd])$/);
    if (!match) return interval;
    const [, num, unit] = match;
    const labels: Record<string, string> = { s: 'sec', m: 'min', h: 'hr', d: 'day' };
    return `Every ${num} ${labels[unit]}${Number(num) > 1 ? 's' : ''}`;
  };

  if (loading) {
    return <div className="p-6 text-muted-foreground">Loading crons...</div>;
  }

  return (
    <div className="space-y-4 p-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <IconClock size={18} className="text-muted-foreground" />
          <h3 className="text-sm font-medium">
            Scheduled Crons ({crons.length})
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={addCron}
            className="inline-flex items-center gap-1 rounded-md bg-secondary px-3 py-1.5 text-xs font-medium hover:bg-secondary/80"
          >
            <IconPlus size={14} />
            Add Cron
          </button>
          {dirty && (
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <IconDeviceFloppy size={14} />
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          )}
        </div>
      </div>

      {message && (
        <div
          className={`rounded-md px-3 py-2 text-xs ${
            message.type === 'success'
              ? 'bg-muted text-foreground'
              : 'bg-destructive/10 text-destructive'
          }`}
        >
          {message.text}
        </div>
      )}

      {crons.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No crons configured. Click "Add Cron" to create one.
        </div>
      ) : (
        <div className="space-y-3">
          {crons.map((cron, i) => (
            <div
              key={i}
              className="rounded-lg border bg-card p-4 space-y-3"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 grid grid-cols-[1fr_120px] gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground">Name</label>
                    <input
                      type="text"
                      value={cron.name}
                      onChange={e => updateCron(i, 'name', e.target.value)}
                      placeholder="heartbeat"
                      className="mt-1 block w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
                    />
                  </div>
                  <div>
                    {(cron.type ?? 'recurring') === 'once' ? (
                      <>
                        <label className="text-xs text-muted-foreground">Fire At (UTC)</label>
                        <input
                          type="datetime-local"
                          value={cron.fire_at ? cron.fire_at.slice(0, 16) : ''}
                          onChange={e => updateCron(i, 'fire_at', e.target.value ? new Date(e.target.value).toISOString() : undefined)}
                          className="mt-1 block w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
                        />
                      </>
                    ) : (
                      <>
                        <label className="text-xs text-muted-foreground">Interval</label>
                        <input
                          type="text"
                          value={cron.interval ?? ''}
                          onChange={e => updateCron(i, 'interval', e.target.value)}
                          placeholder="4h"
                          className="mt-1 block w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
                        />
                      </>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      {intervalToHuman(cron)}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => removeCron(i)}
                  className="ml-2 mt-5 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  title="Remove cron"
                >
                  <IconTrash size={14} />
                </button>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Prompt</label>
                <textarea
                  value={cron.prompt}
                  onChange={e => updateCron(i, 'prompt', e.target.value)}
                  placeholder="What the agent should do when this cron fires..."
                  rows={3}
                  className="mt-1 block w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none resize-y"
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Crons are read from config.json on agent startup. Changes here update config.json and notify the agent to reload.
        Interval format: number + unit (e.g. 5m, 1h, 6h, 1d).
      </p>
    </div>
  );
}
