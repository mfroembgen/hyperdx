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
