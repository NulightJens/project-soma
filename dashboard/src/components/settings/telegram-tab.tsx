'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { IconCopy, IconEdit, IconCheck, IconX } from '@tabler/icons-react';
import { fetchTelegramConfigs, getFullToken, saveTelegramConfig } from '@/lib/actions/settings';
import type { TelegramConfig } from '@/lib/actions/settings';

interface EditState {
  key: string; // "org/agent"
  botToken: string;
  chatId: string;
  saving: boolean;
}

export function TelegramTab() {
  const [configs, setConfigs] = useState<TelegramConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<{ key: string; status: 'saved' | 'error'; message?: string } | null>(null);

  const load = useCallback(async () => {
    const data = await fetchTelegramConfigs();
    setConfigs(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCopy(agent: string, org: string, field: 'botToken' | 'chatId') {
    const full = await getFullToken(agent, org);
    if (!full) return;

    const value = field === 'botToken' ? full.botToken : full.chatId;
    if (!value || value === '-') return;

    await navigator.clipboard.writeText(value);
    const copyKey = `${org}/${agent}/${field}`;
    setCopiedField(copyKey);
    setTimeout(() => setCopiedField(null), 1500);
  }

  async function handleEdit(agent: string, org: string) {
    const full = await getFullToken(agent, org);
    if (!full) return;

    setEditing({
      key: `${org}/${agent}`,
      botToken: full.botToken,
      chatId: full.chatId,
      saving: false,
    });
  }

  function handleCancelEdit() {
    setEditing(null);
  }

  async function handleSave() {
    if (!editing) return;

    const [org, agent] = editing.key.split('/');
    setEditing((prev) => prev ? { ...prev, saving: true } : null);

    const result = await saveTelegramConfig(agent, org, editing.botToken, editing.chatId);

    if (result.success) {
      setSaveStatus({ key: editing.key, status: 'saved' });
      setEditing(null);
      await load(); // Refresh data
      setTimeout(() => setSaveStatus(null), 2000);
    } else {
      setSaveStatus({ key: editing.key, status: 'error', message: result.error });
      setEditing((prev) => prev ? { ...prev, saving: false } : null);
      setTimeout(() => setSaveStatus(null), 3000);
    }
  }

  if (loading) {
    return <div className="h-32 rounded-xl bg-muted/30 animate-pulse" />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Telegram Integration</CardTitle>
      </CardHeader>
      <CardContent>
        {configs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No Telegram configurations found. Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID
            to agent .env files to configure Telegram notifications.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Org</TableHead>
                <TableHead>Bot Token</TableHead>
                <TableHead>Chat ID</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {configs.map((c) => {
                const rowKey = `${c.org}/${c.agent}`;
                const isEditing = editing?.key === rowKey;
                const rowSaveStatus = saveStatus?.key === rowKey ? saveStatus : null;

                return (
                  <TableRow key={rowKey}>
                    <TableCell className="font-medium">{c.agent}</TableCell>
                    <TableCell>{c.org}</TableCell>

                    {/* Bot Token */}
                    <TableCell>
                      {isEditing ? (
                        <Input
                          value={editing.botToken}
                          onChange={(e) =>
                            setEditing((prev) =>
                              prev ? { ...prev, botToken: e.target.value } : null,
                            )
                          }
                          className="h-8 font-mono text-xs"
                        />
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                            {c.botToken}
                          </code>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => handleCopy(c.agent, c.org, 'botToken')}
                            title="Copy bot token"
                          >
                            {copiedField === `${c.org}/${c.agent}/botToken` ? (
                              <IconCheck className="h-3.5 w-3.5 text-green-600" />
                            ) : (
                              <IconCopy className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                          </Button>
                        </div>
                      )}
                    </TableCell>

                    {/* Chat ID */}
                    <TableCell>
                      {isEditing ? (
                        <Input
                          value={editing.chatId}
                          onChange={(e) =>
                            setEditing((prev) =>
                              prev ? { ...prev, chatId: e.target.value } : null,
                            )
                          }
                          className="h-8 font-mono text-xs"
                        />
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                            {c.chatId}
                          </code>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => handleCopy(c.agent, c.org, 'chatId')}
                            title="Copy chat ID"
                          >
                            {copiedField === `${c.org}/${c.agent}/chatId` ? (
                              <IconCheck className="h-3.5 w-3.5 text-green-600" />
                            ) : (
                              <IconCopy className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                          </Button>
                        </div>
                      )}
                    </TableCell>

                    {/* Actions */}
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {isEditing ? (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={handleSave}
                              disabled={editing.saving}
                              title="Save"
                            >
                              <IconCheck className="h-4 w-4 text-green-600" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={handleCancelEdit}
                              disabled={editing.saving}
                              title="Cancel"
                            >
                              <IconX className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => handleEdit(c.agent, c.org)}
                            title="Edit"
                          >
                            <IconEdit className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        )}
                        {rowSaveStatus?.status === 'saved' && (
                          <span className="text-xs text-green-600">Saved</span>
                        )}
                        {rowSaveStatus?.status === 'error' && (
                          <span className="text-xs text-destructive">{rowSaveStatus.message ?? 'Error'}</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
