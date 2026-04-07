import { mkdirSync, rmdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';

/**
 * Acquire a mutex lock using mkdir (atomic on all filesystems).
 * Matches the bash pattern: mkdir .lock.d with PID tracking.
 *
 * Returns true if lock acquired, false if another process holds it.
 * Automatically recovers stale locks (dead process).
 */
export function acquireLock(dir: string): boolean {
  const lockDir = join(dir, '.lock.d');
  const pidFile = join(lockDir, 'pid');

  try {
    mkdirSync(lockDir);
    writeFileSync(pidFile, String(process.pid));
    return true;
  } catch {
    // Lock exists - check if stale
    try {
      const storedPid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
      if (isNaN(storedPid)) {
        // Corrupt PID file - remove and retry
        rmSync(lockDir, { recursive: true, force: true });
        try {
          mkdirSync(lockDir);
          writeFileSync(pidFile, String(process.pid));
          return true;
        } catch {
          return false;
        }
      }

      // Check if process is still alive
      try {
        process.kill(storedPid, 0);
        // Process is alive - lock is held
        return false;
      } catch {
        // Process is dead - stale lock, remove and acquire
        rmSync(lockDir, { recursive: true, force: true });
        try {
          mkdirSync(lockDir);
          writeFileSync(pidFile, String(process.pid));
          return true;
        } catch {
          return false;
        }
      }
    } catch {
      // Can't read PID file, try to remove and retry
      try {
        rmSync(lockDir, { recursive: true, force: true });
        mkdirSync(lockDir);
        writeFileSync(pidFile, String(process.pid));
        return true;
      } catch {
        return false;
      }
    }
  }
}

/**
 * Release a mutex lock.
 */
export function releaseLock(dir: string): void {
  const lockDir = join(dir, '.lock.d');
  try {
    rmSync(lockDir, { recursive: true, force: true });
  } catch {
    // Ignore errors on release
  }
}
