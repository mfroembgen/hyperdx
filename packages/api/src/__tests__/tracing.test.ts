import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { initSDK } from '@hyperdx/node-opentelemetry';

vi.mock('@hyperdx/node-opentelemetry', () => ({ initSDK: vi.fn() }));

describe('WorkOS credential-safe HTTP instrumentation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('replaces advanced header/body capture only when WorkOS is configured', async () => {
    vi.stubEnv('WORKOS_CLIENT_ID', 'client_example');
    await import('@/tracing.js');
    expect(initSDK).toHaveBeenCalledWith({
      instrumentations: {
        '@opentelemetry/instrumentation-pino': { disableLogSending: true },
        '@opentelemetry/instrumentation-http': {
          enabled: true,
          applyCustomAttributesOnSpan: expect.any(Function),
          headersToSpanAttributes: {
            server: {
              requestHeaders: ['content-type', 'user-agent'],
              responseHeaders: ['content-type'],
            },
            client: {
              requestHeaders: ['content-type', 'user-agent'],
              responseHeaders: ['content-type'],
            },
          },
        },
      },
    });
  });

  it('preserves existing network capture in legacy deployments', async () => {
    vi.stubEnv('WORKOS_CLIENT_ID', undefined);
    await import('@/tracing.js');
    expect(initSDK).toHaveBeenCalledWith({
      instrumentations: {
        '@opentelemetry/instrumentation-pino': { disableLogSending: true },
      },
    });
  });
});

describe('native HTTP instrumentation', () => {
  it.each([
    ['legacy', undefined],
    ['WorkOS', 'client_example'],
  ])(
    'preserves request telemetry after loading HTTPS in %s mode',
    (_, clientId) => {
      execFileSync(
        process.execPath,
        [
          '--no-env-file',
          '--preload',
          path.resolve(__dirname, '../tracing.ts'),
          path.resolve(__dirname, 'fixtures/tracing.ts'),
        ],
        {
          timeout: 10000,
          env: {
            PATH: process.env.PATH,
            NODE_ENV: 'production',
            HYPERDX_API_KEY: 'local-tracing-test',
            OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1',
            OTEL_NODE_RESOURCE_DETECTORS: 'env',
            OTEL_LOGS_EXPORTER: 'none',
            HDX_STARTUP_LOGS: 'false',
            HDX_NODE_CONSOLE_CAPTURE: 'false',
            HDX_NODE_STOP_ON_TERMINATION_SIGNALS: 'false',
            WORKOS_CLIENT_ID: clientId,
          },
        },
      );
    },
  );
});
