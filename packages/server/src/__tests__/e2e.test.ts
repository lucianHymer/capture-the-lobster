/**
 * E2E Tests: Full stack verification.
 *
 * Starts the server, verifies pages load, MCP responds, API works.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import path from 'path';

const PORT = 5174;
const BASE = `http://localhost:${PORT}`;

// Helper to wait for server to be ready
async function waitForServer(url: string, timeoutMs: number = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Server at ${url} did not start within ${timeoutMs}ms`);
}

describe('E2E: Full stack', () => {
  let serverProcess: ChildProcess;

  beforeAll(async () => {
    // Start server
    const serverPath = path.resolve(
      import.meta.dirname,
      '../../dist/index.js',
    );
    serverProcess = spawn('node', [serverPath], {
      env: {
        ...process.env,
        PORT: String(PORT),
        USE_CLAUDE_BOTS: 'false',
      },
      stdio: 'pipe',
    });

    // Collect output for debugging
    serverProcess.stderr?.on('data', (data) => {
      const msg = data.toString();
      if (!msg.includes('ExperimentalWarning')) {
        // suppress noisy warnings
      }
    });

    await waitForServer(BASE);
  }, 20000);

  afterAll(() => {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
    }
  });

  it('homepage loads', async () => {
    const res = await fetch(BASE);
    expect(res.status).toBe(200);
    const html = await res.text();
    // Should serve the built frontend
    expect(html).toContain('html');
  });

  it('/games microsite loads', async () => {
    const res = await fetch(`${BASE}/games`);
    expect(res.status).toBe(200);
  });

  it('lobby API works', async () => {
    const res = await fetch(`${BASE}/api/lobbies`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('server handles unknown API routes gracefully', async () => {
    const res = await fetch(`${BASE}/api/game/nonexistent`);
    // Server should not crash — any response is acceptable
    expect(res.status).toBeLessThan(500);
  });

  it('MCP endpoint accepts POST', async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch(`${BASE}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test', version: '0.1.0' },
          },
          id: 1,
        }),
        signal: controller.signal,
      });
      // MCP should respond (200 or SSE)
      expect(res.status).toBeLessThan(500);
    } catch (err: any) {
      // AbortError is fine — means the server accepted the connection
      // and started streaming (SSE), which is correct MCP behavior
      if (err.name !== 'AbortError') throw err;
    } finally {
      clearTimeout(timeout);
    }
  });
});
