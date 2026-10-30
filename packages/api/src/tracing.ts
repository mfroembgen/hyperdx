import { initSDK } from '@hyperdx/node-opentelemetry';

import { scrubUrlTokens } from './utils/credentialRedaction';

initSDK({
  instrumentations: {
    // The API logger already exports through the HyperDX Pino transport.
    '@opentelemetry/instrumentation-pino': { disableLogSending: true },
    // Authentication credentials must never reach telemetry. Use standard
    // HTTP spans in this mode instead of the SDK's all-header/body capture.
    ...(process.env.WORKOS_CLIENT_ID !== undefined
      ? {
          '@opentelemetry/instrumentation-http': {
            enabled: true,
            applyCustomAttributesOnSpan: (span, request) => {
              const url =
                'url' in request
                  ? request.url
                  : 'path' in request
                    ? request.path
                    : undefined;
              if (typeof url === 'string' && scrubUrlTokens(url) !== url) {
                const safe = scrubUrlTokens(url);
                span.setAttribute('http.url', safe);
                span.setAttribute('http.target', safe);
                span.setAttribute('url.full', safe);
                span.setAttribute('url.query', safe.split('?')[1] ?? '');
              }
            },
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
        }
      : {}),
  },
});
