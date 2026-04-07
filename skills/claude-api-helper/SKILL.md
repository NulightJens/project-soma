---
name: claude-api-helper
description: "Build applications with the Claude API and Anthropic SDKs. Covers Messages API, streaming, tool use, vision, and best practices."
homepage: https://docs.anthropic.com/en/api
tags: [api, anthropic, sdk, development]
---

# Claude API Helper

Reference skill for building with the Claude API (Messages API, Python/TypeScript SDKs).

## Quick Start

```python
import anthropic

client = anthropic.Anthropic()
message = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello, Claude"}]
)
print(message.content[0].text)
```

## Key Patterns

### Streaming
```python
with client.messages.stream(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Write a story"}]
) as stream:
    for text in stream.text_stream:
        print(text, end="", flush=True)
```

### Tool Use
```python
tools = [{
    "name": "get_weather",
    "description": "Get current weather for a location",
    "input_schema": {
        "type": "object",
        "properties": {
            "location": {"type": "string", "description": "City name"}
        },
        "required": ["location"]
    }
}]
```

### Vision
```python
message = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    messages=[{
        "role": "user",
        "content": [
            {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": base64_data}},
            {"type": "text", "text": "What's in this image?"}
        ]
    }]
)
```

## Best Practices
- Use system prompts for consistent behavior
- Set appropriate max_tokens (don't over-allocate)
- Handle rate limits with exponential backoff
- Use streaming for long responses
- Cache system prompts with prompt caching for cost savings
