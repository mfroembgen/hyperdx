import type { Request } from 'express';
import { z } from 'zod';

import * as config from '@/config';

import { workos } from './workosClient';
import { WorkosAuthenticationError } from './workosIdentity';

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

export const saveSession = (req: Request) =>
  new Promise<void>((resolve, reject) =>
    req.session.save(error => (error ? reject(error) : resolve())),
  );

const webClaims = z.object({
  sub: z.string().regex(/^user_[A-Za-z0-9]+$/),
  sid: z.string().min(1),
  client_id: z.string().min(1),
  exp: z.number(),
  iat: z.number(),
  sub_profile: z.literal('user').optional(),
  sub_type: z.undefined(),
});

export async function authenticateWorkosSession(req: Request) {
  if (!config.WORKOS || !workos || !req.session?.workosSession) {
    throw new WorkosAuthenticationError(401, 'invalid_token');
  }
  try {
    const session = workos.userManagement.loadSealedSession({
      sessionData: req.session.workosSession,
      cookiePassword: config.EXPRESS_SESSION_SECRET,
    });
    let result = await session.authenticate();
    if (!result.authenticated) {
      if (result.reason !== 'invalid_jwt') {
        throw new WorkosAuthenticationError(401, 'invalid_token');
      }
      const refreshed = await session.refresh();
      if (!refreshed.authenticated) {
        if (refreshed.retryable)
          throw new WorkosAuthenticationError(503, 'upstream_unavailable');
        delete req.session.workosSession;
        await saveSession(req);
        throw new WorkosAuthenticationError(401, 'invalid_token');
      }
      req.session.workosSession = refreshed.sealedSession;
      await saveSession(req);
      result = await session.authenticate();
    }
    if (!result.authenticated)
      throw new WorkosAuthenticationError(401, 'invalid_token');
    const claims = webClaims.safeParse(
      await workos.userManagement.verifyAccessToken(result.accessToken),
    );
    if (
      !claims.success ||
      claims.data.client_id !== config.WORKOS.clientId ||
      claims.data.sub !== result.user.id ||
      claims.data.sid !== result.sessionId
    ) {
      throw new WorkosAuthenticationError(401, 'invalid_token');
    }
    return { userId: claims.data.sub, sessionId: result.sessionId };
  } catch (error) {
    if (error instanceof WorkosAuthenticationError) throw error;
    throw new WorkosAuthenticationError(503, 'upstream_unavailable');
  }
}
