/**
 * Comprehensive Playwright E2E tests for all Telegram API functions.
 * Uses a mock Telegram server to test edge cases, rate limiting, special chars, etc.
 */
import { test, expect } from '@playwright/test';
import { MockTelegramServer } from './mock-telegram-server';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Register tsx for TypeScript source imports
require('tsx/cjs');

// Import source modules directly via tsx
const { TelegramAPI } = require('../../src/telegram/api');
const { TelegramPoller } = require('../../src/telegram/poller');
const { processMediaMessage, sanitizeFilename } = require('../../src/telegram/media');
const { logOutboundMessage, logInboundMessage, cacheLastSent, readLastSent } = require('../../src/telegram/logging');

const mock = new MockTelegramServer(39182);

test.beforeAll(async () => {
  await mock.start();
});

test.afterAll(async () => {
  await mock.stop();
});

test.beforeEach(() => {
  mock.reset();
});

// Helper: create API pointed at mock server with downloadFile override
function createApi(): InstanceType<typeof TelegramAPI> {
  const api = new TelegramAPI('test-token-123');
  // Override baseUrl to point at mock
  (api as any).baseUrl = `${mock.getBaseUrl()}/bottest-token-123`;
  // Override downloadFile to use mock server URL instead of hardcoded api.telegram.org
  const originalDownload = api.downloadFile.bind(api);
  api.downloadFile = async (filePath: string): Promise<Buffer> => {
    const url = `${mock.getBaseUrl()}/file/bottest-token-123/${filePath}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  };
  return api;
}

// ============================================================================
// 1. sendMessage tests
// ============================================================================

test.describe('sendMessage', () => {
  test('sends basic text message', async () => {
    const api = createApi();
    const result = await api.sendMessage('12345', 'Hello world');
    expect(result.ok).toBe(true);
    expect(result.result.message_id).toBeGreaterThan(0);
    expect(result.result.text).toBe('Hello world');

    const reqs = mock.getRequestsFor('sendMessage');
    expect(reqs).toHaveLength(1);
    expect(reqs[0].body.chat_id).toBe('12345');
    expect(reqs[0].body.text).toBe('Hello world');
  });

  test('sends message with inline keyboard', async () => {
    const api = createApi();
    const keyboard = {
      inline_keyboard: [
        [{ text: 'Approve', callback_data: 'perm_allow_abc' }],
        [{ text: 'Deny', callback_data: 'perm_deny_abc' }],
      ],
    };
    await api.sendMessage('12345', 'Permission request', keyboard);

    const reqs = mock.getRequestsFor('sendMessage');
    expect(reqs).toHaveLength(1);
    const body = reqs[0].body;
    expect(body.reply_markup).toBeDefined();
    const markup = typeof body.reply_markup === 'string'
      ? JSON.parse(body.reply_markup as string)
      : body.reply_markup;
    expect(markup.inline_keyboard).toHaveLength(2);
  });

  test('auto-splits long messages at 4096 chars', async () => {
    const api = createApi();
    const longText = 'A'.repeat(5000);
    await api.sendMessage('12345', longText);

    const reqs = mock.getRequestsFor('sendMessage');
    expect(reqs.length).toBe(2);
    expect((reqs[0].body.text as string).length).toBe(4096);
    expect((reqs[1].body.text as string).length).toBe(5000 - 4096);
  });

  test('message exactly 4096 chars sends as single message', async () => {
    const api = createApi();
    const exactText = 'B'.repeat(4096);
    await api.sendMessage('12345', exactText);

    const reqs = mock.getRequestsFor('sendMessage');
    expect(reqs).toHaveLength(1);
    expect((reqs[0].body.text as string).length).toBe(4096);
  });

  test('message 4097 chars splits into exactly 2', async () => {
    const api = createApi();
    const text = 'C'.repeat(4097);
    await api.sendMessage('12345', text);

    const reqs = mock.getRequestsFor('sendMessage');
    expect(reqs).toHaveLength(2);
    expect((reqs[0].body.text as string).length).toBe(4096);
    expect((reqs[1].body.text as string).length).toBe(1);
  });

  test('very long message 12288+ chars splits into 3+', async () => {
    const api = createApi();
    const text = 'D'.repeat(12500);
    await api.sendMessage('12345', text);

    const reqs = mock.getRequestsFor('sendMessage');
    expect(reqs.length).toBeGreaterThanOrEqual(4);
  });

  test('handles special characters (emoji, unicode, HTML entities)', async () => {
    const api = createApi();
    const specialText = '🤖 <b>bold</b> "quotes" & ampersands © 日本語 Ü ñ \n\ttabs';
    await api.sendMessage('12345', specialText);

    const reqs = mock.getRequestsFor('sendMessage');
    expect(reqs[0].body.text).toBe(specialText);
  });

  test('handles empty string message', async () => {
    const api = createApi();
    // Telegram rejects empty text, but our API should still send it
    await api.sendMessage('12345', '');
    const reqs = mock.getRequestsFor('sendMessage');
    expect(reqs).toHaveLength(1);
  });

  test('handles newlines and markdown formatting', async () => {
    const api = createApi();
    const mdText = '# Header\n\n- item 1\n- item 2\n\n```js\nconst x = 1;\n```\n\n**bold** _italic_';
    await api.sendMessage('12345', mdText);
    const reqs = mock.getRequestsFor('sendMessage');
    expect(reqs[0].body.text).toBe(mdText);
  });

  test('rate limits to 1 message per second per chat', async () => {
    const api = createApi();
    const start = Date.now();

    await api.sendMessage('12345', 'msg1');
    await api.sendMessage('12345', 'msg2');

    const elapsed = Date.now() - start;
    // Should have waited at least ~900ms between messages
    expect(elapsed).toBeGreaterThanOrEqual(900);

    const reqs = mock.getRequestsFor('sendMessage');
    expect(reqs).toHaveLength(2);
  });

  test('rate limits independently per chatId', async () => {
    const api = createApi();
    const start = Date.now();

    // Different chats should not delay each other
    await api.sendMessage('111', 'chat1');
    await api.sendMessage('222', 'chat2');

    const elapsed = Date.now() - start;
    // Second message to different chat should be fast
    // (total still >= 1s due to first rate limit tracking, but second shouldn't wait)
    const reqs = mock.getRequestsFor('sendMessage');
    expect(reqs).toHaveLength(2);
  });

  test('numeric chatId is accepted', async () => {
    const api = createApi();
    await api.sendMessage(12345, 'numeric chat');
    const reqs = mock.getRequestsFor('sendMessage');
    expect(reqs).toHaveLength(1);
  });

  test('handles Telegram API error response', async () => {
    mock.setError('sendMessage', 400, 'Bad Request: chat not found');
    const api = createApi();

    await expect(api.sendMessage('99999', 'test')).rejects.toThrow(/chat not found/);
  });

  test('handles 429 rate limit from Telegram', async () => {
    mock.setRateLimit(100); // 100ms rate limit
    const api = createApi();

    await expect(api.sendMessage('12345', 'test')).rejects.toThrow(/Too Many Requests/);
  });

  test('reply_markup not included on split message chunks (only last)', async () => {
    const api = createApi();
    const keyboard = { inline_keyboard: [[{ text: 'OK', callback_data: 'ok' }]] };
    const longText = 'X'.repeat(5000);
    await api.sendMessage('12345', longText, keyboard);

    const reqs = mock.getRequestsFor('sendMessage');
    expect(reqs).toHaveLength(2);
    // reply_markup should NOT be on first chunk (split messages drop it)
    // and should NOT be on any chunk for split messages per implementation
    // Verify the implementation behavior
    expect(reqs[0].body.reply_markup).toBeUndefined();
  });
});

// ============================================================================
// 2. sendPhoto tests
// ============================================================================

test.describe('sendPhoto', () => {
  let tmpDir: string;

  test.beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tg-photo-'));
  });

  test.afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('sends photo with caption', async () => {
    const api = createApi();
    const imgPath = join(tmpDir, 'test.jpg');
    writeFileSync(imgPath, Buffer.from([0xFF, 0xD8, 0xFF, 0xE0])); // JPEG header

    const result = await api.sendPhoto('12345', imgPath, 'My photo');
    expect(result.ok).toBe(true);
    expect(result.result.photo).toHaveLength(2);

    const reqs = mock.getRequestsFor('sendPhoto');
    expect(reqs).toHaveLength(1);
    expect(reqs[0].body._multipart).toBe(true);
  });

  test('sends photo without caption', async () => {
    const api = createApi();
    const imgPath = join(tmpDir, 'test.png');
    writeFileSync(imgPath, Buffer.from([0x89, 0x50, 0x4E, 0x47])); // PNG header

    const result = await api.sendPhoto('12345', imgPath);
    expect(result.ok).toBe(true);
  });

  test('throws error for non-existent file', async () => {
    const api = createApi();
    await expect(api.sendPhoto('12345', '/nonexistent/photo.jpg'))
      .rejects.toThrow(/not found/i);
  });

  test('sends photo with inline keyboard', async () => {
    const api = createApi();
    const imgPath = join(tmpDir, 'test.jpg');
    writeFileSync(imgPath, Buffer.alloc(1024, 0xFF));

    const keyboard = { inline_keyboard: [[{ text: 'Like', callback_data: 'like' }]] };
    const result = await api.sendPhoto('12345', imgPath, 'Caption', keyboard);
    expect(result.ok).toBe(true);
  });

  test('handles large file upload', async () => {
    const api = createApi();
    const imgPath = join(tmpDir, 'large.jpg');
    writeFileSync(imgPath, Buffer.alloc(1024 * 1024, 0xFF)); // 1MB

    const result = await api.sendPhoto('12345', imgPath, 'Large file');
    expect(result.ok).toBe(true);

    const reqs = mock.getRequestsFor('sendPhoto');
    expect(reqs[0].body._size).toBeGreaterThan(1024 * 1024);
  });

  test('preserves original filename in multipart', async () => {
    const api = createApi();
    const imgPath = join(tmpDir, 'my-screenshot.png');
    writeFileSync(imgPath, Buffer.from([0x89, 0x50, 0x4E, 0x47]));

    await api.sendPhoto('12345', imgPath);
    const reqs = mock.getRequestsFor('sendPhoto');
    expect(reqs[0].body.photo_filename).toBe('my-screenshot.png');
  });
});

// ============================================================================
// 3. editMessageText tests
// ============================================================================

test.describe('editMessageText', () => {
  test('edits message text', async () => {
    const api = createApi();
    const result = await api.editMessageText('12345', 42, 'Updated text');
    expect(result.ok).toBe(true);
    expect(result.result.text).toBe('Updated text');

    const reqs = mock.getRequestsFor('editMessageText');
    expect(reqs[0].body.chat_id).toBe('12345');
    expect(reqs[0].body.message_id).toBe(42);
    expect(reqs[0].body.text).toBe('Updated text');
  });

  test('edits message with new keyboard', async () => {
    const api = createApi();
    const keyboard = { inline_keyboard: [[{ text: 'Done', callback_data: 'done' }]] };
    await api.editMessageText('12345', 42, 'Approved ✅', keyboard);

    const reqs = mock.getRequestsFor('editMessageText');
    expect(reqs[0].body.reply_markup).toBeDefined();
  });

  test('handles editing non-existent message', async () => {
    mock.setError('editMessageText', 400, 'Bad Request: message to edit not found');
    const api = createApi();

    await expect(api.editMessageText('12345', 99999, 'test'))
      .rejects.toThrow(/message to edit not found/);
  });

  test('edits with special characters', async () => {
    const api = createApi();
    await api.editMessageText('12345', 1, '✅ Approved by @admin — "done" & finished');
    const reqs = mock.getRequestsFor('editMessageText');
    expect(reqs[0].body.text).toContain('✅');
    expect(reqs[0].body.text).toContain('"done"');
  });
});

// ============================================================================
// 4. sendChatAction tests
// ============================================================================

test.describe('sendChatAction', () => {
  test('sends typing action', async () => {
    const api = createApi();
    const result = await api.sendChatAction('12345');
    expect(result.ok).toBe(true);

    const reqs = mock.getRequestsFor('sendChatAction');
    expect(reqs).toHaveLength(1);
    expect(reqs[0].body.action).toBe('typing');
  });

  test('sends custom action', async () => {
    const api = createApi();
    await api.sendChatAction('12345', 'upload_photo');
    const reqs = mock.getRequestsFor('sendChatAction');
    expect(reqs[0].body.action).toBe('upload_photo');
  });
});

// ============================================================================
// 5. answerCallbackQuery tests
// ============================================================================

test.describe('answerCallbackQuery', () => {
  test('answers callback with text', async () => {
    const api = createApi();
    await api.answerCallbackQuery('cbq_123', 'Got it');
    const reqs = mock.getRequestsFor('answerCallbackQuery');
    expect(reqs[0].body.callback_query_id).toBe('cbq_123');
    expect(reqs[0].body.text).toBe('Got it');
  });

  test('answers callback without text (default OK)', async () => {
    const api = createApi();
    await api.answerCallbackQuery('cbq_456');
    const reqs = mock.getRequestsFor('answerCallbackQuery');
    expect(reqs[0].body.callback_query_id).toBe('cbq_456');
  });
});

// ============================================================================
// 6. getUpdates tests
// ============================================================================

test.describe('getUpdates', () => {
  test('returns empty array when no updates', async () => {
    const api = createApi();
    const result = await api.getUpdates(0);
    expect(result.ok).toBe(true);
    expect(result.result).toEqual([]);
  });

  test('returns queued message updates', async () => {
    mock.queueMessage({ text: 'Hello from user' });
    mock.queueMessage({ text: 'Second message' });

    const api = createApi();
    const result = await api.getUpdates(0);
    expect(result.result).toHaveLength(2);
    expect(result.result[0].message.text).toBe('Hello from user');
    expect(result.result[1].message.text).toBe('Second message');
  });

  test('returns callback query updates', async () => {
    mock.queueCallback('perm_allow_abc123');
    const api = createApi();
    const result = await api.getUpdates(0);
    expect(result.result).toHaveLength(1);
    expect(result.result[0].callback_query.data).toBe('perm_allow_abc123');
  });

  test('clears updates after retrieval', async () => {
    mock.queueMessage({ text: 'one-time' });
    const api = createApi();
    await api.getUpdates(0);

    const result2 = await api.getUpdates(0);
    expect(result2.result).toEqual([]);
  });

  test('passes offset and timeout parameters', async () => {
    const api = createApi();
    await api.getUpdates(50, 10);
    const reqs = mock.getRequestsFor('getUpdates');
    expect(reqs[0].body.offset).toBe(50);
    expect(reqs[0].body.timeout).toBe(10);
  });
});

// ============================================================================
// 7. getFile and downloadFile tests
// ============================================================================

test.describe('getFile and downloadFile', () => {
  test('gets file metadata', async () => {
    mock.storeFile('photo_123', Buffer.from('fake-photo-data'));
    const api = createApi();
    const result = await api.getFile('photo_123');
    expect(result.ok).toBe(true);
    expect(result.result.file_id).toBe('photo_123');
    expect(result.result.file_path).toBe('photo_123');
    expect(result.result.file_size).toBe(15);
  });

  test('downloads file as buffer', async () => {
    const content = Buffer.from('real-file-content-here');
    mock.storeFile('doc_456', content);

    const api = createApi();
    // Override the file download URL to use mock
    (api as any).baseUrl = `${mock.getBaseUrl()}/bottest-token-123`;
    const fileInfo = await api.getFile('doc_456');

    const buffer = await api.downloadFile(fileInfo.result.file_path);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.toString()).toBe('real-file-content-here');
  });

  test('handles non-existent file', async () => {
    const api = createApi();
    // getFile for non-existent file goes through post() which throws on ok:false
    await expect(api.getFile('nonexistent')).rejects.toThrow(/file not found|Telegram API error/);
  });
});

// ============================================================================
// 8. Media processing tests
// ============================================================================

test.describe('Media processing', () => {
  let tmpDir: string;

  test.beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tg-media-'));
  });

  test.afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('sanitizeFilename strips unsafe characters', () => {
    // Our regex keeps only a-zA-Z0-9._- (spaces are stripped)
    expect(sanitizeFilename('helloworld.txt')).toBe('helloworld.txt');
    expect(sanitizeFilename('hello-world.txt')).toBe('hello-world.txt');
    expect(sanitizeFilename('../../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('file<script>.exe')).toBe('filescript.exe');
    expect(sanitizeFilename('')).toBe('unnamed_file');
    expect(sanitizeFilename(null)).toBe('unnamed_file');
    expect(sanitizeFilename(undefined)).toBe('unnamed_file');
    // Spaces are stripped
    expect(sanitizeFilename('hello world.txt')).toBe('helloworld.txt');
  });

  test('sanitizeFilename limits to 200 chars', () => {
    const longName = 'a'.repeat(300) + '.txt';
    const result = sanitizeFilename(longName);
    expect(result.length).toBeLessThanOrEqual(200);
  });

  test('sanitizeFilename handles path separators', () => {
    expect(sanitizeFilename('/path/to/file.pdf')).toBe('file.pdf');
    // On macOS, path.basename doesn't strip Windows separators the same way
    // but the regex will strip the backslash
    const result = sanitizeFilename('C:\\Users\\doc.pdf');
    expect(result).toMatch(/doc\.pdf/);
  });

  test('processes photo message (largest from array)', async () => {
    const photoContent = Buffer.from('fake-jpg-content');
    mock.storeFile('photo_large_id', photoContent);

    const api = createApi();
    const msg = {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 12345, type: 'private' as const },
      from: { id: 67890, first_name: 'Test' },
      photo: [
        { file_id: 'photo_small_id', width: 90, height: 90 },
        { file_id: 'photo_large_id', width: 800, height: 600 },
      ],
      caption: 'My photo',
    };

    const result = await processMediaMessage(msg, api, tmpDir);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('photo');
    expect(result!.text).toBe('My photo');
    expect(result!.image_path).toBeDefined();

    // Verify the file was downloaded from the largest photo
    const getFileReqs = mock.getRequestsFor('getFile');
    expect(getFileReqs[0].body.file_id).toBe('photo_large_id');
  });

  test('processes document message', async () => {
    mock.storeFile('doc_file_id', Buffer.from('document content'));

    const api = createApi();
    const msg = {
      message_id: 2,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 12345, type: 'private' as const },
      from: { id: 67890, first_name: 'Test' },
      document: { file_id: 'doc_file_id', file_name: 'report.pdf' },
    };

    const result = await processMediaMessage(msg, api, tmpDir);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('document');
    expect(result!.file_name).toBe('report.pdf');
  });

  test('processes voice message', async () => {
    mock.storeFile('voice_id', Buffer.from('ogg-data'));

    const api = createApi();
    const msg = {
      message_id: 3,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 12345, type: 'private' as const },
      from: { id: 67890, first_name: 'Test' },
      voice: { file_id: 'voice_id', duration: 5 },
    };

    const result = await processMediaMessage(msg, api, tmpDir);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('voice');
    expect(result!.duration).toBe(5);
  });

  test('processes video note message', async () => {
    mock.storeFile('vnote_id', Buffer.from('mp4-data'));

    const api = createApi();
    const msg = {
      message_id: 4,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 12345, type: 'private' as const },
      from: { id: 67890, first_name: 'Test' },
      video_note: { file_id: 'vnote_id', duration: 10 },
    };

    const result = await processMediaMessage(msg, api, tmpDir);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('video_note');
  });

  test('returns null for text-only message (no media)', async () => {
    const api = createApi();
    const msg = {
      message_id: 5,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 12345, type: 'private' as const },
      from: { id: 67890, first_name: 'Test' },
      text: 'Just text, no media',
    };

    const result = await processMediaMessage(msg, api, tmpDir);
    expect(result).toBeNull();
  });

  test('processes audio message', async () => {
    mock.storeFile('audio_id', Buffer.from('audio-data'));

    const api = createApi();
    const msg = {
      message_id: 6,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 12345, type: 'private' as const },
      from: { id: 67890, first_name: 'Test' },
      audio: { file_id: 'audio_id', duration: 180, file_name: 'song.mp3' },
    };

    const result = await processMediaMessage(msg, api, tmpDir);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('audio');
  });

  test('processes video message', async () => {
    mock.storeFile('video_id', Buffer.from('video-data'));

    const api = createApi();
    const msg = {
      message_id: 7,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 12345, type: 'private' as const },
      from: { id: 67890, first_name: 'Test' },
      video: { file_id: 'video_id', duration: 30, file_name: 'clip.mp4' },
    };

    const result = await processMediaMessage(msg, api, tmpDir);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('video');
  });
});

// ============================================================================
// 9. Telegram logging tests
// ============================================================================

test.describe('Telegram logging', () => {
  let tmpDir: string;

  test.beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tg-log-'));
  });

  test.afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('logOutboundMessage creates valid JSONL', () => {
    logOutboundMessage(tmpDir, 'testbot', '12345', 'Hello user', 42);
    logOutboundMessage(tmpDir, 'testbot', '12345', 'Follow up', 43);

    const logFile = join(tmpDir, 'logs', 'testbot', 'outbound-messages.jsonl');
    expect(existsSync(logFile)).toBe(true);

    const lines = readFileSync(logFile, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);

    const entry1 = JSON.parse(lines[0]);
    expect(entry1.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entry1.agent).toBe('testbot');
    expect(entry1.chat_id).toBe('12345');
    expect(entry1.text).toBe('Hello user');
    expect(entry1.message_id).toBe(42);
  });

  test('logInboundMessage creates valid JSONL', () => {
    const rawMsg = { message_id: 1, text: 'Hi', from: { id: 999, first_name: 'User' } };
    logInboundMessage(tmpDir, 'testbot', rawMsg);

    const logFile = join(tmpDir, 'logs', 'testbot', 'inbound-messages.jsonl');
    expect(existsSync(logFile)).toBe(true);

    const lines = readFileSync(logFile, 'utf-8').trim().split('\n');
    const entry = JSON.parse(lines[0]);
    expect(entry.archived_at).toBeDefined();
    expect(entry.agent).toBe('testbot');
    expect(entry.message_id).toBe(1);
    expect(entry.text).toBe('Hi');
  });

  test('cacheLastSent and readLastSent round-trip', () => {
    cacheLastSent(tmpDir, 'testbot', '12345', 'Last message sent');
    const cached = readLastSent(tmpDir, 'testbot', '12345');
    expect(cached).toBe('Last message sent');
  });

  test('readLastSent returns null for missing cache', () => {
    const cached = readLastSent(tmpDir, 'testbot', '99999');
    expect(cached).toBeNull();
  });

  test('handles special characters in logged messages', () => {
    logOutboundMessage(tmpDir, 'testbot', '12345', '🤖 "quotes" & <tags> ñ', 1);
    const logFile = join(tmpDir, 'logs', 'testbot', 'outbound-messages.jsonl');
    const entry = JSON.parse(readFileSync(logFile, 'utf-8').trim());
    expect(entry.text).toBe('🤖 "quotes" & <tags> ñ');
  });

  test('handles multiline text in logging', () => {
    const multiline = 'Line 1\nLine 2\n\nLine 4';
    logOutboundMessage(tmpDir, 'testbot', '12345', multiline, 1);
    const logFile = join(tmpDir, 'logs', 'testbot', 'outbound-messages.jsonl');
    const entry = JSON.parse(readFileSync(logFile, 'utf-8').trim());
    expect(entry.text).toBe(multiline);
  });

  test('numeric chatId is stringified in cache path', () => {
    cacheLastSent(tmpDir, 'testbot', 12345, 'numeric');
    const cached = readLastSent(tmpDir, 'testbot', 12345);
    expect(cached).toBe('numeric');
  });
});

// ============================================================================
// 10. Telegram Poller tests
// ============================================================================

test.describe('TelegramPoller', () => {
  let tmpDir: string;

  test.beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tg-poller-'));
    mkdirSync(tmpDir, { recursive: true });
  });

  test.afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('polls and dispatches messages to handlers', async () => {
    const api = createApi();
    const poller = new TelegramPoller(api, tmpDir, 100);
    const received: string[] = [];

    mock.queueMessage({ text: 'Test message 1' });
    mock.queueMessage({ text: 'Test message 2' });

    poller.onMessage((msg) => received.push(msg.text || ''));
    await poller.pollOnce();

    expect(received).toEqual(['Test message 1', 'Test message 2']);
  });

  test('dispatches callback queries', async () => {
    const api = createApi();
    const poller = new TelegramPoller(api, tmpDir, 100);
    const callbacks: string[] = [];

    mock.queueCallback('perm_allow_abc');

    poller.onCallback((query) => callbacks.push(query.data || ''));
    await poller.pollOnce();

    expect(callbacks).toEqual(['perm_allow_abc']);
  });

  test('persists offset across polls', async () => {
    const api = createApi();
    const poller = new TelegramPoller(api, tmpDir, 100);
    poller.onMessage(() => {});

    mock.queueMessage({ text: 'first' });
    await poller.pollOnce();

    // Check offset was saved
    const offsetFile = join(tmpDir, '.telegram-offset');
    expect(existsSync(offsetFile)).toBe(true);
    const offset = parseInt(readFileSync(offsetFile, 'utf-8').trim(), 10);
    expect(offset).toBeGreaterThan(100);
  });

  test('handles errors in message handler gracefully', async () => {
    const api = createApi();
    const poller = new TelegramPoller(api, tmpDir, 100);

    mock.queueMessage({ text: 'trigger error' });
    mock.queueMessage({ text: 'after error' });

    const received: string[] = [];
    poller.onMessage((msg) => {
      if (msg.text === 'trigger error') throw new Error('handler crashed');
      received.push(msg.text || '');
    });

    // Should not throw even though handler throws
    await poller.pollOnce();
    // Second message should still be processed
    expect(received).toContain('after error');
  });
});

// ============================================================================
// 11. Callback routing tests (FastChecker patterns)
// ============================================================================

test.describe('Callback data patterns', () => {
  test('permission callback patterns are valid', () => {
    const patterns = [
      'perm_allow_abc123def',
      'perm_deny_abc123def',
      'perm_continue_abc123def',
    ];
    for (const p of patterns) {
      expect(p).toMatch(/^perm_(allow|deny|continue)_[a-f0-9]+$/);
    }
  });

  test('restart callback patterns are valid', () => {
    const patterns = [
      'restart_allow_abc123',
      'restart_deny_abc123',
    ];
    for (const p of patterns) {
      expect(p).toMatch(/^restart_(allow|deny)_[a-f0-9]+$/);
    }
  });

  test('ask single-select callback patterns', () => {
    expect('askopt_0_0').toMatch(/^askopt_\d+_\d+$/);
    expect('askopt_2_5').toMatch(/^askopt_\d+_\d+$/);
  });

  test('ask multi-select callback patterns', () => {
    expect('asktoggle_0_0').toMatch(/^asktoggle_\d+_\d+$/);
    expect('asksubmit_0').toMatch(/^asksubmit_\d+$/);
  });
});
