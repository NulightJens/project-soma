import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  logOutboundMessage,
  logInboundMessage,
  cacheLastSent,
  readLastSent,
} from '../../../src/telegram/logging';
import { TelegramAPI } from '../../../src/telegram/api';

describe('Telegram Logging', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'cortextos-tg-log-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('logOutboundMessage', () => {
    it('appends correct JSONL format', () => {
      logOutboundMessage(testDir, 'bot1', '12345', 'Hello world', 99);

      const logPath = join(testDir, 'logs', 'bot1', 'outbound-messages.jsonl');
      const content = readFileSync(logPath, 'utf-8').trim();
      const entry = JSON.parse(content);

      expect(entry.agent).toBe('bot1');
      expect(entry.chat_id).toBe('12345');
      expect(entry.text).toBe('Hello world');
      expect(entry.message_id).toBe(99);
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    });

    it('appends multiple entries', () => {
      logOutboundMessage(testDir, 'bot1', '111', 'first', 1);
      logOutboundMessage(testDir, 'bot1', '111', 'second', 2);

      const logPath = join(testDir, 'logs', 'bot1', 'outbound-messages.jsonl');
      const lines = readFileSync(logPath, 'utf-8').trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).text).toBe('first');
      expect(JSON.parse(lines[1]).text).toBe('second');
    });
  });

  describe('logInboundMessage', () => {
    it('appends with archived_at and agent', () => {
      const raw = { message_id: 42, text: 'hi', from: { id: 1 } };
      logInboundMessage(testDir, 'bot2', raw);

      const logPath = join(testDir, 'logs', 'bot2', 'inbound-messages.jsonl');
      const content = readFileSync(logPath, 'utf-8').trim();
      const entry = JSON.parse(content);

      expect(entry.message_id).toBe(42);
      expect(entry.text).toBe('hi');
      expect(entry.from).toEqual({ id: 1 });
      expect(entry.agent).toBe('bot2');
      expect(entry.archived_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    });
  });

  describe('cacheLastSent / readLastSent', () => {
    it('writes and reads back text', () => {
      cacheLastSent(testDir, 'bot1', '999', 'cached message');
      const result = readLastSent(testDir, 'bot1', '999');
      expect(result).toBe('cached message');
    });

    it('overwrites previous cache', () => {
      cacheLastSent(testDir, 'bot1', '999', 'old');
      cacheLastSent(testDir, 'bot1', '999', 'new');
      expect(readLastSent(testDir, 'bot1', '999')).toBe('new');
    });

    it('returns null when file does not exist', () => {
      const result = readLastSent(testDir, 'bot1', '000');
      expect(result).toBeNull();
    });
  });
});

describe('TelegramAPI.sendPhoto', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'cortextos-tg-photo-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('throws if image file does not exist', async () => {
    const api = new TelegramAPI('test-token');
    await expect(
      api.sendPhoto('123', '/nonexistent/image.jpg'),
    ).rejects.toThrow('Image file not found');
  });

  it('sends multipart form data with correct fields', async () => {
    // Create a fake image file
    const imagePath = join(testDir, 'test.jpg');
    writeFileSync(imagePath, 'fake-image-data');

    const api = new TelegramAPI('test-token');

    // Mock fetch
    const mockFetch = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, result: { message_id: 55 } }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await api.sendPhoto('123', imagePath, 'My caption', {
      inline_keyboard: [[{ text: 'OK', callback_data: 'ok' }]],
    });

    expect(result.ok).toBe(true);
    expect(result.result.message_id).toBe(55);

    // Verify fetch was called with correct URL and FormData
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/bottest-token/sendPhoto');
    expect(options.method).toBe('POST');

    // Verify it's a FormData body
    const body = options.body;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('chat_id')).toBe('123');
    expect(body.get('caption')).toBe('My caption');
    expect(body.get('reply_markup')).toBe(
      JSON.stringify({ inline_keyboard: [[{ text: 'OK', callback_data: 'ok' }]] }),
    );
    // photo should be a Blob
    const photo = body.get('photo');
    expect(photo).toBeInstanceOf(Blob);
  });

  it('sends without optional fields when not provided', async () => {
    const imagePath = join(testDir, 'test.png');
    writeFileSync(imagePath, 'png-data');

    const api = new TelegramAPI('test-token');
    const mockFetch = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, result: { message_id: 56 } }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await api.sendPhoto('456', imagePath);

    const body = mockFetch.mock.calls[0][1].body as FormData;
    expect(body.get('chat_id')).toBe('456');
    expect(body.get('photo')).toBeInstanceOf(Blob);
    expect(body.get('caption')).toBeNull();
    expect(body.get('reply_markup')).toBeNull();
  });
});
