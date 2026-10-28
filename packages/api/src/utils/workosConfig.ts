import { isPersistableUserId } from '@hyperdx/common-utils/dist/types';
import { z } from 'zod';

const environmentSchema = z.object({
  WORKOS_API_KEY: z.string().min(1),
  WORKOS_CLIENT_ID: z.string().regex(/^client_[A-Za-z0-9]+$/),
  WORKOS_AUTHKIT_DOMAIN: z.string().url(),
  WORKOS_TEAM_ID: z.string().refine(isPersistableUserId),
  WORKOS_SESSION_ISSUER: z.string().url().optional(),
  EXPRESS_SESSION_SECRET: z.string().min(32),
});

export function parseWorkosConfig(
  env: NodeJS.ProcessEnv,
  isLocalAppMode: boolean,
  frontendUrl: string,
) {
  const keys = [
    'WORKOS_API_KEY',
    'WORKOS_CLIENT_ID',
    'WORKOS_AUTHKIT_DOMAIN',
    'WORKOS_TEAM_ID',
    'WORKOS_SESSION_ISSUER',
  ];
  const configured = keys.some(key => env[key] !== undefined);
  if (
    env.WORKOS_ENABLED !== undefined &&
    !['true', 'false'].includes(env.WORKOS_ENABLED)
  ) {
    throw new Error('WorkOS ENABLED must be true or false');
  }
  if (env.WORKOS_ENABLED === 'false' && configured) {
    throw new Error(
      'WorkOS cannot be disabled while its authentication configuration is present',
    );
  }
  if (!configured && env.WORKOS_ENABLED !== 'true') return;
  const parsed = environmentSchema.safeParse(env);
  if (!parsed.success || isLocalAppMode) {
    throw new Error(
      'WorkOS requires complete configuration, a shared session secret of at least 32 characters, and authentication enabled',
    );
  }
  const { WORKOS_CLIENT_ID: clientId } = parsed.data;
  const issuer = new URL(parsed.data.WORKOS_AUTHKIT_DOMAIN);
  const frontend = new URL(frontendUrl);
  const sessionIssuer = new URL(
    parsed.data.WORKOS_SESSION_ISSUER ??
      `https://api.workos.com/user_management/${clientId}`,
  );
  const unsafe = (url: URL) =>
    !!(url.username || url.password || url.search || url.hash);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(
    frontend.hostname,
  );
  if (
    issuer.protocol !== 'https:' ||
    issuer.pathname !== '/' ||
    unsafe(issuer) ||
    sessionIssuer.protocol !== 'https:' ||
    unsafe(sessionIssuer) ||
    unsafe(frontend) ||
    frontend.pathname !== '/' ||
    (frontend.protocol !== 'https:' &&
      !(
        env.NODE_ENV !== 'production' &&
        loopback &&
        frontend.protocol === 'http:'
      ))
  ) {
    throw new Error(
      'WorkOS requires fixed trusted HTTPS URLs (HTTP loopback is allowed outside production)',
    );
  }
  return {
    apiKey: parsed.data.WORKOS_API_KEY,
    clientId,
    issuer: issuer.origin,
    sessionIssuer: parsed.data.WORKOS_SESSION_ISSUER ?? sessionIssuer.href,
    teamId: parsed.data.WORKOS_TEAM_ID.toLowerCase(),
    frontendOrigin: frontend.origin,
    redirectUri: `${frontend.origin}/api/auth/workos/callback`,
    resource: `${frontend.origin}/api/mcp`,
    metadataUrl: `${frontend.origin}/api/.well-known/oauth-protected-resource/mcp`,
  };
}

export type WorkosConfig = NonNullable<ReturnType<typeof parseWorkosConfig>>;
