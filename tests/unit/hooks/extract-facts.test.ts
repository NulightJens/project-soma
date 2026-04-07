import { describe, it, expect } from 'vitest';
import { extractKeywords } from '../../../src/hooks/hook-extract-facts';

describe('extractKeywords', () => {
  it('returns empty array for empty string', () => {
    expect(extractKeywords('')).toEqual([]);
  });

  it('filters out common stopwords', () => {
    const keywords = extractKeywords('the the the and and is is a a a');
    expect(keywords).toEqual([]);
  });

  it('extracts repeated meaningful words', () => {
    const text = 'cortextos cortextos cortextos agent agent agent task task task heartbeat heartbeat';
    const keywords = extractKeywords(text);
    expect(keywords).toContain('cortextos');
    expect(keywords).toContain('agent');
    expect(keywords).toContain('task');
  });

  it('returns at most 20 keywords', () => {
    // Generate 30 unique words each repeated twice
    const words = Array.from({ length: 30 }, (_, i) => `keyword${i} keyword${i}`).join(' ');
    const keywords = extractKeywords(words);
    expect(keywords.length).toBeLessThanOrEqual(20);
  });

  it('sorts by frequency descending', () => {
    const text = 'agent agent agent agent task task task heartbeat heartbeat memory';
    const keywords = extractKeywords(text);
    // 'agent' appears 4x, 'task' 3x, 'heartbeat' 2x — 'memory' only 1x so excluded
    expect(keywords[0]).toBe('agent');
    expect(keywords[1]).toBe('task');
    expect(keywords[2]).toBe('heartbeat');
  });

  it('excludes words shorter than 4 chars', () => {
    const text = 'abc abc abc dog dog dog fish fish fish';
    const keywords = extractKeywords(text);
    expect(keywords).not.toContain('abc');
    expect(keywords).not.toContain('dog');
    expect(keywords).toContain('fish');
  });

  it('is case-insensitive', () => {
    const text = 'Cortextos CORTEXTOS cortextos Agent AGENT agent';
    const keywords = extractKeywords(text);
    expect(keywords).toContain('cortextos');
    expect(keywords).toContain('agent');
  });
});
