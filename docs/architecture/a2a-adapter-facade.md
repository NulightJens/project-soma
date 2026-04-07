# A2A Adapter Facade — Architecture Design

**Status:** Design — not yet implemented  
**Priority:** Urgent (competitive: Hermes may ship A2A first)  
**Last updated:** 2026-04-06

---

## What is A2A?

Google's Agent-to-Agent (A2A) protocol is an open standard for interoperability between AI agent frameworks. An agent that implements A2A can receive tasks from, and send results to, any other A2A-compatible agent — regardless of which framework either agent runs on.

Key primitives:

| Concept | Description |
|---------|-------------|
| **Agent Card** | JSON document at `/.well-known/agent.json` describing the agent's capabilities, skills, and endpoints |
| **Task** | Unit of work: `submitted → working → input-required → completed/failed/canceled` |
| **Message** | A turn in the task conversation. Has a `role` (user/agent) and `parts` |
| **Part** | Content unit: `TextPart`, `FilePart`, or `DataPart` |
| **Artifact** | Structured output returned when a task completes |
| **Push notification** | Webhook-based async task updates |

Reference spec: https://google.github.io/A2A/

---

## Goal

Add a thin HTTP facade that makes any cortextOS agent appear as an A2A-compatible agent to external callers. Existing bus protocol stays unchanged. No agent templates need to be modified. This is a facade only — the cortextOS bus remains the internal transport.

**Explicitly not in scope:**
- Replacing the cortextOS bus with A2A internally
- Supporting all optional A2A extensions (streaming SSE, multi-turn file artifacts)
- Full A2A client (outbound calls to other A2A agents) — v1 is server-side only

---

## Architecture

```
External A2A Caller
       │
       │  HTTP POST /tasks/send
       │  GET /.well-known/agent.json
       ▼
┌─────────────────────────┐
│   A2A Adapter Facade    │  ← new: src/a2a/
│   (Express HTTP server) │
└────────────┬────────────┘
             │ translate
             ▼
┌─────────────────────────┐
│   cortextOS Bus         │  ← existing: src/bus/
│   (file or Supabase)    │
└─────────────────────────┘
             │
             ▼
┌─────────────────────────┐
│   Agent PTY             │  ← existing: src/pty/
│   (Claude Code)         │
└─────────────────────────┘
```

The facade runs as a sidecar alongside the daemon. It exposes a minimal A2A HTTP API, translates requests to cortextOS bus messages, and polls the bus for responses.

---

## Component Design

### `src/a2a/server.ts` — HTTP server

```typescript
class A2AServer {
  private app: Express;
  private port: number;
  private agentName: string;
  private paths: BusPaths;

  constructor(agentName: string, paths: BusPaths, port: number = 41241) { ... }

  start(): void {
    this.app.get('/.well-known/agent.json', this.handleAgentCard);
    this.app.post('/tasks/send', this.handleTaskSend);
    this.app.get('/tasks/:taskId', this.handleTaskGet);
    this.app.post('/tasks/:taskId/cancel', this.handleTaskCancel);
    this.app.listen(this.port);
  }
}
```

Default port: **41241** (A2A community convention).

### `src/a2a/agent-card.ts` — Agent Card generator

Reads the agent's IDENTITY.md, config.json, and skills directory to produce the Agent Card:

```typescript
function buildAgentCard(agentName: string, frameworkRoot: string, port: number): AgentCard {
  return {
    name: displayName || agentName,          // from IDENTITY.md ## Name
    description: role,                       // from IDENTITY.md ## Role
    url: `http://localhost:${port}`,
    version: "1.0.0",
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    skills: discoverSkills(agentName, frameworkRoot),  // from .claude/skills/*/SKILL.md
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
  };
}
```

Skills are read from SKILL.md frontmatter `name` and `description` fields — no code changes to skill files needed.

### `src/a2a/task-bridge.ts` — Task translation layer

Translates between A2A task states and cortextOS bus operations:

```typescript
// Incoming A2A task → cortextOS bus message
async function submitTask(task: A2ATaskRequest, paths: BusPaths): Promise<string> {
  const text = extractText(task.message.parts);
  const msgId = await sendMessage(paths, 'a2a-gateway', agentName, 'normal', text);
  
  // Store A2A task state indexed by cortextOS message ID
  writeA2ATaskState(paths, task.id, { status: 'working', cortextosMessageId: msgId });
  
  return task.id;
}

// Poll cortextOS bus for response → A2A task result
async function pollForResult(taskId: string, paths: BusPaths): Promise<A2ATask> {
  const state = readA2ATaskState(paths, taskId);
  const response = findResponseToMessage(paths, state.cortextosMessageId);
  
  if (!response) return { ...state, status: 'working' };
  
  return {
    ...state,
    status: 'completed',
    artifacts: [{ parts: [{ type: 'text', text: response.text }] }],
  };
}
```

A2A task state is stored in `{ctxRoot}/state/{agent}/a2a-tasks/{taskId}.json`. This is ephemeral — tasks are not replicated across machines (out of scope for v1).

### `src/a2a/types.ts` — A2A type definitions

Minimal subset of the A2A spec needed for v1:

```typescript
interface AgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities: { streaming: boolean; pushNotifications: boolean; stateTransitionHistory: boolean };
  skills: AgentSkill[];
  defaultInputModes: string[];
  defaultOutputModes: string[];
}

interface A2ATask {
  id: string;
  status: 'submitted' | 'working' | 'input-required' | 'completed' | 'failed' | 'canceled';
  message?: A2AMessage;
  artifacts?: A2AArtifact[];
  error?: { code: number; message: string };
}

