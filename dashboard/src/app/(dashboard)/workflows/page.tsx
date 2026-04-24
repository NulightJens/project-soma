'use client';

import { useState, useEffect, useCallback } from 'react';
import { useOrg } from '@/hooks/use-org';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  IconClock,
  IconPlus,
  IconTrash,
  IconEdit,
  IconCheck,
  IconX,
  IconRefresh,
  IconChevronDown,
  IconChevronUp,
  IconRobot,
} from '@tabler/icons-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Cron {
  name: string;
  type?: 'recurring' | 'once';
  interval?: string;
  cron?: string;        // raw crontab expression (e.g. "0 9 * * *")
  fire_at?: string;     // ISO datetime for once-type crons
  prompt: string;
}

interface AgentCrons {
  name: string;
  org: string;
  crons: Cron[];
  loading: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function intervalToHuman(interval: string | undefined): string {
  if (!interval) return '?';
  const match = interval.match(/^(\d+)([smhd])$/);
  if (!match) return interval;
  const n = parseInt(match[1]);
  const unit = match[2];
  const units: Record<string, string> = {
    s: n === 1 ? 'second' : 'seconds',
    m: n === 1 ? 'minute' : 'minutes',
    h: n === 1 ? 'hour' : 'hours',
    d: n === 1 ? 'day' : 'days',
  };
  return `${n} ${units[unit]}`;
}

function validateInterval(interval: string | undefined): boolean {
  if (!interval) return false;
  return /^\d+[smhd]$/.test(interval);
}

function validateName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name) && name.length > 0;
}

