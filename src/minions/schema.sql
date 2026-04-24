-- SOMA Minions queue — SQLite schema
-- Ported from gbrain Postgres migrations (MIT © Garry Tan).
-- Deviations: Postgres-specific types mapped to SQLite affinities.
--   * TIMESTAMPTZ → INTEGER (Unix ms)
--   * JSONB       → TEXT (JSON-encoded)
--   * BIGSERIAL   → INTEGER PRIMARY KEY (rowid alias, autoincrementing)
--
-- PRAGMAs the owning engine should set on connection open:
--   PRAGMA journal_mode = WAL;          -- reader/writer concurrency
--   PRAGMA synchronous = NORMAL;        -- durable-on-commit, not per-write
--   PRAGMA foreign_keys = ON;           -- cascade deletes work
--   PRAGMA busy_timeout = 5000;         -- 5s wait for contended locks

-- =========================================================================
-- minion_jobs — the queue table
-- =========================================================================

CREATE TABLE IF NOT EXISTS minion_jobs (
  id                 INTEGER PRIMARY KEY,
  name               TEXT NOT NULL,
  queue              TEXT NOT NULL DEFAULT 'default',
  status             TEXT NOT NULL DEFAULT 'waiting'
                       CHECK (status IN (
                         'waiting', 'active', 'completed', 'failed',
                         'delayed', 'dead', 'cancelled',
                         'waiting-children', 'paused'
                       )),
  priority           INTEGER NOT NULL DEFAULT 0,
  data               TEXT NOT NULL DEFAULT '{}',            -- JSON

  -- Retry
  max_attempts       INTEGER NOT NULL DEFAULT 3,
  attempts_made      INTEGER NOT NULL DEFAULT 0,
  attempts_started   INTEGER NOT NULL DEFAULT 0,
  backoff_type       TEXT NOT NULL DEFAULT 'exponential'
                       CHECK (backoff_type IN ('fixed', 'exponential')),
  backoff_delay      INTEGER NOT NULL DEFAULT 5000,         -- ms
  backoff_jitter     INTEGER NOT NULL DEFAULT 0,            -- ms

  -- Stall detection
  stalled_counter    INTEGER NOT NULL DEFAULT 0,
  max_stalled        INTEGER NOT NULL DEFAULT 5
                       CHECK (max_stalled BETWEEN 1 AND 100),
  lock_token         TEXT,
  lock_until         INTEGER,                                -- Unix ms

  -- Scheduling
  delay_until        INTEGER,                                -- Unix ms

  -- Dependencies
  parent_job_id      INTEGER REFERENCES minion_jobs(id) ON DELETE CASCADE,
  on_child_fail      TEXT NOT NULL DEFAULT 'fail_parent'
                       CHECK (on_child_fail IN (
                         'fail_parent', 'remove_dep', 'ignore', 'continue'
                       )),

  -- Tokens
  tokens_input       INTEGER NOT NULL DEFAULT 0,
  tokens_output      INTEGER NOT NULL DEFAULT 0,
  tokens_cache_read  INTEGER NOT NULL DEFAULT 0,

  -- Depth + caps
  depth              INTEGER NOT NULL DEFAULT 0,
  max_children       INTEGER,
  timeout_ms         INTEGER,
  timeout_at         INTEGER,                                -- Unix ms
  remove_on_complete INTEGER NOT NULL DEFAULT 0,             -- 0/1
  remove_on_fail     INTEGER NOT NULL DEFAULT 0,
  idempotency_key    TEXT,

  -- Scheduler polish
  quiet_hours        TEXT,                                   -- JSON
  stagger_key        TEXT,

  -- Results
  result             TEXT,                                   -- JSON
  progress           TEXT,                                   -- JSON
  error_text         TEXT,
  stacktrace         TEXT NOT NULL DEFAULT '[]',             -- JSON array

  -- Timestamps
  created_at         INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000),
  started_at         INTEGER,
  finished_at        INTEGER,
  updated_at         INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
);

-- Claim path: waiting + delayed_until ready, sorted by priority then id.
CREATE INDEX IF NOT EXISTS minion_jobs_claim_idx
  ON minion_jobs (status, queue, priority, id)
  WHERE status IN ('waiting', 'delayed');

-- Stall sweep: find active jobs whose lock has expired.
CREATE INDEX IF NOT EXISTS minion_jobs_stall_idx
  ON minion_jobs (status, lock_until)
  WHERE status = 'active';

-- Parent → children lookup (cascade cancel, child_done fan-in).
CREATE INDEX IF NOT EXISTS minion_jobs_parent_idx
  ON minion_jobs (parent_job_id)
  WHERE parent_job_id IS NOT NULL;

-- Idempotency dedup (unique when key is set).
CREATE UNIQUE INDEX IF NOT EXISTS minion_jobs_idempotency_idx
  ON minion_jobs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- =========================================================================
-- minion_inbox — per-job message inbox (child_done + ad-hoc signals)
-- =========================================================================

CREATE TABLE IF NOT EXISTS minion_inbox (
  id         INTEGER PRIMARY KEY,
  job_id     INTEGER NOT NULL REFERENCES minion_jobs(id) ON DELETE CASCADE,
  sender     TEXT NOT NULL,
  payload    TEXT NOT NULL,                                  -- JSON
  sent_at    INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000),
  read_at    INTEGER
);

CREATE INDEX IF NOT EXISTS minion_inbox_unread_idx
  ON minion_inbox (job_id, sent_at)
  WHERE read_at IS NULL;

-- =========================================================================
-- minion_attachments — blob metadata (content stored separately, possibly on R2)
-- =========================================================================

CREATE TABLE IF NOT EXISTS minion_attachments (
  id           INTEGER PRIMARY KEY,
  job_id       INTEGER NOT NULL REFERENCES minion_jobs(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  content_type TEXT NOT NULL,
  storage_uri  TEXT,                                         -- 'file://...' | 'r2://...'
  size_bytes   INTEGER NOT NULL,
  sha256       TEXT NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000)
);

CREATE INDEX IF NOT EXISTS minion_attachments_job_idx
  ON minion_attachments (job_id);

-- =========================================================================
-- minion_rate_leases — Anthropic concurrency caps (SOMA: single-writer tx)
-- =========================================================================

CREATE TABLE IF NOT EXISTS minion_rate_leases (
  id          INTEGER PRIMARY KEY,
  scope       TEXT NOT NULL,                                 -- e.g. 'anthropic:opus'
  owner_job   INTEGER NOT NULL REFERENCES minion_jobs(id) ON DELETE CASCADE,
  acquired_at INTEGER NOT NULL DEFAULT (unixepoch('subsec') * 1000),
  released_at INTEGER
);

CREATE INDEX IF NOT EXISTS minion_rate_leases_live_idx
  ON minion_rate_leases (scope)
  WHERE released_at IS NULL;

-- =========================================================================
-- Triggers: keep updated_at fresh on every write to minion_jobs.
-- =========================================================================

CREATE TRIGGER IF NOT EXISTS minion_jobs_touch_updated
AFTER UPDATE ON minion_jobs
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE minion_jobs
     SET updated_at = unixepoch('subsec') * 1000
   WHERE id = NEW.id;
END;
