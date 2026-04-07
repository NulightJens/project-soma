#!/usr/bin/env node
/**
 * Mock Claude Code process for E2E testing.
 * Simulates: startup, permissions text, message processing, /loop, /exit.
 */

const readline = require('readline');

// Simulate startup delay
setTimeout(() => {
  console.log('Claude Code v1.0 (mock)');
  console.log('Loading...');

  setTimeout(() => {
    // This text triggers bootstrap detection
    console.log('permissions: all granted');
    console.log('Ready for input.');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    rl.on('line', (input) => {
      const trimmed = input.trim();

      if (trimmed === '/exit') {
        console.log('Goodbye!');
        process.exit(0);
      }

      if (trimmed.startsWith('/loop')) {
        console.log(`Loop registered: ${trimmed}`);
        return;
      }

      if (trimmed === '/compact') {
        console.log('Context compacted.');
        return;
      }

      // Simulate processing Telegram messages
      if (trimmed.includes('=== TELEGRAM from')) {
        setTimeout(() => {
          console.log('Processing Telegram message...');
          console.log('Response sent.');
        }, 200);
        return;
      }

      // Simulate processing agent messages
      if (trimmed.includes('=== AGENT MESSAGE from')) {
        setTimeout(() => {
          console.log('Processing agent message...');
          console.log('Response sent.');
        }, 200);
        return;
      }

      // Default: acknowledge input
      if (trimmed.length > 0) {
        console.log(`Received: ${trimmed.slice(0, 100)}`);
      }
    });

    rl.on('close', () => {
      process.exit(0);
    });
  }, 500);
}, 200);
