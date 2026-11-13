import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

import { shutdown } from '@clickhouse/clickstack-node';
import { SpanKind } from '@opentelemetry/api';

// Capture the SDK's own exporters without adding test-only dependency pins.
const sdkRequire = createRequire(
  createRequire(require.resolve('@clickhouse/clickstack-node')).resolve(
    '@opentelemetry/sdk-node',
  ),
);
const { DataPointType } = sdkRequire('@opentelemetry/sdk-metrics');
type ExportedSpan = {
  attributes: Record<string, unknown>;
  kind: SpanKind;
  name: string;
  instrumentationScope: { name: string };
  parentSpanContext?: { spanId: string };
  spanContext: () => { traceId: string };
};
type ExportedMetrics = {
  scopeMetrics: {
    metrics: {
      descriptor: { name: string };
      dataPointType: number;
      dataPoints: {
        attributes: Record<string, unknown>;
        value: { count?: number };
      }[];
    }[];
  }[];
};
const spans: ExportedSpan[] = [];
const metrics: ExportedMetrics[] = [];
sdkRequire(
  '@opentelemetry/exporter-trace-otlp-proto',
).OTLPTraceExporter.prototype.export = (
  batch: ExportedSpan[],
  done: (result: { code: number }) => void,
) => {
  spans.push(...batch);
  done({ code: 0 });
};
sdkRequire(
  '@opentelemetry/exporter-metrics-otlp-proto',
).OTLPMetricExporter.prototype.export = (
  batch: ExportedMetrics,
  done: (result: { code: number }) => void,
) => {
  metrics.push(batch);
  done({ code: 0 });
};

// Match the compiled API's CommonJS imports so module instrumentation runs.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const express: typeof import('express') = require('express');
// Production dependencies load HTTPS after the API has already loaded HTTP.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('node:https');

async function verifyHttpTracing() {
  const app = express();
  app.get('/health', (_req, res) => res.send('OK'));
  const server = createServer(app);

  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert(address && typeof address !== 'string');
    const response = await fetch(
      `http://127.0.0.1:${address.port}/health?code=oauth-secret&state=kept`,
      {
        headers: {
          traceparent:
            '00-11111111111111111111111111111111-2222222222222222-01',
        },
      },
    );
    assert.equal(await response.text(), 'OK');
  } finally {
    server.closeAllConnections();
    server.close();
    await shutdown();
  }

  const requests = spans.filter(span => span.kind === SpanKind.SERVER);
  assert.equal(requests.length, 1, 'one HTTP server span must be exported');
  assert.equal(requests[0].name, 'GET /health');
  assert.equal(
    requests[0].spanContext().traceId,
    '11111111111111111111111111111111',
  );
  assert.equal(requests[0].parentSpanContext?.spanId, '2222222222222222');
  assert(
    !JSON.stringify(requests[0].attributes).includes('oauth-secret'),
    'OAuth credentials in the URL must not reach span attributes',
  );
  assert(
    spans.some(
      span =>
        span.instrumentationScope.name ===
          '@opentelemetry/instrumentation-express' &&
        span.spanContext().traceId === requests[0].spanContext().traceId,
    ),
    'Express spans must belong to the incoming request trace',
  );
  assert(
    metrics.some(batch =>
      batch.scopeMetrics.some(scope =>
        scope.metrics.some(
          metric =>
            metric.descriptor.name === 'http.server.request.duration' &&
            metric.dataPointType === DataPointType.HISTOGRAM &&
            metric.dataPoints.some(
              point =>
                point.attributes['http.route'] === '/health' &&
                point.value.count === 1,
            ),
        ),
      ),
    ),
    'HTTP server duration must be recorded',
  );
}

void verifyHttpTracing();
