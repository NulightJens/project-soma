---
name: web-research
description: "Structured web research patterns using search APIs, content extraction, and synthesis. For agents that need to gather and analyze online information."
homepage: https://docs.anthropic.com/en/docs/build-with-claude/tool-use
tags: [research, web, search, analysis]
---

# Web Research

Patterns for agents performing structured web research.

## Search Strategy
1. Break the research question into sub-queries
2. Search each sub-query independently
3. Extract relevant content from top results
4. Synthesize findings with source attribution

## Search Tools
Use WebSearch for broad queries, WebFetch for specific URLs:
```
WebSearch: "cortextOS multi-agent orchestration 2026"
WebFetch: "https://docs.anthropic.com/en/docs/agents"
```

## Content Extraction
- Extract key facts, quotes, and data points
- Note the source URL for each finding
- Check publication dates for freshness
- Cross-reference claims across multiple sources

## Research Output Format
```markdown
## Finding: [Topic]
**Source:** [URL]
**Date:** [Publication date]
**Key points:**
- Point 1
- Point 2

**Relevance:** [How this relates to the research question]
```

## Best Practices
- Always attribute sources
- Prefer primary sources over secondary
- Check for recency (information may be outdated)
- Synthesize, don't just aggregate
- Flag conflicting information explicitly
