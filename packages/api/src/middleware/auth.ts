import { withQueryAttribution } from '@hyperdx/common-utils/dist/clickhouse/node';
import { Connection } from '@hyperdx/common-utils/dist/types';
import type { NextFunction, Request, Response } from 'express';
import { serializeError } from 'serialize-error';

import * as config from '@/config';
import { LOCAL_APP_TEAM } from '@/controllers/team';
import { findUserByAccessKey } from '@/controllers/user';
import type { UserDocument } from '@/models/user';
import {
  getActiveTraceId,
  getCounter,
  getStaticFeatureFlags,
  setBusinessContext,
} from '@/utils/instrumentation';
import logger from '@/utils/logger';
import {
  resolveWorkosUser,
  WorkosAuthenticationError,
} from '@/utils/workosIdentity';
import { authenticateWorkosMcp } from '@/utils/workosMcp';
import { authenticateWorkosSession } from '@/utils/workosSession';

declare global {
  // Express type augmentation requires `namespace` + interface merging; there is
  // no non-namespace / non-empty-interface equivalent for extending these types.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User extends UserDocument {}
    interface Request {
      _hdx_connection?: Connection;
    }
  }
}

declare module 'express-session' {
  interface Session {
    messages: string[]; // Set by passport
    passport: { user: string }; // Set by passport
  }
}

export function redirectToDashboard(req: Request, res: Response) {
  // Use 303 See Other so browsers always follow the redirect with GET, even
  // when the original request was a POST (e.g. /login/password). Without an
  // explicit status, Express sends 302 and some browsers/proxies preserve the
  // POST method, which produces a 405 on Next.js pages that only accept GET.
  // The destination is the app root so client-side routing in LandingPage
  // decides where to send the user (/search if logged in, /login otherwise).
  // This avoids hard-coding /search here, which fails when the post-login
  // host differs from the configured FRONTEND_URL (e.g. Vercel previews).
  if (req?.user?.team) {
    return res.redirect(303, `${config.FRONTEND_REDIRECT_BASE}/`);
  } else {
    logger.error(
      { userId: req?.user?._id },
      'Password login for user failed, user or team not found',
    );
    res.redirect(303, `${config.FRONTEND_REDIRECT_BASE}/login?err=unknown`);
  }
}

export function handleAuthError(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction,
) {
  logger.debug({ authErr: serializeError(err) }, 'Auth error');
  if (res.headersSent) {
    return next(err);
  }

  // Get the latest auth error message
  const lastMessage = req.session.messages?.at(-1);
  logger.debug(`Auth error last message: ${lastMessage}`);

  const returnErr =
    lastMessage === 'Password or username is incorrect'
      ? 'authFail'
      : lastMessage ===
          'Authentication method password is not allowed by your team admin.'
        ? 'passwordAuthNotAllowed'
        : 'unknown';

  // 303 forces GET on the redirected request even when the original request
  // was a POST (e.g. /login/password failure path).
  res.redirect(303, `${config.FRONTEND_REDIRECT_BASE}/login?err=${returnErr}`);
}

export function getAccessKeyFromRequest(req: Request): string | undefined {
  return req.headers.authorization?.split('Bearer ')[1];
}

export async function validateUserAccessKey(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const key = getAccessKeyFromRequest(req);
  if (!key) {
    return res.sendStatus(401);
  }

  const user = await findUserByAccessKey(key);
  if (!user?.team) {
    return res.sendStatus(401);
  }

  req.user = user;

  // Attribute access-key authenticated requests (external API v2 + MCP HTTP)
  // with team/user context so their traces are searchable during incidents.
  setBusinessContext({
    teamId: user.team?.toString(),
    userId: user._id?.toString(),
    email: user.email,
    ...getStaticFeatureFlags(),
  });

  nextWithQueryAttribution(req, next);
}

/**
 * Continue the request with its route recorded on any ClickHouse queries it
 * makes. Here because every authenticated route passes through this point.
 */
function nextWithQueryAttribution(req: Request, next: NextFunction): void {
  withQueryAttribution(
    {
      surface: 'api',
      // Mount path, not the full URL, to keep request ids out of the log.
      label: req.baseUrl || undefined,
      trace: getActiveTraceId(),
    },
    () => next(),
  );
}

export function isUserAuthenticated(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (config.WORKOS) {
    return authenticateWorkos(req, res, next, 'ui');
  }
  if (config.IS_LOCAL_APP_MODE) {
    // If local app mode is enabled, skip authentication
    logger.warn('Skipping authentication in local app mode');
    req.user = {
      // @ts-expect-error local app mode uses a synthetic string id, not an ObjectId
      _id: '_local_user_',
      email: 'local-user@hyperdx.io',
      team: LOCAL_APP_TEAM._id,
    };
    setBusinessContext({
      teamId: LOCAL_APP_TEAM._id.toString(),
      userId: '_local_user_',
      'hyperdx.local_mode': true,
      ...getStaticFeatureFlags(),
    });
    return nextWithQueryAttribution(req, next);
  }

  if (req.isAuthenticated() && req.user?.team) {
    // Attach incident-remediation context to the trace and active span.
    setBusinessContext({
      teamId: req.user?.team?.toString(),
      userId: req.user?._id?.toString(),
      email: req.user?.email,
      ...getStaticFeatureFlags(),
    });

    return nextWithQueryAttribution(req, next);
  }
  res.sendStatus(401);
}

export function validateMcpUser(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  return config.WORKOS
    ? authenticateWorkos(req, res, next, 'mcp')
    : validateUserAccessKey(req, res, next);
}

async function authenticateWorkos(
  req: Request,
  res: Response,
  next: NextFunction,
  surface: 'ui' | 'mcp',
) {
  const counter = getCounter('hyperdx.auth.requests', {
    description: 'WorkOS authentication outcomes by surface and bounded reason',
  });
  try {
    const subject =
      surface === 'mcp'
        ? await authenticateWorkosMcp(req)
        : (await authenticateWorkosSession(req)).userId;
    const user = await resolveWorkosUser(subject);
    req.user = user;
    setBusinessContext({
      teamId: user.team.toString(),
      userId: user._id.toString(),
      email: user.email,
      'hyperdx.auth.method': 'workos',
      ...getStaticFeatureFlags(),
    });
    counter.add(1, { surface, outcome: 'success' });
    nextWithQueryAttribution(req, next);
  } catch (err) {
    if (err instanceof WorkosAuthenticationError) {
      counter.add(1, { surface, outcome: 'denied', reason: err.reason });
      if (surface === 'mcp' && err.status === 401 && config.WORKOS) {
        res.set(
          'WWW-Authenticate',
          `Bearer resource_metadata="${config.WORKOS.metadataUrl}", error="invalid_token"`,
        );
      }
      // UI authentication failures return to the explicit sign-in page.
      const status =
        surface === 'ui' && err.reason === 'unmapped_identity'
          ? 401
          : err.status;
      return res.sendStatus(status);
    }
    next(err);
  }
}

export function getNonNullUserWithTeam(req: Request) {
  const user = req.user;

  if (!user) {
    throw new Error('User is not authenticated');
  }

  if (!user.team) {
    throw new Error(`User ${user._id} is not associated with a team`);
  }

  return { teamId: user.team, userId: user._id, email: user.email };
}
