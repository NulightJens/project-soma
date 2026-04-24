/**
 * Dashboard Authentication Tests
 * Tests 24.2 (wrong password rejected) and 24.4 (session/token handling)
 *
 * Run against the live e2e-phase dashboard at port 3001.
 *
 * Note: JWT signature verification is not performed at the middleware level
 * (Edge Runtime limitation). Middleware checks for presence of Bearer token.
 * Individual API routes can add additional verification if needed.
 */
import { test, expect } from '@playwright/test';

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:3001';
const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'SOMA';

test.describe('Dashboard Auth (24.2, 24.4)', () => {
  test('24.2 - Wrong password returns 401 / shows error', async ({ page }) => {
    // Test via mobile auth API (CSRF-free)
    const resp = await page.request.post(`${DASHBOARD_URL}/api/auth/mobile`, {
      data: { username: ADMIN_USER, password: 'wrongpassword' },
      headers: { 'Content-Type': 'application/json' },
    });

    expect(resp.status()).toBe(401);
    const body = await resp.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/invalid credentials/i);
  });

  test('24.2 - Missing credentials returns 400', async ({ page }) => {
    const resp = await page.request.post(`${DASHBOARD_URL}/api/auth/mobile`, {
      data: { username: ADMIN_USER },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(resp.status()).toBe(400);
  });

  test('24.2 - Correct credentials return JWT token', async ({ page }) => {
    const resp = await page.request.post(`${DASHBOARD_URL}/api/auth/mobile`, {
      data: { username: ADMIN_USER, password: ADMIN_PASS },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body).toHaveProperty('token');
    expect(body).toHaveProperty('user');
    expect(body.user).toHaveProperty('id');
    expect(body.user).toHaveProperty('name');
    // Token should be a non-empty JWT string (header.payload.signature)
    expect(body.token).toMatch(/^ey[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/);
  });

  test('24.4 - No Authorization header returns 401', async ({ page }) => {
    // Without any token, middleware rejects with 401
    const resp = await page.request.get(`${DASHBOARD_URL}/api/tasks`);
    expect(resp.status()).toBe(401);
  });

  test('24.4 - Authenticated request works with valid Bearer token', async ({ page }) => {
    // Get a valid token
    const authResp = await page.request.post(`${DASHBOARD_URL}/api/auth/mobile`, {
      data: { username: ADMIN_USER, password: ADMIN_PASS },
      headers: { 'Content-Type': 'application/json' },
    });
    const { token } = await authResp.json() as { token: string };

    // Valid token works
    const validResp = await page.request.get(`${DASHBOARD_URL}/api/tasks`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    expect(validResp.status()).toBe(200);
    const tasks = await validResp.json();
    expect(Array.isArray(tasks)).toBe(true);
  });

  test('24.4 - CORS preflight returns 204 with correct headers', async ({ page }) => {
    const resp = await page.request.fetch(`${DASHBOARD_URL}/api/tasks`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:8081',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Authorization',
      },
    });
    expect(resp.status()).toBe(204);
    expect(resp.headers()['access-control-allow-origin']).toBe('*');
    expect(resp.headers()['access-control-allow-headers']).toContain('Authorization');
  });
});
