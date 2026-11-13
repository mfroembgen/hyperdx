import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';

const MAX_BYTES = 8 * 1024 * 1024;

const REPLAY_SCOPE = 'rum.rr-web';

const anyValue = value =>
  value?.stringValue ??
  value?.intValue ??
  value?.doubleValue ??
  value?.boolValue;

// Replay log records of an OTLP/JSON logs export; other RUM log events are skipped.
function replayRecords(data) {
  const records = [];
  for (const resource of data.resourceLogs ?? []) {
    for (const scope of resource.scopeLogs ?? []) {
      if (scope.scope?.name !== REPLAY_SCOPE) continue;
      for (const record of scope.logRecords ?? []) {
        const attributes = {};
        for (const attribute of record.attributes ?? [])
          attributes[attribute.key] = anyValue(attribute.value);
        records.push({ body: anyValue(record.body), attributes });
      }
    }
  }
  return records;
}

export function createExportCounter(probeName) {
  const counts = {
    requests: 0,
    logRecords: 0,
    fullSnapshots: 0,
    probeMutations: 0,
    networkSpans: 0,
    decodeFailures: 0,
  };
  const chunks = new Map();
  function classify(event) {
    if (typeof event?.timestamp !== 'number') return;
    if (event.type === 2 && event.data?.node) counts.fullSnapshots++;
    if (
      event.type === 3 &&
      event.data?.source === 0 &&
      event.data.attributes?.some(attribute =>
        Object.hasOwn(attribute.attributes ?? {}, probeName),
      )
    ) {
      counts.probeMutations++;
    }
  }
  function acceptRecords(records) {
    for (const record of records) {
      counts.logRecords++;
      const attributes = record.attributes ?? {};
      const total = Number(attributes['rr-web.total-chunks'] ?? 1);
      if (total === 1) classify(JSON.parse(record.body));
      else {
        const id = attributes['rr-web.event'];
        const index = Number(attributes['rr-web.chunk']);
        assert.ok(
          id !== undefined && total < 100 && index > 0 && index <= total,
        );
        const entry = chunks.get(id) ?? { total, parts: new Map(), bytes: 0 };
        if (!entry.parts.has(index))
          entry.bytes += Buffer.byteLength(record.body);
        assert.ok(
          entry.bytes <= MAX_BYTES,
          'recorder event exceeds test budget',
        );
        entry.parts.set(index, record.body);
        chunks.set(id, entry);
        if (entry.parts.size === total) {
          const body = Array.from({ length: total }, (_, i) =>
            entry.parts.get(i + 1),
          ).join('');
          classify(JSON.parse(body));
          chunks.delete(id);
        }
      }
    }
  }
  function traceSpans(value) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.traceId === 'string' && Array.isArray(value.attributes)) {
      const keys = value.attributes.map(attribute => attribute.key);
      if (
        keys.some(key =>
          ['http.url', 'http.method', 'http.request.method'].includes(key),
        )
      )
        counts.networkSpans++;
    }
    for (const child of Object.values(value))
      if (typeof child === 'object') traceSpans(child);
  }
  return {
    acceptRecords,
    accept(buffer) {
      counts.requests++;
      try {
        assert.ok(buffer.length <= MAX_BYTES, 'export exceeds test budget');
        const bytes =
          buffer[0] === 31 && buffer[1] === 139
            ? gunzipSync(buffer, { maxOutputLength: MAX_BYTES })
            : buffer;
        const data = JSON.parse(bytes.toString('utf8'));
        traceSpans(data.resourceSpans);
        acceptRecords(replayRecords(data));
      } catch {
        counts.decodeFailures++;
      }
    },
    summary: () => ({ ...counts, incompleteEvents: chunks.size }),
  };
}

export function assertSdkContract(result) {
  assert.ok(
    ['init', 'resume'].every(key => result.api?.[key] === true),
    'SDK public wrapper must initialize',
  );
  assert.ok(result.exports.requests > 0, 'SDK must export');
  assert.ok(
    result.exports.fullSnapshots > 0,
    'SDK must record replay snapshots',
  );
  assert.ok(result.exports.networkSpans > 0, 'SDK must export network spans');
  assert.equal(
    result.exports.decodeFailures,
    0,
    'SDK exports must decode completely',
  );
  assert.equal(
    result.exports.incompleteEvents,
    0,
    'SDK recorder chunks must be complete',
  );
}
