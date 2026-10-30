import express from 'express';
import request from 'supertest';
import { z } from 'zod';

import { processRequest, validateRequest } from '@/middleware/validation';

describe('request validation on Express 5', () => {
  it.each([
    { middleware: processRequest, limit: 2, body: { name: 'value' } },
    {
      middleware: validateRequest,
      limit: '2',
      body: { name: 'value', extra: true },
    },
  ])(
    'preserves processing semantics for $middleware.name',
    async ({ middleware, limit, body }) => {
      const app = express();
      app.use(express.json());
      app.post(
        '/:id',
        middleware({
          params: z.object({ id: z.string() }),
          query: z.object({ limit: z.coerce.number().int() }),
          body: z.object({ name: z.string() }),
        }),
        (req, res) =>
          res.json({ params: req.params, query: req.query, body: req.body }),
      );

      const result = await request(app)
        .post('/example?limit=2')
        .send({ name: 'value', extra: true })
        .expect(200);

      expect(result.body).toEqual({
        params: { id: 'example' },
        query: { limit },
        body,
      });
    },
  );

  it('returns every invalid request part with serializable Zod issues', async () => {
    const app = express();
    const handler = vi.fn();
    app.use(express.json());
    app.post(
      '/:id',
      processRequest({
        params: z.object({ id: z.string().min(3) }),
        query: z.object({ limit: z.coerce.number().int() }),
        body: z.object({ name: z.string() }),
      }),
      handler,
    );

    const result = await request(app)
      .post('/x?limit=invalid')
      .send({ name: 1 })
      .expect(400);

    expect(result.body).toMatchObject([
      { type: 'Params', errors: { issues: [{ path: ['id'] }] } },
      { type: 'Query', errors: { issues: [{ path: ['limit'] }] } },
      { type: 'Body', errors: { issues: [{ path: ['name'] }] } },
    ]);
    expect(handler).not.toHaveBeenCalled();
  });
});