interface A2AMessage {
  role: 'user' | 'agent';
  parts: A2APart[];
}

type A2APart = { type: 'text'; text: string } | { type: 'data'; data: Record<string, unknown> };
```

---

## API Endpoints (v1 subset)

### `GET /.well-known/agent.json`

Returns the Agent Card. Public, no auth.

**Response:**
```json
{
  "name": "Sentinel2",
  "description": "Fleet analyst — monitors agent health, surfaces anomalies, reports to orchestrator",
  "url": "http://localhost:41241",
  "version": "1.0.0",
  "capabilities": { "streaming": false, "pushNotifications": false, "stateTransitionHistory": true },
  "skills": [
    { "id": "community-skill-review", "name": "community-skill-review", "description": "Review an inbound community skill PR..." }
  ]
}
```

### `POST /tasks/send`

Submit a new task. Translates to a cortextOS inbox message sent to the agent.

**Request:**
```json
{
  "id": "task-abc123",
  "message": {
    "role": "user",
    "parts": [{ "type": "text", "text": "Review PR #142 from the community catalog." }]
  }
}
```

**Response:** `202 Accepted` with the task object in `working` state.

### `GET /tasks/:taskId`

Poll task status. Returns `working` until the agent replies via the bus, then `completed` with the response as an artifact.

**Response:**
```json
{
  "id": "task-abc123",
  "status": "completed",
  "artifacts": [
    { "parts": [{ "type": "text", "text": "APPROVE — all checks pass. See findings..." }] }
  ]
}
```

### `POST /tasks/:taskId/cancel`

Cancel a pending task. Sends a cancellation bus message to the agent.

---

## Integration with Daemon

The A2A server starts as part of the agent's daemon process if `a2a_port` is configured in `config.json`:

```json
{
  "a2a_port": 41241
}
```

If `a2a_port` is not set, the A2A server does not start (opt-in). This ensures existing deployments are unaffected.

The daemon manages the A2A server lifecycle alongside the fast-checker:

```typescript
// In agent-manager.ts, after fast-checker starts:
if (config.a2a_port) {
  const a2aServer = new A2AServer(agentName, paths, config.a2a_port);
  a2aServer.start();
  log(`A2A adapter listening on port ${config.a2a_port}`);
}
```

### AgentConfig update

```typescript
// types/index.ts
interface AgentConfig {
  // ... existing fields ...
  a2a_port?: number;  // If set, starts A2A HTTP server on this port (default: 41241)
}
```

---

## Security

- **No auth in v1.** A2A spec supports OAuth 2.0 bearer tokens but it's optional. v1 binds to `localhost` only — not exposed to the internet without explicit configuration.
- **Input validation.** All A2A request fields are validated and stripped of control characters before passing to the bus (same treatment as Telegram messages).
- **Rate limiting.** `/tasks/send` is rate-limited to prevent message flooding — 10 requests/minute per IP.
- **No tool access.** External A2A callers can only send messages to the agent. They cannot invoke tool calls, read files, or trigger system operations directly.

---

## CLI

```bash
# Start A2A adapter manually (without daemon)
cortextos bus a2a-start [--port 41241] [--agent <name>]

# Test the Agent Card
cortextos bus a2a-card [--agent <name>]

# List active A2A tasks
cortextos bus a2a-tasks [--agent <name>]
```

---

## Implementation Phases

### Phase 1: Agent Card only (1-2 days)
- `GET /.well-known/agent.json` endpoint
- Reads IDENTITY.md + skills directory
- No task handling yet
- Deployable and discoverable by other A2A agents

### Phase 2: Task submit + poll (2-3 days)
- `POST /tasks/send` → cortextOS bus message
- `GET /tasks/:taskId` → poll for reply
- Task state in local JSON files
- Functional end-to-end: external agent can assign tasks and get results

### Phase 3: Cancel + error handling (1 day)
- `POST /tasks/:taskId/cancel`
- Proper A2A error codes for invalid requests, unknown tasks, timeouts

### Phase 4: Daemon integration + config.json opt-in (1 day)
- `a2a_port` in config.json starts server automatically
- ONBOARDING.md updated with A2A setup step

---

## Open Questions

1. **Multi-agent discovery:** If all cortextOS agents on a machine run A2A servers, should there be a registry endpoint (e.g. `GET /agents`) listing the fleet? Useful for orchestrators from other frameworks.

2. **Task timeout:** If the cortextOS agent takes > N seconds to reply (context window, complex task), A2A clients may time out. What is the right timeout, and should we implement long-polling or SSE streaming to handle slow responses?

3. **Inbound A2A vs Telegram:** Currently agents receive instructions via Telegram. A2A adds a second input path. Should the agent distinguish them in formatting? (e.g. `=== A2A TASK from [agent] ===` vs `=== TELEGRAM from ===`)

4. **Outbound A2A (client):** v1 is server-only. When should we add A2A client capability so cortextOS agents can call other A2A agents as tools?

5. **Port assignment:** If multiple agents run on the same machine, each needs a unique port. How is this managed — sequential assignment from `a2a_port` base, or explicit per-agent config?

---

## References

- A2A spec: https://google.github.io/A2A/
- A2A Python SDK: https://github.com/google/A2A
- Existing bus: `src/bus/message.ts`, `src/bus/task.ts`
- FastChecker (Telegram injection pattern): `src/daemon/fast-checker.ts`
- Agent Card field from IDENTITY.md: `src/bus/agents.ts` `buildAgentInfo()`