function slugifyName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function WorkflowsPage() {
  const { currentOrg } = useOrg();
  const [agents, setAgents] = useState<AgentCrons[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [editingCron, setEditingCron] = useState<{ agent: string; index: number } | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  // New cron form state
  const [newCron, setNewCron] = useState<Cron>({ name: '', interval: '5m', prompt: '' });

  // Edit cron form state
  const [editCron, setEditCron] = useState<Cron>({ name: '', interval: '', prompt: '' });

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/agents');
      const agentList: { name: string; org: string }[] = await res.json();

      const results: AgentCrons[] = await Promise.all(
        agentList.map(async (agent) => {
          try {
            const cronRes = await fetch(`/api/agents/${encodeURIComponent(agent.name)}/crons`);
            const data = await cronRes.json();
            return {
              name: agent.name,
              org: agent.org,
              crons: data.crons ?? [],
              loading: false,
              error: null,
            };
          } catch {
            return {
              name: agent.name,
              org: agent.org,
              crons: [],
              loading: false,
              error: 'Failed to load crons',
            };
          }
        }),
      );

      // Sort: agents with crons first, then alphabetical
      results.sort((a, b) => {
        if (a.crons.length > 0 && b.crons.length === 0) return -1;
        if (a.crons.length === 0 && b.crons.length > 0) return 1;
        return a.name.localeCompare(b.name);
      });

      setAgents(results);
      if (results.length > 0 && !expandedAgent) {
        setExpandedAgent(results[0].name);
      }
    } catch (err) {
      console.error('Failed to fetch agents:', err);
    } finally {
      setLoading(false);
    }
  }, [expandedAgent]);

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save crons for an agent
  const saveCrons = async (agentName: string, crons: Cron[]) => {
    setSaving(agentName);
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentName)}/crons`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ crons }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save');
      }
      setAgents((prev) =>
        prev.map((a) =>
          a.name === agentName ? { ...a, crons, error: null } : a,
        ),
      );
    } catch (err) {
      setAgents((prev) =>
        prev.map((a) =>
          a.name === agentName
            ? { ...a, error: err instanceof Error ? err.message : 'Save failed' }
            : a,
        ),
      );
    } finally {
      setSaving(null);
    }
  };

  // Delete a cron
  const deleteCron = (agentName: string, index: number) => {
    const agent = agents.find((a) => a.name === agentName);
    if (!agent) return;
    const updated = agent.crons.filter((_, i) => i !== index);
    saveCrons(agentName, updated);
  };

  // Add a cron
  const addCron = (agentName: string) => {
    if (!validateName(newCron.name) || !validateInterval(newCron.interval) || !newCron.prompt.trim()) {
      return;
    }
    const agent = agents.find((a) => a.name === agentName);
    if (!agent) return;

    if (agent.crons.some((c) => c.name === newCron.name)) {
      setAgents((prev) =>
        prev.map((a) =>
          a.name === agentName ? { ...a, error: `Cron "${newCron.name}" already exists` } : a,
        ),
      );
      return;
    }

    const updated = [...agent.crons, { ...newCron }];
    saveCrons(agentName, updated);
    setNewCron({ name: '', interval: '5m', prompt: '' });
    setAddingTo(null);
  };

  // Save edit
  const saveEdit = (agentName: string, index: number) => {
    if (!validateName(editCron.name) || !validateInterval(editCron.interval) || !editCron.prompt.trim()) {
      return;
    }
    const agent = agents.find((a) => a.name === agentName);
    if (!agent) return;

    if (agent.crons.some((c, i) => c.name === editCron.name && i !== index)) {
      setAgents((prev) =>
        prev.map((a) =>
          a.name === agentName ? { ...a, error: `Cron "${editCron.name}" already exists` } : a,
        ),
      );
      return;
    }

    const updated = agent.crons.map((c, i) => (i === index ? { ...editCron } : c));
    saveCrons(agentName, updated);
    setEditingCron(null);
  };

  const displayedAgents = currentOrg === 'all' ? agents : agents.filter((a) => a.org === currentOrg);
  const totalCrons = displayedAgents.reduce((sum, a) => sum + a.crons.length, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Workflows</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage scheduled crons across all agents
          </p>
        </div>
        <button
          onClick={fetchAll}
          className="p-2 rounded-md hover:bg-muted transition-colors"
          title="Refresh"
        >
          <IconRefresh size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Crons</p>
            <p className="text-2xl font-semibold mt-1">
              {loading && agents.length === 0 ? <span className="text-muted-foreground">–</span> : totalCrons}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Agents</p>
            <p className="text-2xl font-semibold mt-1">
              {loading && agents.length === 0 ? (
                <span className="text-muted-foreground">–</span>
              ) : (
                <>
                  {displayedAgents.filter((a) => a.crons.length > 0).length}
                  <span className="text-sm text-muted-foreground font-normal">
                    {' '}/ {displayedAgents.length}
                  </span>
                </>
              )}
            </p>
          </CardContent>
        </Card>
        <Card className="col-span-2 md:col-span-1">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Most Active</p>
            <p className="text-2xl font-semibold mt-1">
              {loading && agents.length === 0
                ? <span className="text-muted-foreground">–</span>
                : displayedAgents.length > 0
                  ? displayedAgents.reduce((max, a) => (a.crons.length > max.crons.length ? a : max)).name
                  : '-'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Loading */}
      {loading && agents.length === 0 && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-lg bg-muted/30 animate-pulse" />
          ))}
        </div>
      )}

      {/* Agent cron sections */}
      {displayedAgents.map((agent) => {
        const isExpanded = expandedAgent === agent.name;
        const isSaving = saving === agent.name;

        return (
          <Card key={agent.name}>
            <button
              className="w-full text-left"
              onClick={() => setExpandedAgent(isExpanded ? null : agent.name)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <IconRobot size={18} className="text-muted-foreground" />
                    <CardTitle className="text-base">{agent.name}</CardTitle>
                    <span className="text-xs text-muted-foreground">{agent.org}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant="secondary" className="text-[11px]">
                      {agent.crons.length} cron{agent.crons.length !== 1 ? 's' : ''}
                    </Badge>
                    {isExpanded ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
                  </div>
                </div>
              </CardHeader>
            </button>

            {isExpanded && (
              <CardContent className="pt-0 space-y-3">
                {/* Error banner */}
                {agent.error && (
                  <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive flex items-center justify-between">
                    <span>{agent.error}</span>
                    <button
                      onClick={() =>
                        setAgents((prev) =>
                          prev.map((a) => (a.name === agent.name ? { ...a, error: null } : a)),
                        )
                      }
                    >
                      <IconX size={14} />
                    </button>
                  </div>
                )}

                {/* Cron list */}
                {agent.crons.length === 0 && addingTo !== agent.name && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No crons configured
                  </p>
                )}

                {agent.crons.map((cron, idx) => {
                  const isEditing =
                    editingCron?.agent === agent.name && editingCron?.index === idx;

                  if (isEditing) {
                    return (
                      <div
                        key={`edit-${cron.name}`}
                        className="rounded-md border border-primary/30 px-3 py-3 space-y-2"
                      >
                        <div className="flex gap-2">
                          <Input
                            value={editCron.name}
                            onChange={(e) => setEditCron({ ...editCron, name: slugifyName(e.target.value) })}
                            placeholder="cron-name"
                            className="flex-1 h-8 text-sm"
                          />
                          <Input
                            value={editCron.interval}
                            onChange={(e) =>
                              setEditCron({ ...editCron, interval: e.target.value })
                            }
                            placeholder="e.g. 5m, 2h"
                            className="w-24 h-8 text-sm"
                          />
                        </div>
                        <Textarea
                          value={editCron.prompt}
                          onChange={(e) => setEditCron({ ...editCron, prompt: e.target.value })}
                          placeholder="Prompt..."
                          className="text-sm min-h-[60px]"
                        />
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingCron(null)}
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => saveEdit(agent.name, idx)}
                            disabled={
                              !validateName(editCron.name) ||
                              !validateInterval(editCron.interval) ||
                              !editCron.prompt.trim()
                            }
                          >
                            <IconCheck size={14} className="mr-1" />
                            Save
                          </Button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={cron.name}
                      className="rounded-md border px-3 py-2.5 group hover:border-foreground/20 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <IconClock size={14} className="text-muted-foreground shrink-0" />
                            <span className="text-sm font-medium">{cron.name}</span>
                            <Badge variant="outline" className="text-[10px]">
                              {cron.fire_at
                                ? `once at ${new Date(cron.fire_at).toLocaleString()}`
                                : cron.cron
                                  ? `cron: ${cron.cron}`
                                  : `every ${intervalToHuman(cron.interval)}`}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                            {cron.prompt}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity shrink-0">
                          <button
                            className="p-1.5 rounded hover:bg-muted"
                            title="Edit"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditCron({ ...cron });
                              setEditingCron({ agent: agent.name, index: idx });
                            }}
                          >
                            <IconEdit size={16} />
                          </button>
                          <button
                            className="p-1.5 rounded hover:bg-destructive/10 text-destructive"
                            title="Delete"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteCron(agent.name, idx);
                            }}
                          >
                            <IconTrash size={16} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Add cron form */}
                {addingTo === agent.name ? (
                  <div className="rounded-md border border-dashed border-primary/30 px-3 py-3 space-y-2">
                    <div className="flex gap-2">
                      <Input
                        value={newCron.name}
                        onChange={(e) => setNewCron({ ...newCron, name: slugifyName(e.target.value) })}
                        placeholder="cron-name (e.g. daily-report)"
                        className="flex-1 h-8 text-sm"
                        autoFocus
                      />
                      <Input
                        value={newCron.interval}
                        onChange={(e) => setNewCron({ ...newCron, interval: e.target.value })}
                        placeholder="e.g. 5m, 2h, 1d"
                        className="w-28 h-8 text-sm"
                      />
                    </div>
                    <Textarea
                      value={newCron.prompt}
                      onChange={(e) => setNewCron({ ...newCron, prompt: e.target.value })}
                      placeholder="Prompt that runs on each interval..."
                      className="text-sm min-h-[60px]"
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setAddingTo(null);
                          setNewCron({ name: '', interval: '5m', prompt: '' });
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => addCron(agent.name)}
                        disabled={
                          !validateName(newCron.name) ||
                          !validateInterval(newCron.interval) ||
                          !newCron.prompt.trim() ||
                          isSaving
                        }
                      >
                        {isSaving ? (
                          <IconRefresh size={14} className="mr-1 animate-spin" />
                        ) : (
                          <IconPlus size={14} className="mr-1" />
                        )}
                        Add Cron
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full border-dashed"
                    onClick={() => {
                      setAddingTo(agent.name);
                      setNewCron({ name: '', interval: '5m', prompt: '' });
                    }}
                  >
                    <IconPlus size={14} className="mr-1" />
                    Add Cron
                  </Button>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
