import { vi } from 'vitest';
// Suppress noisy console output during test runs.
// - debug/info: ClickHouse query logging, server startup messages
// - warn: expected column-not-found warnings from renderChartConfig on CTE tables
vi.spyOn(console, 'debug').mockImplementation(() => {});
vi.spyOn(console, 'info').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

// Mock alert notification functions to prevent HTTP calls during tests
vi.mock('@/utils/slack', async () => ({
  ...(await vi.importActual<typeof import('@/utils/slack')>('@/utils/slack')),
  postMessageToWebhook: vi.fn().mockResolvedValue(null),
}));

// Mock global fetch for generic webhook calls. The real one is kept on
// `globalThis.realFetch` so a test that needs to reach a live service (e.g.
// ClickHouse's Prometheus API) can `mockFetch.mockImplementation(realFetch)`
// for its duration.
Object.assign(globalThis, { realFetch: global.fetch });
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  text: vi.fn().mockResolvedValue(''),
  json: vi.fn().mockResolvedValue({}),
} as any);
