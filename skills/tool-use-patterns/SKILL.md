---
name: tool-use-patterns
description: "Patterns for Claude tool use including sequential tools, parallel execution, error handling, and agentic loops."
homepage: https://docs.anthropic.com/en/docs/build-with-claude/tool-use
tags: [tools, function-calling, agents, patterns]
---

# Tool Use Patterns

Advanced patterns for Claude's tool use capability.

## Agentic Loop
```python
while True:
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        tools=tools,
        messages=messages
    )

    if response.stop_reason == "end_turn":
        break

    for block in response.content:
        if block.type == "tool_use":
            result = execute_tool(block.name, block.input)
            messages.append({"role": "assistant", "content": response.content})
            messages.append({"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": block.id, "content": str(result)}
            ]})
```

## Error Handling
```python
{"type": "tool_result", "tool_use_id": id, "is_error": true, "content": "File not found"}
```

## Parallel Tool Calls
Claude can request multiple tools in one response. Execute them concurrently and return all results.

## Best Practices
- Keep tool descriptions concise but complete
- Include parameter constraints in the schema
- Return structured data from tools when possible
- Use is_error for graceful failure handling
