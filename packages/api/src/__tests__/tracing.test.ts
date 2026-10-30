jest.mock('@hyperdx/node-opentelemetry', () => ({ initSDK: jest.fn() }));

const originalClientId = process.env.WORKOS_CLIENT_ID;

describe('WorkOS credential-safe HTTP instrumentation', () => {
  afterEach(() => {
    if (originalClientId === undefined) delete process.env.WORKOS_CLIENT_ID;
    else process.env.WORKOS_CLIENT_ID = originalClientId;
    jest.clearAllMocks();
    jest.resetModules();
  });

  it('replaces advanced header/body capture only when WorkOS is configured', async () => {
    process.env.WORKOS_CLIENT_ID = 'client_example';
    jest.requireActual('@/tracing');
    expect(
      jest.requireMock('@hyperdx/node-opentelemetry').initSDK,
    ).toHaveBeenCalledWith({
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
    delete process.env.WORKOS_CLIENT_ID;
    jest.requireActual('@/tracing');
    expect(
      jest.requireMock('@hyperdx/node-opentelemetry').initSDK,
    ).toHaveBeenCalledWith({
      instrumentations: {
        '@opentelemetry/instrumentation-pino': { disableLogSending: true },
      },
    });
  });
});
