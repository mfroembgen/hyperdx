import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';

const MAX_BYTES = 8 * 1024 * 1024;

function fields(buffer) {
  let offset = 0;
  const integer = () => {
    let value = 0;
    let multiplier = 1;
    for (let i = 0; i < 10; i++) {
      assert.ok(offset < buffer.length, 'truncated protobuf');
      const byte = buffer[offset++];
      value += (byte & 127) * multiplier;
      if (!(byte & 128)) return value;
      multiplier *= 128;
    }
    throw new Error('invalid protobuf integer');
  };
  const result = [];
  while (offset < buffer.length) {
    const tag = integer();
    const field = Math.floor(tag / 8);
    const wire = tag % 8;
    if (wire === 2) {
      const size = integer();
      assert.ok(offset + size <= buffer.length, 'truncated protobuf field');
      result.push({ field, bytes: buffer.subarray(offset, offset + size) });
      offset += size;
    } else if (wire === 0) result.push({ field, value: integer() });
    else if (wire === 1) {
      result.push({ field, value: buffer.readDoubleLE(offset) });
      offset += 8;
    } else if (wire === 5) offset += 4;
    else throw new Error('unsupported protobuf wire type');
  }
  return result;
}

function protobufRecords(buffer) {
  const records = [];
  const children = (bytes, field) =>
    fields(bytes).filter(value => value.field === field && value.bytes);
  const anyValue = bytes => {
    const value = fields(bytes).find(item => [1, 3, 4].includes(item.field));
    return value?.bytes ? value.bytes.toString('utf8') : value?.value;
  };
  for (const resource of children(buffer, 1)) {
    for (const scope of children(resource.bytes, 2)) {
      for (const record of children(scope.bytes, 2)) {
        const body = children(record.bytes, 5)[0];
        if (!body) continue;
        const attributes = {};
        for (const attribute of children(record.bytes, 6)) {
          const key = children(attribute.bytes, 1)[0]?.bytes.toString('utf8');
          const value = children(attribute.bytes, 2)[0];
          if (key && value) attributes[key] = anyValue(value.bytes);
        }
        records.push({ body: anyValue(body.bytes), attributes });
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
    requestBodies: 0,
    responseBodies: 0,
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
      ) {
        counts.networkSpans++;
        counts.requestBodies += keys.filter(
          key => key === 'http.request.body',
        ).length;
        counts.responseBodies += keys.filter(
          key => key === 'http.response.body',
        ).length;
      }
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
        if (bytes[0] === 123) traceSpans(JSON.parse(bytes.toString('utf8')));
        else acceptRecords(protobufRecords(bytes));
      } catch {
        counts.decodeFailures++;
      }
    },
    summary: () => ({ ...counts, incompleteEvents: chunks.size }),
  };
}

export function assertSdkContract(result) {
  assert.ok(
    ['init', 'resume', 'advancedCapture'].every(
      key => result.api?.[key] === true,
    ),
    'SDK public wrapper must initialize',
  );
  assert.ok(result.exports.requests > 0, 'SDK must export');
  assert.ok(
    result.exports.fullSnapshots > 0,
    'SDK must record replay snapshots',
  );
  assert.ok(result.exports.networkSpans > 0, 'SDK must export network spans');
  assert.ok(
    result.exports.requestBodies + result.exports.responseBodies > 0,
    'SDK advanced capture must remain active',
  );
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
