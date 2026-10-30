import type { Request } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';

import * as config from '@/config';

import { WorkosAuthenticationError } from './workosIdentity';

const humanClaims = z.object({
  sub: z.string().regex(/^user_[A-Za-z0-9]+$/),
  sid: z.string().min(1),
  client_id: z.string().min(1),
  sub_profile: z.literal('user').optional(),
  sub_type: z.undefined().optional(),
});
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

export async function authenticateWorkosMcp(req: Request) {
  const settings = config.WORKOS;
  const token = req.get('Authorization')?.match(/^Bearer (\S+)$/i)?.[1];
  if (!settings || !token)
    throw new WorkosAuthenticationError(401, 'invalid_token');
  try {
    jwks ??= createRemoteJWKSet(new URL(`${settings.issuer}/oauth2/jwks`));
    const { payload } = await jwtVerify(token, jwks, {
      algorithms: ['RS256'],
      issuer: settings.issuer,
      audience: settings.resource,
      requiredClaims: ['iss', 'aud', 'exp', 'iat', 'sub', 'sid', 'client_id'],
    });
    return humanClaims.parse(payload).sub;
  } catch {
    throw new WorkosAuthenticationError(401, 'invalid_token');
  }
}
