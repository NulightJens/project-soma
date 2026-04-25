import { describe, it, expect } from 'vitest';
import { parseIntent } from '../pattern-parser';

describe('parseIntent — happy paths', () => {
  it('handles bare handler name', () => {
    const r = parseIntent('noop');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.intent).toEqual({ name: 'noop', data: {} });
      expect(r.source).toBe('handler+json');
    }
  });

  it('handles handler+JSON', () => {
    const r = parseIntent('echo {"msg":"hi"}');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.intent).toEqual({ name: 'echo', data: { msg: 'hi' } });
    }
  });

  it('matches sleep with seconds suffix', () => {
    const r = parseIntent('sleep 5 seconds');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.intent).toEqual({ name: 'sleep', data: { ms: 5000 } });
      expect(r.source).toBe('sleep');
    }
  });

  it('matches sleep with secs abbreviation', () => {
    // The handler+json pattern wins for 'sleep' as a bare token, but the
    // 'sleep 2 secs' phrase doesn't match handler+json (extra tokens), so
    // it falls through to the dedicated sleep pattern.
    const r = parseIntent('sleep 2 secs');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe('sleep');
      expect(r.intent.data).toEqual({ ms: 2000 });
    }
  });

  it('matches sleep with ms', () => {
    const r = parseIntent('sleep 250 ms');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.intent.data).toEqual({ ms: 250 });
    }
  });

  it('matches "echo hello world"', () => {
    const r = parseIntent('echo hello world');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.intent.name).toBe('echo');
      expect(r.intent.data).toEqual({ msg: 'hello world' });
    }
  });

  it('matches bare echo with no message', () => {
    const r = parseIntent('echo');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.intent.name).toBe('echo');
      expect(r.intent.data).toEqual({});
    }
  });
});

describe('parseIntent — refusals + failures', () => {
  it('refuses protected names with a clear error', () => {
    const r = parseIntent('shell {"cmd":"ls"}');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/protected handler/);
    }
  });

  it('returns suggestions when nothing matches', () => {
    const r = parseIntent('please make me a sandwich');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/couldn't parse/);
      expect(r.suggestions.length).toBeGreaterThan(0);
    }
  });

  it('errors on empty input', () => {
    const r = parseIntent('   ');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('empty input');
    }
  });

  it('reports parse error when JSON is malformed', () => {
    const r = parseIntent('echo {not json}');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // Either falls through with no match, or matches handler+json and the
      // build fails. Either way we get a structured failure with suggestions.
      expect(r.suggestions.length).toBeGreaterThan(0);
    }
  });
});

describe('parseIntent — hint message', () => {
  it('includes the resolved intent in the hint', () => {
    const r = parseIntent('sleep 1 s');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.hint).toMatch(/Sleep handler/);
      expect(r.hint).toMatch(/1000ms/);
    }
  });

  it('describes a bare-name echo via the handler+json catch-all', () => {
    // "echo" with no extra tokens hits handler+json (the catch-all);
    // the dedicated echo pattern only fires on phrases like "echo hello"
    // where there's a message to extract.
    const r = parseIntent('echo');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe('handler+json');
      expect(r.hint).toMatch(/Submit handler 'echo'/);
      expect(r.hint).toMatch(/no payload/);
    }
  });

  it('describes "echo hello" via the dedicated echo pattern', () => {
    const r = parseIntent('echo hello');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe('echo');
      expect(r.hint).toMatch(/Echo handler/);
    }
  });
});
