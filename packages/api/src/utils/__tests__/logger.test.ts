import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { Writable } from 'stream';

import {
  REDACTED_PATHS,
  scrubbedRequestSerializer,
  scrubUrlTokens,
  selectRequestSerializers,
} from '@/utils/logger';

/**
 * A wrong redact path fails silently — pino censors nothing and throws
 * nothing — so the config needs its own guard. This asserts against a real
 * pino instance using the exported paths, shaped like pino-http's default
 * request serializer output.
 */
describe('logger redaction', () => {
  function logAndCapture(obj: Record<string, unknown>): string {
    let out = '';
    const sink = new Writable({
      write(chunk, _enc, cb) {
        out += chunk.toString();
        cb();
      },
    });
    const logger = pino(
      { redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' } },
      sink,
    );
    logger.info(obj, 'test');
    return out;
  }

  it('censors the Authorization header', () => {
    const out = logAndCapture({
      req: { headers: { authorization: 'Bearer super-secret-key' } },
    });

    expect(out).not.toContain('super-secret-key');
    expect(out).toContain('[REDACTED]');
  });

  it('censors request cookies and response set-cookie', () => {
    const out = logAndCapture({
      req: { headers: { cookie: 'connect.sid=secret-session' } },
      res: { headers: { 'set-cookie': 'connect.sid=another-secret' } },
    });

    expect(out).not.toContain('secret-session');
    expect(out).not.toContain('another-secret');
  });

  it('censors a redirect Location header', () => {
    const out = logAndCapture({
      res: { headers: { location: '/team/setup/secret-token' } },
    });

    expect(out).not.toContain('secret-token');
  });

  it('leaves non-credential headers intact', () => {
    const out = logAndCapture({
      req: { headers: { 'user-agent': 'vi', authorization: 'Bearer x' } },
    });

    expect(out).toContain('vi');
  });
});

/**
 * `redact` addresses object paths, so a token living inside a URL string is
 * out of its reach. This route takes a standalone bearer credential as a
 * path segment.
 */
describe('scrubUrlTokens', () => {
  it.each([
    ['/team/setup/tok-xyz', '/team/setup/[REDACTED]'],
    ['/api/team/setup/tok-xyz', '/api/team/setup/[REDACTED]'],
    [
      '/api/auth/workos/callback?code=secret-code&state=secret-state',
      '/api/auth/workos/callback?code=[REDACTED]&state=[REDACTED]',
    ],
    [
      '/callback?%63ode=secret&access_token=value&x=1',
      '/callback?%63ode=[REDACTED]&access_token=[REDACTED]&x=1',
    ],
    // Query strings and fragments must not be swallowed into the token.
    ['/team/setup/tok-xyz?x=1', '/team/setup/[REDACTED]?x=1'],
  ])('scrubs %s', (input, expected) => {
    expect(scrubUrlTokens(input)).toBe(expected);
  });

  it('leaves unrelated URLs untouched', () => {
    expect(scrubUrlTokens('/api/v2/dashboards/655b1b7d9143aa1b1b73f4f4')).toBe(
      '/api/v2/dashboards/655b1b7d9143aa1b1b73f4f4',
    );
  });
});

/**
 * pino-http wraps this serializer, so it is handed an already-serialized
 * object rather than the raw IncomingMessage. Feeding it the wrapper's actual
 * input pins that contract: re-running `pino.stdSerializers.req` inside would
 * resolve `remoteAddress`/`remotePort` from a `socket` that is no longer there
 * and silently drop the client IP from every production request log.
 */
describe('scrubbedRequestSerializer', () => {
  // A real IncomingMessage over a real Socket rather than a cast object
  // literal: the point of this test is that the std serializer resolves the
  // client address off the socket, so a hand-shaped stand-in could satisfy the
  // assertions while diverging from what pino actually receives.
  // remoteAddress/remotePort are prototype getters on Socket, hence
  // defineProperty rather than assignment.
  const rawRequest = () => {
    const socket = new Socket();
    Object.defineProperty(socket, 'remoteAddress', { value: '203.0.113.7' });
    Object.defineProperty(socket, 'remotePort', { value: 51234 });

    const req = new IncomingMessage(socket);
    req.method = 'GET';
    req.url = '/api/team/setup/super-secret-token?ack=1';
    req.headers = { authorization: 'Bearer x' };
    return req;
  };

  it('scrubs the URL without dropping the client address', () => {
    const out = scrubbedRequestSerializer(
      pino.stdSerializers.req(rawRequest()),
    );

    expect(out.url).toBe('/api/team/setup/[REDACTED]?ack=1');
    expect(out.remoteAddress).toBe('203.0.113.7');
    expect(out.remotePort).toBe(51234);
    expect(out.method).toBe('GET');
    expect(out.headers).toEqual({ authorization: 'Bearer x' });
  });
});

/**
 * The three pieces above are each tested in isolation, but the thing that
 * actually ships is their composition: pino's `redact` paths, pino-http's
 * `wrapRequestSerializer`, and `scrubbedRequestSerializer`. That combination is
 * never exercised elsewhere — the production serializer branch is selected only
 * when `!IS_DEV && !IS_CI`, and `IS_CI` is true under Jest — so a change to any
 * one of them could drop a credential into stdout with every other test still
 * green. Build the real thing and read the bytes.
 */
describe('production log line', () => {
  function captureRequestLog(req: IncomingMessage): string {
    let out = '';
    const sink = new Writable({
      write(chunk, _enc, cb) {
        out += chunk.toString();
        cb();
      },
    });
    // Mirrors the production wiring in logger.ts: same redact config, same
    // serializer, and pino-http's default wrapSerializers behaviour.
    const logger = pino(
      { redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' } },
      sink,
    );
    const middleware = pinoHttp({
      logger,
      serializers: { req: scrubbedRequestSerializer },
    });

    const res = new ServerResponse(req);
    middleware(req, res);
    res.setHeader('set-cookie', 'connect.sid=rotated-session');
    res.statusCode = 200;
    res.emit('finish');

    return out;
  }

  it('omits credential-bearing parsed query and route parameters from the real production serializer', () => {
    const req = new IncomingMessage(new Socket());
    req.method = 'GET';
    req.url =
      '/api/auth/workos/callback?code=fixture-code-secret&state=fixture-state-secret';
    Object.assign(req, {
      query: { code: 'fixture-code-secret', state: 'fixture-state-secret' },
      params: { token: 'fixture-route-secret' },
    });
    const out = captureRequestLog(req);
    expect(out).not.toContain('fixture-code-secret');
    expect(out).not.toContain('fixture-state-secret');
    expect(out).not.toContain('fixture-route-secret');
    expect(out).toContain(
      '/api/auth/workos/callback?code=[REDACTED]&state=[REDACTED]',
    );
  });

  it('emits no plaintext credential and no URL token', () => {
    const socket = new Socket();
    Object.defineProperty(socket, 'remoteAddress', { value: '203.0.113.7' });
    const req = new IncomingMessage(socket);
    req.method = 'GET';
    req.url = '/api/team/setup/super-secret-token';
    req.headers = {
      authorization: 'Bearer super-secret-key',
      'proxy-authorization': 'Basic private-proxy-credential',
      'x-clickhouse-key': 'incoming-clickhouse-credential',
      cookie: 'connect.sid=secret-session',
      'x-hyperdx-api-key': 'separate-service-personal-key',
      'user-agent': 'vi',
    };

    const out = captureRequestLog(req);

    expect(out).not.toContain('super-secret-key');
    expect(out).not.toContain('private-proxy-credential');
    expect(out).not.toContain('incoming-clickhouse-credential');
    expect(out).not.toContain('secret-session');
    expect(out).not.toContain('rotated-session');
    expect(out).not.toContain('super-secret-token');
    expect(out).not.toContain('separate-service-personal-key');
    expect(out).toContain('[REDACTED]');
    // Still a useful log line: the non-credential parts survive.
    expect(out).toContain('vi');
    expect(out).toContain('203.0.113.7');
  });
});

/**
 * The branch itself, not just its output. `expressLogger` is built at import
 * time from `IS_DEV || IS_CI`, and IS_CI is true under Jest, so the production
 * wiring is unreachable in this suite — inverting the condition would leave the
 * rest of these tests green while shipping unscrubbed request URLs.
 */
describe('selectRequestSerializers', () => {
  it('wires the scrubbing serializer outside dev and CI', () => {
    expect(selectRequestSerializers(false).serializers.req).toBe(
      scrubbedRequestSerializer,
    );
  });

  it('disables req and res serializers in dev and CI', () => {
    const { serializers } = selectRequestSerializers(true);

    expect(serializers.req).not.toBe(scrubbedRequestSerializer);
    // pino-pretty already prints the request line locally; the full objects
    // are noise. Both must be off, not just req.
    expect(serializers.req({})).toBeUndefined();
    expect(serializers.res({})).toBeUndefined();
  });
});
