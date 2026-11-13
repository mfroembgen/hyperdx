/**
 * Self-telemetry preload, loaded with Bun's `--preload` ahead of the API and
 * the task runner (bin/hyperdx, the dev scripts, the e2e web server).
 *
 * This wraps the ClickStack SDK instead of preloading its `register` entry
 * because the SDK never reads HYPERDX_API_KEY, and it would start without a
 * key and send to localhost:4318. decideSelfTelemetry keeps the old HyperDX
 * SDK's key handling and start condition, shared with the Next.js server.
 *
 * It imports nothing from the app, and from common-utils only a module without
 * dependencies: modules loaded before init() are not instrumented.
 */
import { Server as HttpsServer } from 'node:https';
import { isMainThread } from 'node:worker_threads';

import { init } from '@clickhouse/clickstack-node';
import { decideSelfTelemetry } from '@hyperdx/common-utils/dist/selfTelemetry';

import { scrubUrlTokens } from './utils/credentialRedaction';

// OAuth callbacks and setup links carry credentials in the URL. Keep them out
// of the HTTP span attributes the same way the logger scrubs them.
const scrubHttpSpanUrl = (
  span: { setAttribute: (key: string, value: string) => unknown },
  request: object,
) => {
  const target =
    'url' in request ? request.url : 'path' in request ? request.path : null;
  if (typeof target !== 'string') {
    return;
  }
  const safe = scrubUrlTokens(target);
  if (safe === target) {
    return;
  }
  span.setAttribute('http.url', safe);
  span.setAttribute('http.target', safe);
  span.setAttribute('url.full', safe);
  span.setAttribute('url.query', safe.split('?')[1] ?? '');
};

const telemetry = decideSelfTelemetry(process.env);

// Bun's HTTPS server inherits HTTP's emit, so instrumenting HTTPS after HTTP
// unwraps the HTTP server instrumentation. Give HTTPS its own emit first so
// each module is wrapped on its own.
const separateHttpsServerEmit = () => {
  if (!Object.hasOwn(HttpsServer.prototype, 'emit')) {
    Object.defineProperty(HttpsServer.prototype, 'emit', {
      value: HttpsServer.prototype.emit,
      writable: true,
      configurable: true,
    });
  }
};

// Preloads also run in worker threads, such as the pino transport, and init()
// in a worker starts a second SDK there.
if (isMainThread && telemetry.start) {
  if (process.versions.bun) {
    separateHttpsServerEmit();
  }
  if (telemetry.otlpHeaders !== undefined) {
    process.env.OTEL_EXPORTER_OTLP_HEADERS = telemetry.otlpHeaders;
  }
  init({
    apiKey: telemetry.apiKey,
    instrumentations: {
      '@opentelemetry/instrumentation-http': {
        applyCustomAttributesOnSpan: scrubHttpSpanUrl,
      },
      // Only set in development, where host metrics were collected before. It
      // applies to every process this preloads, so the dev API and the dev
      // task runner both report them. An explicit `enabled` value would
      // override the operator's OTEL_NODE_ENABLED_INSTRUMENTATIONS and
      // _DISABLED_ lists elsewhere.
      ...(process.env.NODE_ENV === 'development'
        ? { '@opentelemetry/instrumentation-host-metrics': { enabled: true } }
        : {}),
    },
  });
}
