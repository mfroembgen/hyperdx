import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertSdkContract,
  createExportCounter,
} from '../browser-sdk-memory.mjs';

test('counts replay events without counting serialized DOM node types', () => {
  const counter = createExportCounter('data-recorder-probe');
  counter.acceptRecords([
    {
      body: JSON.stringify({
        type: 2,
        timestamp: 1,
        data: { node: { type: 0, childNodes: [{ type: 2 }, { type: 2 }] } },
      }),
      attributes: {},
    },
  ]);
  assert.equal(counter.summary().fullSnapshots, 1);
});

test('reassembles out-of-order recorder chunks before classifying mutations', () => {
  const counter = createExportCounter('data-recorder-probe');
  const body = JSON.stringify({
    type: 3,
    timestamp: 2,
    data: {
      source: 0,
      attributes: [{ id: 7, attributes: { 'data-recorder-probe': 'true' } }],
    },
  });
  const midpoint = Math.floor(body.length / 2);
  const record = (chunk, value) => ({
    body: value,
    attributes: {
      'rr-web.event': 9,
      'rr-web.chunk': chunk,
      'rr-web.total-chunks': 2,
    },
  });
  counter.acceptRecords([record(2, body.slice(midpoint))]);
  assert.equal(counter.summary().probeMutations, 0);
  counter.acceptRecords([record(1, body.slice(0, midpoint))]);
  assert.equal(counter.summary().probeMutations, 1);
  assert.equal(counter.summary().decodeFailures, 0);
});

test('a quiet or disabled SDK cannot pass the recorder regression', () => {
  assert.throws(
    () =>
      assertSdkContract({
        api: { init: true, resume: true, advancedCapture: true },
        exports: {
          requests: 0,
          fullSnapshots: 0,
          networkSpans: 0,
          requestBodies: 0,
          responseBodies: 0,
        },
        after: { detachedShadowTargets: 0 },
      }),
    /SDK must export/,
  );
});
