import type { Request } from 'express';
import { z } from 'zod';

import * as config from '@/config';

import { workos } from './workosClient';
import { WorkosAuthenticationError } from './workosIdentity';
import { replaceStoredWorkosSession } from './workosSessionStore';

declare module 'express-session' {
  interface SessionData {
    workosSession?: string;
    workosSessionId?: string;
    workosLogin?: {
      state: string;
      codeVerifier: string;
      expiresAt: number;
      returnTo: string;
    };
  }
}

const saveSession = (req: Request) =>
  new Promise<void>((resolve, reject) =>
    req.session.save(error => (error ? reject(error) : resolve())),
  );

/** Complete the sole full write for a newly generated SID before responding. */
export async function saveNewSession(req: Request) {
  try {
    await saveSession(req);
  } catch (error) {
    // destroy removes req.session immediately, preventing a cookie or implicit
    // retry even when cleanup of a possibly partial new-SID write also fails.
    await new Promise<void>(resolve =>
      req.session.destroy(() => resolve()),
    ).catch(() => undefined);
    throw error;
  }
  const saved = req.session;
  // Regeneration changes Express's original ID, so even an explicitly saved
  // session otherwise gets a second upserting write while headers are emitted.
  Object.defineProperty(saved, 'save', {
    configurable: true,
    enumerable: false,
    writable: true,
    value: (callback?: (error?: unknown) => void) => {
      callback?.();
      return saved;
    },
  });
}

const webClaims = z.object({
  sub: z.string().regex(/^user_[A-Za-z0-9]+$/),
  sid: z.string().min(1),
  client_id: z.string().min(1),
  exp: z.number(),
  iat: z.number(),
  sub_profile: z.literal('user').optional(),
  sub_type: z.undefined().optional(),
});

function loadSession(sealedSession: string) {
  if (!config.WORKOS || !workos)
    throw new WorkosAuthenticationError(401, 'invalid_token');
  return workos.userManagement.loadSealedSession({
    sessionData: sealedSession,
    cookiePassword: config.EXPRESS_SESSION_SECRET,
  });
}

async function verifyIdentity(
  accessToken: string,
  userId: string,
  sessionId: string,
) {
  if (!config.WORKOS || !workos)
    throw new WorkosAuthenticationError(401, 'invalid_token');
  const claims = webClaims.safeParse(
    await workos.userManagement.verifyAccessToken(accessToken),
  );
  if (
    !claims.success ||
    claims.data.client_id !== config.WORKOS.clientId ||
    claims.data.sub !== userId ||
    claims.data.sid !== sessionId
  ) {
    throw new WorkosAuthenticationError(401, 'invalid_token');
  }
  return { userId: claims.data.sub, sessionId };
}

async function verifySession(session: ReturnType<typeof loadSession>) {
  const result = await session.authenticate();
  if (!result.authenticated)
    throw new WorkosAuthenticationError(401, 'invalid_token');
  return verifyIdentity(result.accessToken, result.user.id, result.sessionId);
}

/** Validate a provisional login without reading or changing a browser session. */
export async function authenticateSealedWorkosSession(sealedSession: string) {
  try {
    return await verifySession(loadSession(sealedSession));
  } catch (error) {
    if (error instanceof WorkosAuthenticationError) throw error;
    throw new WorkosAuthenticationError(503, 'upstream_unavailable');
  }
}

export async function authenticateWorkosSession(req: Request) {
  let sealedSession = req.session?.workosSession;
  if (!sealedSession) throw new WorkosAuthenticationError(401, 'invalid_token');
  try {
    // Never mutate or reload req.session: Express would save its stale payload
    // at response end, overwriting a competing refresh or resurrecting logout.
    for (let attempt = 0; attempt < 3; attempt++) {
      const session = loadSession(sealedSession);
      const result = await session.authenticate();
      if (result.authenticated)
        return await verifyIdentity(
          result.accessToken,
          result.user.id,
          result.sessionId,
        );
      if (result.reason !== 'invalid_jwt')
        throw new WorkosAuthenticationError(401, 'invalid_token');
      const refreshed = await session.refresh();
      if (!refreshed.authenticated && refreshed.retryable)
        throw new WorkosAuthenticationError(503, 'upstream_unavailable');
      // refresh updates the SDK's own state. Verify it before persisting a seal.
      const identity = refreshed.authenticated
        ? await verifySession(session)
        : undefined;
      const replacement = refreshed.authenticated
        ? refreshed.sealedSession
        : undefined;
      const canonical = await replaceStoredWorkosSession(
        req,
        sealedSession,
        replacement,
      );
      if (!canonical) throw new WorkosAuthenticationError(401, 'invalid_token');
      if (canonical === replacement && identity) return identity;
      // Another replica won. Authenticate its complete identity, never reuse
      // claims or a successful refresh result from the losing request.
      sealedSession = canonical;
    }
    throw new WorkosAuthenticationError(503, 'upstream_unavailable');
  } catch (error) {
    if (error instanceof WorkosAuthenticationError) throw error;
    throw new WorkosAuthenticationError(503, 'upstream_unavailable');
  }
}
