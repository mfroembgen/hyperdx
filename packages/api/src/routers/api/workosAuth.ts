import express from 'express';

import * as config from '@/config';
import { getCounter, setBusinessContext } from '@/utils/instrumentation';
import { workos } from '@/utils/workosClient';
import {
  resolveWorkosUser,
  WorkosAuthenticationError,
} from '@/utils/workosIdentity';
import {
  authenticateSealedWorkosSession,
  saveNewSession,
} from '@/utils/workosSession';
import {
  claimWorkosSession,
  consumeWorkosLogin,
  isNewSession,
  storeWorkosLogin,
} from '@/utils/workosSessionStore';

const router = express.Router();
const outcomes = getCounter('hyperdx.auth.login', {
  description: 'WorkOS browser login outcomes',
});

router.get('/.well-known/oauth-protected-resource/mcp', (_req, res) => {
  if (!config.WORKOS) return res.sendStatus(404);
  return res.json({
    resource: config.WORKOS.resource,
    authorization_servers: [config.WORKOS.issuer],
    bearer_methods_supported: ['header'],
    scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
  });
});

export function safeReturnTo(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    Array.from(value).some(
      character => character.charCodeAt(0) <= 32 || character === '\\',
    )
  )
    return '/search';
  const target = new URL(value, 'https://hyperdx.invalid');
  return target.origin === 'https://hyperdx.invalid'
    ? `${target.pathname}${target.search}${target.hash}`
    : '/search';
}

router.get('/auth/workos', async (req, res) => {
  if (!config.WORKOS || !workos) return res.sendStatus(404);
  try {
    const { url, state, codeVerifier } =
      await workos.userManagement.getAuthorizationUrlWithPKCE({
        provider: 'GoogleOAuth',
        redirectUri: config.WORKOS.redirectUri,
      });
    const login = {
      state,
      codeVerifier,
      expiresAt: Date.now() + 10 * 60 * 1000,
      returnTo: safeReturnTo(req.query.returnTo),
    };
    if (isNewSession(req)) {
      req.session.workosLogin = login;
      await saveNewSession(req);
    } else if (!(await storeWorkosLogin(req, login))) {
      return res.status(400).send('Invalid or expired sign-in attempt');
    }
    return res.set('Cache-Control', 'no-store').redirect(url);
  } catch {
    outcomes.add(1, { outcome: 'init_failed' });
    return res.sendStatus(503);
  }
});

router.get('/auth/workos/callback', async (req, res) => {
  if (!config.WORKOS || !workos) return res.sendStatus(404);
  try {
    const state = req.query.state;
    if (
      typeof state !== 'string' ||
      !/^[A-Za-z0-9_-]+$/.test(state) ||
      typeof req.query.code !== 'string'
    ) {
      outcomes.add(1, { outcome: 'invalid_state' });
      return res.status(400).send('Invalid or expired sign-in attempt');
    }
    const attempt = await consumeWorkosLogin(req, state);
    if (!attempt) {
      outcomes.add(1, { outcome: 'invalid_state' });
      return res.status(400).send('Invalid or expired sign-in attempt');
    }
    const response = await workos.userManagement.authenticateWithCode({
      code: req.query.code,
      codeVerifier: attempt.codeVerifier,
      session: {
        sealSession: true,
        cookiePassword: config.EXPRESS_SESSION_SECRET,
      },
    });
    if (!response.sealedSession)
      throw new WorkosAuthenticationError(401, 'invalid_token');
    // Authenticate the SDK's sealed response and application identity before
    // linking a local account or replacing the browser's session identifier.
    const identity = await authenticateSealedWorkosSession(
      response.sealedSession,
    );
    const user = await resolveWorkosUser(identity.userId);
    if (!(await claimWorkosSession(req)))
      throw new WorkosAuthenticationError(401, 'invalid_token');
    await new Promise<void>((resolve, reject) =>
      req.session.regenerate(error => (error ? reject(error) : resolve())),
    );
    req.session.workosSession = response.sealedSession;
    req.session.workosSessionId = identity.sessionId;
    req.user = user;
    await saveNewSession(req);
    setBusinessContext({
      teamId: user.team.toString(),
      userId: user._id.toString(),
      email: user.email,
    });
    outcomes.add(1, { outcome: 'success' });
    return res
      .set('Cache-Control', 'no-store')
      .redirect(303, `${config.WORKOS.frontendOrigin}${attempt.returnTo}`);
  } catch (error) {
    if (error instanceof WorkosAuthenticationError) {
      outcomes.add(1, { outcome: error.reason });
      return res.redirect(
        303,
        `${config.WORKOS.frontendOrigin}/login?err=${error.status === 503 ? 'workosUnavailable' : 'workosDenied'}`,
      );
    }
    // Provider errors can include credentials and authorization code values.
    outcomes.add(1, { outcome: 'exchange_failed' });
    return res.redirect(
      303,
      `${config.WORKOS.frontendOrigin}/login?err=workosUnavailable`,
    );
  }
});

export async function logoutWorkos(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  if (!config.WORKOS || !workos) return res.sendStatus(404);
  if (req.get('Origin') !== config.WORKOS.frontendOrigin)
    return res.sendStatus(403);
  try {
    const returnTo = `${config.WORKOS.frontendOrigin}/login`;
    const logoutUrl = req.session.workosSessionId
      ? workos.userManagement.getLogoutUrl({
          sessionId: req.session.workosSessionId,
          returnTo,
        })
      : returnTo;
    await new Promise<void>((resolve, reject) =>
      req.session.destroy(error => (error ? reject(error) : resolve())),
    );
    res.clearCookie(config.SESSION_COOKIE_NAME, {
      path: '/',
      ...(!config.IS_CI
        ? { domain: new URL(config.FRONTEND_URL).hostname }
        : {}),
    });
    return res.redirect(303, logoutUrl);
  } catch (error) {
    next(error);
  }
}

export default router;
