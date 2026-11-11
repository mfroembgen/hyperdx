import type { RequestHandler } from 'express';
import type { ClientRequest, IncomingMessage, ServerResponse } from 'http';

import logger from '@/utils/logger';

type ParsedRequest = Pick<IncomingMessage, 'headers'> & {
  _hdxProxyBody?: Buffer;
  // Set by body-parser before it reads the stream.
  _body?: boolean;
};

type ProxyRequest = Pick<
  ClientRequest,
  'getHeader' | 'setHeader' | 'removeHeader' | 'write' | 'destroy'
>;

/** Keep Express 4's last-charset behavior without changing forwarded headers. */
export function preserveProxyCharset(parser: RequestHandler): RequestHandler {
  return (req, res, next) => {
    const original = req.headers['content-type'];
    if (!original || !/^\/clickhouse-proxy(?:\/|$)/i.test(req.path)) {
      return parser(req, res, next);
    }
    const parameter = /;\s*charset\s*=\s*("(?:\\.|[^"\\])*"|[^;\s]*)/gi;
    const charsets = [...original.matchAll(parameter)];
    const last = charsets.at(-1);
    if (charsets.length < 2 || !last) return parser(req, res, next);

    // body-parser 2 uses the first duplicate; its predecessor used the last.
    // Canonicalize only for parsing, then restore the original wire header.
    req.headers['content-type'] =
      original.replace(parameter, '') + `; charset=${last[1]}`;
    return parser(req, res, error => {
      req.headers['content-type'] = original;
      next(error);
    });
  };
}

export function captureProxyBody(
  req: IncomingMessage & ParsedRequest & { path?: string },
  _res: ServerResponse,
  body: Buffer,
) {
  if (/^\/clickhouse-proxy(?:\/|$)/i.test(req.path ?? '')) {
    // verify receives inflated bytes before parsing can change their values.
    req._hdxProxyBody = body;
  }
}

export function writeProxyBody(proxyReq: ProxyRequest, req: ParsedRequest) {
  const body = req._hdxProxyBody;
  if (body === undefined) {
    // No parser consumed this stream, so let the proxy pipe the original bytes.
    if (!req._body) return;

    // A drained stream would leave upstream waiting on the original length.
    const err = new Error('ClickHouse proxy body was parsed but not captured');
    logger.error({ err }, 'Unable to forward ClickHouse proxy body');
    proxyReq.destroy(err);
    return;
  }

  try {
    proxyReq.removeHeader('content-encoding');
    if (proxyReq.getHeader('transfer-encoding')) {
      proxyReq.removeHeader('content-length');
    } else {
      proxyReq.setHeader('content-length', body.length);
    }
    proxyReq.write(body);
  } catch (err) {
    logger.error({ err }, 'Unable to forward ClickHouse proxy body');
    proxyReq.destroy(
      err instanceof Error ? err : new Error('Unable to forward proxy body'),
    );
  }
}
