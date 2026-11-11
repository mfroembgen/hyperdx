import { NextApiRequest, NextApiResponse } from 'next';
import { createProxyMiddleware } from 'http-proxy-middleware';

import { preserveNodeInterface } from '@/utils/inlineApiNodeCompat';

const DEFAULT_SERVER_URL = `http://127.0.0.1:${process.env.HYPERDX_API_PORT}`;

export const config = {
  api: {
    externalResolver: true,
    bodyParser: false,
  },
};

// In Vercel preview deployments we inline the entire Express API into the
// serverless function so a single deployment serves both the app and
// the API. In all other environments (Docker fullstack, standalone production)
// we proxy `/api/*` to a separately-deployed API service as before.
const isInlineApi = process.env.HDX_PREVIEW_INLINE_API === 'true';

export default async (req: NextApiRequest, res: NextApiResponse) => {
  if (isInlineApi) {
    preserveNodeInterface(req, res);
    // Keep the API lazy; Vite removes this branch from non-preview builds.
    const inlineApi = await import('@hyperdx/api/build/serverless');
    const handler = inlineApi.default ?? inlineApi;
    return handler(req, res);
  }

  const proxy = createProxyMiddleware({
    changeOrigin: true,
    // logger: console, // DEBUG
    pathRewrite: { '^/api': '' },
    target: process.env.SERVER_URL || DEFAULT_SERVER_URL,
    autoRewrite: true,
    on: {
      proxyRes(proxyRes) {
        // Vinext streams this response through a Web Response. Let its HTTP
        // server frame the body instead of forwarding the upstream framing.
        delete proxyRes.headers['transfer-encoding'];
        delete proxyRes.headers['content-length'];
      },
    },
    // ...(IS_DEV && {
    //   logger: console,
    // }),
  });
  return proxy(req, res, error => {
    if (error) {
      console.error(error);
      res.status(500).send('API proxy error');
      return;
    }
    res.status(404).send('Not found');
  });
};
