---
name: knowledge-base
description: "Query and ingest documents into the org knowledge base (RAG). Use when: starting a research task, referencing named entities (people, projects, tools), answering factual questions about the org, or after completing research that should be preserved."
triggers: ["knowledge base", "kb", "search knowledge", "query knowledge", "ingest", "rag", "semantic search", "what do we know about", "check knowledge", "save to kb", "index documents"]
---

# Knowledge Base (RAG)

The knowledge base lets you search indexed documents using natural language — memory files, research notes, org knowledge. Query before searching externally. Ingest after completing research.

---

## Query (before starting research)

```bash
cortextos bus kb-query "your question" \
  --org $CTX_ORG \
  --agent $CTX_AGENT_NAME
```

Use this:
- Before starting any research task — check if knowledge already exists
- When referencing named entities (people, projects, tools) — check for existing context
- When answering factual questions about the org — query before searching externally

---

## Ingest (after completing research)

```bash
# Ingest to shared org collection (visible to all agents)
cortextos bus kb-ingest /path/to/docs \
  --org $CTX_ORG \
  --scope shared

# Ingest to your private collection (only visible to you)
cortextos bus kb-ingest /path/to/docs \
  --org $CTX_ORG \
  --agent $CTX_AGENT_NAME \
  --scope private
```

Ingest after:
- Completing substantive research (always ingest your findings)
- Writing or updating MEMORY.md
- Learning important facts about the org, users, or systems

---

## List Collections

```bash
cortextos bus kb-collections --org $CTX_ORG
```

---

## First-Time Setup

If the knowledge base hasn't been initialized for this org:

```bash
cortextos bus kb-setup --org $CTX_ORG
```

Run this once per org. Check collections list first — don't re-initialize if already set up.

---

## Workflow Pattern

```
1. User asks question about <topic>
2. kb-query "<topic>" — check existing knowledge
3. If found → answer from KB, cite source
4. If not found → research externally
5. After research → kb-ingest findings
6. Answer user with fresh knowledge now in KB
```
