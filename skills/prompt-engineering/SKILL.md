---
name: prompt-engineering
description: "Techniques for writing effective prompts for Claude. Covers structured outputs, chain of thought, few-shot examples, and system prompt design."
homepage: https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering
tags: [prompting, techniques, optimization]
---

# Prompt Engineering

Techniques for getting the best results from Claude.

## Core Techniques

### Be Specific and Direct
Bad: "Tell me about dogs"
Good: "List the top 5 dog breeds for apartment living, with a one-sentence reason for each"

### Use XML Tags for Structure
```
<context>
You are a customer support agent for Acme Corp.
</context>

<instructions>
Respond to the customer query below. Be helpful but concise.
</instructions>

<query>
{{customer_message}}
</query>
```

### Chain of Thought
```
Think through this step by step:
1. First, identify the key variables
2. Then, set up the equation
3. Finally, solve and verify
```

### Few-Shot Examples
```
Here are examples of the format I want:

Input: "The food was great but service was slow"
Output: {"sentiment": "mixed", "food": "positive", "service": "negative"}

Input: "Everything was perfect!"
Output: {"sentiment": "positive", "food": "positive", "service": "positive"}

Now analyze: "{{input}}"
```

### Structured Output with Prefill
Start Claude's response to force a format:
```python
messages=[
    {"role": "user", "content": "Extract the name and age from: 'John is 30'"},
    {"role": "assistant", "content": '{"name": "'}
]
```

## System Prompt Design
- Define the role clearly
- Set boundaries on what to do and not do
- Include output format requirements
- Add examples of ideal responses
