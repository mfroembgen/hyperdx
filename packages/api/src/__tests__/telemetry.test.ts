import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { vi } from 'vitest';

const mockInit = vi.fn();
let mockIsMainThread = true;

vi.mock('@clickhouse/clickstack-node', () => ({
  init: (...args: unknown[]) => mockInit(...args),
}));
vi.mock('node:worker_threads', () => ({
  get isMainThread() {
    return mockIsMainThread;
  },
}));

describe('telemetry preload', () => {
  const originalEnv = { ...process.env };

  const runPreload = async (env: Record<string, string>) => {
    delete process.env.HYPERDX_API_KEY;
    delete process.env.OTEL_EXPORTER_OTLP_HEADERS;
    delete process.env.NODE_ENV;
    Object.assign(process.env, env);
    vi.resetModules();
    await import('@/telemetry.js');
  };

  const httpInstrumentation = {
    '@opentelemetry/instrumentation-http': {
      applyCustomAttributesOnSpan: expect.any(Function),
    },
  };

  beforeEach(() => {
    mockInit.mockClear();
    mockIsMainThread = true;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('does not start the SDK without a key or OTLP headers', async () => {
    await runPreload({ HYPERDX_API_KEY: ' ', OTEL_EXPORTER_OTLP_HEADERS: '' });

    expect(mockInit).not.toHaveBeenCalled();
  });

  it('passes HYPERDX_API_KEY as the apiKey', async () => {
    await runPreload({ HYPERDX_API_KEY: 'ingest-key', NODE_ENV: 'production' });

    expect(mockInit).toHaveBeenCalledWith({
      apiKey: 'ingest-key',
      instrumentations: httpInstrumentation,
    });
  });

  it('appends the key to OTLP headers that have no authorization entry', async () => {
    await runPreload({
      HYPERDX_API_KEY: 'ingest,key',
      OTEL_EXPORTER_OTLP_HEADERS: 'x-scope-orgid=acme',
    });

    expect(process.env.OTEL_EXPORTER_OTLP_HEADERS).toBe(
      'x-scope-orgid=acme,authorization=ingest%2Ckey',
    );
    expect(mockInit).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: undefined }),
    );
  });

  it('enables host metrics only in development', async () => {
    await runPreload({
      HYPERDX_API_KEY: 'ingest-key',
      NODE_ENV: 'development',
    });

    expect(mockInit).toHaveBeenCalledWith({
      apiKey: 'ingest-key',
      instrumentations: {
        ...httpInstrumentation,
        '@opentelemetry/instrumentation-host-metrics': { enabled: true },
      },
    });
  });

  it('does not start a second SDK in a worker thread', async () => {
    mockIsMainThread = false;

    await runPreload({ HYPERDX_API_KEY: 'ingest-key' });

    expect(mockInit).not.toHaveBeenCalled();
  });
});

describe('native HTTP instrumentation under Bun', () => {
  // The preload must keep HTTP server spans, Express spans and request
  // duration metrics, and keep OAuth credentials in the URL out of spans.
  it('records request telemetry after loading HTTPS', () => {
    execFileSync(
      process.execPath,
      [
        '--no-env-file',
        '--preload',
        path.resolve(__dirname, '../telemetry.ts'),
        path.resolve(__dirname, 'fixtures/telemetry.ts'),
      ],
      {
        timeout: 10000,
        env: {
          PATH: process.env.PATH,
          NODE_ENV: 'production',
          HYPERDX_API_KEY: 'local-telemetry-test',
          OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1',
          OTEL_NODE_RESOURCE_DETECTORS: 'env',
          OTEL_LOGS_EXPORTER: 'none',
        },
      },
    );
  });
});
