# Multi-Machine Agent Orchestration — Architecture Design

**Issue:** #29  
**Status:** Design — not yet implemented  
**Last updated:** 2026-04-06

---

## Problem

cortextOS is a single-machine system. Every bus primitive — messages, tasks, approvals, events, heartbeats — is a local filesystem operation under `~/.cortextos/{instance}/`. Agents on separate machines cannot communicate. The dashboard reads files via Chokidar and cannot reach agents on other hosts.

This document specifies Option A (Supabase) from issue #29, which is the recommended long-term solution.

---

## Goals

1. Any agent on any machine can send messages to any other agent
2. Dashboard shows live state across the full fleet regardless of host
3. Existing single-machine deployments continue to work unchanged (file bus as offline fallback)
4. Secrets are not stored in per-machine `.env` files

## Non-Goals

- Real-time binary streaming (audio, video, large file transfer)
- Sub-100ms latency (Telegram already sets this floor)
- On-premise / self-hosted Supabase (out of scope for v1)

---

## Proposed Architecture

### Transport: Supabase

All bus state migrates from local JSON files to Supabase Postgres tables. Supabase is chosen because:

- Realtime subscriptions replace Chokidar file watchers (dashboard)
- Row-level security (RLS) enables per-org access control
- Supabase Edge Functions can implement bus routing logic
- Free tier is sufficient for a typical agent fleet
- One Supabase project = one `CTX_INSTANCE_ID`

### Abstraction Layer

A `BusAdapter` interface is introduced. The file bus and the Supabase bus both implement it. Agents never call Supabase directly.

```typescript
interface BusAdapter {
  // Messages
  sendMessage(from: string, to: string, priority: Priority, text: string): Promise<string>; // returns msg id
  checkInbox(agent: string): Promise<InboxMessage[]>;
  ackInbox(id: string): Promise<void>;

  // Tasks
  createTask(task: Omit<Task, 'id' | 'created_at' | 'updated_at'>): Promise<Task>;
  updateTask(id: string, updates: Partial<Task>): Promise<Task>;
  listTasks(filters: TaskFilters): Promise<Task[]>;

  // Heartbeats
  writeHeartbeat(heartbeat: Heartbeat): Promise<void>;
  readAllHeartbeats(org?: string): Promise<Heartbeat[]>;

  // Events
  logEvent(event: Event): Promise<void>;
  listEvents(filters: EventFilters): Promise<Event[]>;

  // Approvals
  createApproval(approval: Omit<Approval, 'id' | 'created_at' | 'updated_at'>): Promise<Approval>;
  updateApproval(id: string, updates: Partial<Approval>): Promise<Approval>;
  listApprovals(filters: ApprovalFilters): Promise<Approval[]>;
}
```

The adapter is selected at runtime:

```typescript
// In env/paths resolution:
const adapter = process.env.CTX_SUPABASE_URL
  ? new SupabaseBusAdapter(supabaseUrl, supabaseKey, instanceId)
  : new FileBusAdapter(ctxRoot);
```

No agent code or template changes are required — everything routes through the same `cortextos bus` CLI commands.

---

## Supabase Schema

### Instance / Org isolation

Every row includes `instance_id` (maps to `CTX_INSTANCE_ID`). RLS policies restrict rows to authenticated callers with matching `instance_id`.

### Tables

#### `inbox_messages`

```sql
CREATE TABLE inbox_messages (
  id          TEXT PRIMARY KEY,           -- existing format: timestamp-agent-rand
  instance_id TEXT NOT NULL,
  from_agent  TEXT NOT NULL,
  to_agent    TEXT NOT NULL,
  priority    TEXT NOT NULL CHECK (priority IN ('urgent','high','normal','low')),
  text        TEXT NOT NULL,
  reply_to    TEXT,
  sig         TEXT,                       -- HMAC signature (existing H10 security)
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','inflight','processed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);
CREATE INDEX ON inbox_messages (instance_id, to_agent, status);
```

#### `tasks`

```sql
CREATE TABLE tasks (
  id           TEXT PRIMARY KEY,
  instance_id  TEXT NOT NULL,
  org          TEXT NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT,
  type         TEXT NOT NULL CHECK (type IN ('agent','human')),
  needs_approval BOOLEAN DEFAULT false,
  status       TEXT NOT NULL CHECK (status IN ('pending','in_progress','completed','blocked','cancelled')),
  assigned_to  TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  priority     TEXT NOT NULL,
  project      TEXT,
  kpi_key      TEXT,
  result       TEXT,
  archived     BOOLEAN DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  due_date     TIMESTAMPTZ
);
CREATE INDEX ON tasks (instance_id, org, assigned_to, status);
```

#### `heartbeats`

```sql
CREATE TABLE heartbeats (
  agent        TEXT NOT NULL,
  instance_id  TEXT NOT NULL,
  org          TEXT NOT NULL,
  display_name TEXT,
  status       TEXT,
  current_task TEXT,
  mode         TEXT,
  loop_interval TEXT,
  last_heartbeat TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (agent, instance_id)
);
```

#### `events`

```sql
CREATE TABLE events (
  id          TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  agent       TEXT NOT NULL,
  org         TEXT NOT NULL,
  category    TEXT NOT NULL,
  event       TEXT NOT NULL,
  severity    TEXT NOT NULL,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON events (instance_id, org, agent, created_at DESC);
```

#### `approvals`

```sql
CREATE TABLE approvals (
  id               TEXT PRIMARY KEY,
  instance_id      TEXT NOT NULL,
  org              TEXT NOT NULL,
  title            TEXT NOT NULL,
  requesting_agent TEXT NOT NULL,
  category         TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',
  description      TEXT,
  resolved_by      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at      TIMESTAMPTZ
);
```

