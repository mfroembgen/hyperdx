import { WorkOS } from '@workos-inc/node';

import * as config from '@/config';

export const workos = config.WORKOS
  ? new WorkOS(config.WORKOS.apiKey, {
      clientId: config.WORKOS.clientId,
      issuer: config.WORKOS.sessionIssuer,
      timeout: 10000,
      maxRetries: 1,
    })
  : undefined;
