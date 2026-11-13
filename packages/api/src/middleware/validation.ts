import express from 'express';
import { z } from 'zod';

export type RequestSchemas<
  TParams = Record<string, string>,
  TQuery = express.Request['query'],
  TBody = express.Request['body'],
> = {
  params?: z.ZodType<TParams>;
  query?: z.ZodType<TQuery>;
  body?: z.ZodType<TBody>;
};

/** Express 5 exposes query as a getter; retain parsed transforms per request. */
export function setParsedRequestPart(
  req: object,
  part: 'params' | 'query' | 'body',
  value: unknown,
) {
  Object.defineProperty(req, part, {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

function requestValidation<
  TParams = Record<string, string>,
  TQuery = express.Request['query'],
  TBody = express.Request['body'],
>(
  schemas: RequestSchemas<TParams, TQuery, TBody>,
  process: boolean,
): express.RequestHandler<TParams, unknown, TBody, TQuery> {
  return (req, res, next) => {
    const errors: {
      type: string;
      errors: Pick<z.ZodError, 'issues' | 'name'>;
    }[] = [];
    for (const [part, type, schema, value] of [
      ['params', 'Params', schemas.params, req.params],
      ['query', 'Query', schemas.query, req.query],
      ['body', 'Body', schemas.body, req.body],
    ] as const) {
      const parsed = schema?.safeParse(value);
      if (!parsed) continue;
      if (!parsed.success) {
        // Zod 4 no longer serializes issues on the Error itself.
        errors.push({
          type,
          errors: { issues: parsed.error.issues, name: parsed.error.name },
        });
      } else if (process) {
        setParsedRequestPart(req, part, parsed.data);
      }
    }
    if (errors.length > 0) return res.status(400).json(errors);
    return next();
  };
}

export function validateRequest<
  TParams = Record<string, string>,
  TQuery = express.Request['query'],
  TBody = express.Request['body'],
>(schemas: RequestSchemas<TParams, TQuery, TBody>) {
  return requestValidation(schemas, false);
}

export function processRequest<
  TParams = Record<string, string>,
  TQuery = express.Request['query'],
  TBody = express.Request['body'],
>(schemas: RequestSchemas<TParams, TQuery, TBody>) {
  return requestValidation(schemas, true);
}

export function validateRequestHeaders<T extends z.Schema>(schema: T) {
  return function (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) {
    const parsed = schema.safeParse(req.headers);
    if (!parsed.success) {
      return res.status(400).json({
        type: 'Headers',
        errors: { issues: parsed.error.issues, name: parsed.error.name },
      });
    }

    return next();
  };
}