#### `secrets` (replaces per-machine `.env`)

```sql
CREATE TABLE secrets (
  key          TEXT NOT NULL,
  instance_id  TEXT NOT NULL,
  org          TEXT,                      -- null = instance-wide
  value        TEXT NOT NULL,             -- encrypted at rest via Supabase Vault
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (key, instance_id, COALESCE(org, ''))
);
```

Agents read secrets via `cortextos secrets get <key>` — never touch the table directly.

---

## Dashboard Migration

The Next.js dashboard currently reads files from `CTX_FRAMEWORK_ROOT` via Chokidar watchers. Replace with Supabase Realtime subscriptions:

```typescript
// current (file-based)
watch(path.join(ctxRoot, 'inbox', agentName)).on('change', refresh);

// new (Supabase realtime)
supabase
  .channel('heartbeats')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'heartbeats' }, refresh)
  .subscribe();
```

No dashboard page logic changes — only the data layer changes. Each page that currently calls `readFileSync` calls the Supabase client instead.

---

## Migration Phases

### Phase 0: Adapter Interface (no behavior change)

- Define `BusAdapter` interface
- Wrap existing bus functions in `FileBusAdapter`
- Wire adapter selection via `CTX_SUPABASE_URL` env var
- All tests continue to use `FileBusAdapter` (no Supabase in CI)
- **Deliverable:** Adapter pattern in place, zero behavior change

### Phase 1: Heartbeats + Events (lowest risk, highest visibility)

- Implement `SupabaseBusAdapter.writeHeartbeat()` and `logEvent()`
- These are write-only, non-critical — failure degrades gracefully to no-op
- Dashboard realtime heartbeat panel goes live
- **Deliverable:** Live fleet status across machines on dashboard

### Phase 2: Messages (requires reliable delivery)

- Implement inbox send/read/ack on Supabase
- Message delivery guarantee: at-least-once (same as current file bus)
- Dedup via existing hash mechanism
- HMAC signatures still enforced
- **Deliverable:** Cross-machine agent messaging

### Phase 3: Tasks + Approvals

- Tasks and approvals migrate to Supabase
- Dashboard task board and approval queue go live across machines
- **Deliverable:** Full cross-machine coordination

### Phase 4: Secrets + Org Config

- `secrets` table replaces per-machine `.env` for shared org secrets
- `cortextos init` provisions Supabase tables on first run
- `cortextos secrets set/get` CLI commands
- **Deliverable:** No per-machine secret management for shared agents

### Phase 5: File bus deprecation

- File bus kept as read-only offline fallback
- Warn on startup if using file bus in multi-agent mode
- Remove file-write paths from bus commands (reads only, for migration)

---

## Configuration

```bash
# In orgs/{org}/secrets.env (or Supabase secrets table after Phase 4)
CTX_SUPABASE_URL=https://<project>.supabase.co
CTX_SUPABASE_ANON_KEY=<anon_key>
# Optional: service role key for admin ops (secrets table)
CTX_SUPABASE_SERVICE_KEY=<service_key>
```

`CTX_INSTANCE_ID` becomes the Supabase tenant identifier. Multiple instances can share one Supabase project with full isolation via `instance_id` column.

---

## Security Considerations

- **RLS policies** must be enabled on all tables. Agents authenticate as `anon` with instance-scoped JWT.
- **HMAC signatures** on messages remain mandatory — Supabase transport does not replace message signing.
- **Secrets table** must use Supabase Vault (encrypted at rest). Never store secrets as plaintext.
- **Rate limiting** on `inbox_messages` inserts to prevent message flooding.
- **Audit log**: all approval row changes logged to `events` table.

---

## Open Questions

1. **Authentication model**: Should each agent have its own Supabase JWT, or does the instance share one? Per-agent JWTs enable tighter RLS but require key distribution across machines.

2. **Offline resilience**: If Supabase is unreachable, agents should fall back to local file queue and replay when connectivity returns. How long should the local buffer be retained?

3. **Large payloads**: Tasks and events with large `metadata` or `description` fields will hit Supabase row limits (~1MB). Should blobs be stored in Supabase Storage with a URL reference in the row?

4. **Migration tooling**: Existing local file bus data (tasks, events, heartbeats) needs a migration command to seed Supabase on first run. Define `cortextos migrate --to-supabase`.

5. **Dashboard auth**: The existing dashboard auth system (logins) currently gates filesystem access. After migration, it should gate Supabase RLS policy — is this additive or a replacement?

6. **0.3 secrets design**: The `secrets` table design here should be validated against the 0.3 roadmap before Phase 4 begins. Doing file-based secrets in 0.3 and migrating in Phase 4 is acceptable only if the Phase 4 migration is automated.

---

## Effort Estimate

| Phase | Scope | Complexity |
|-------|-------|------------|
| 0: Adapter pattern | ~300 LOC, no behavior change | Low |
| 1: Heartbeats + Events | ~400 LOC + Supabase schema | Low |
| 2: Messages | ~500 LOC, delivery guarantees | Medium |
| 3: Tasks + Approvals | ~600 LOC + dashboard updates | Medium |
| 4: Secrets | ~300 LOC + key distribution | High |
| 5: File bus deprecation | ~200 LOC cleanup | Low |

Total: approximately 3-4 weeks of focused implementation across all phases.

---

## References

- Current file bus: `src/bus/message.ts`, `src/bus/task.ts`, `src/bus/heartbeat.ts`, `src/bus/event.ts`
- Dashboard file reads: `dashboard/src/lib/`
- Supabase Realtime docs: https://supabase.com/docs/guides/realtime
- Issue #29: multi-machine agent orchestration
