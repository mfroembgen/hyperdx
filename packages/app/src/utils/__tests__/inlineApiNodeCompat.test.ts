import { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { Socket } from 'node:net';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { preserveNodeInterface } from '@/utils/inlineApiNodeCompat';

// Exercise the pinned Vinext implementation: Express replaces these exact
// prototypes, which previously broke headers, sessions and streamed bodies.
const require = createRequire(import.meta.url);
const shimPath = join(
  dirname(require.resolve('vinext/package.json')),
  'dist/server/pages-node-compat.js',
);
const { createPagesApiReqRes } = await import(pathToFileURL(shimPath).href);

describe('inline API Node compatibility', () => {
  it('retains real Vinext streams and header state after HTTP prototype replacement', async () => {
    const bytes = new TextEncoder().encode('raw-雪-body');
    const { req, res, responsePromise } = createPagesApiReqRes({
      request: new Request('https://preview.invalid/api/echo', {
        method: 'POST',
        headers: { 'x-forwarded-proto': 'https' },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(bytes.slice(0, 6));
            controller.enqueue(bytes.slice(6));
            controller.close();
          },
        }),
      }),
      url: '/api/echo',
      query: {},
    });
    preserveNodeInterface(req, res);
    expect(Object.hasOwn(res, 'json')).toBe(false);
    expect(Object.hasOwn(res, 'send')).toBe(false);
    expect(Object.hasOwn(res, 'status')).toBe(false);
    expect(req.connection.encrypted).toBe(true);
    expect(req.headers['transfer-encoding']).toBe('chunked');

    Object.setPrototypeOf(req, IncomingMessage.prototype);
    Object.setPrototypeOf(res, ServerResponse.prototype);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(bytes));
    res.statusCode = 201;
    res.setHeader('Set-Cookie', ['one=1', 'two=2']);
    res.setHeader('X-Removed', 'yes');
    res.removeHeader('X-Removed');
    expect(res.hasHeader('X-Removed')).toBe(false);
    res.end('finished');
    const response = await responsePromise;
    expect(response.status).toBe(201);
    expect(response.headers.getSetCookie()).toEqual(['one=1', 'two=2']);
    expect(await response.text()).toBe('finished');
  });

  it('leaves native self-hosted HTTP objects unchanged', () => {
    const req = new IncomingMessage(new Socket());
    const res = new ServerResponse(req);
    const before = [
      Object.getOwnPropertyDescriptors(req),
      Object.getOwnPropertyDescriptors(res),
    ];
    preserveNodeInterface(req, res);
    expect(Object.getOwnPropertyDescriptors(req)).toEqual(before[0]);
    expect(Object.getOwnPropertyDescriptors(res)).toEqual(before[1]);
    req.destroy();
    res.destroy();
  });
});
