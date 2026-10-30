import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { discoverOAuthServerInfo } from '@modelcontextprotocol/sdk/client/auth.js';
import { z } from 'zod';

const repoRoot = path.resolve(__dirname, '../../../../..');
const configUrl = pathToFileURL(
  path.join(repoRoot, 'packages/app/next.config.mjs'),
);
const rewritesSchema = z.array(
  z.object({ source: z.string(), destination: z.string() }),
);

function loadRewrites(clickhouseBuild = false) {
  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const { default: config } = await import(${JSON.stringify(configUrl.href)});
console.log(JSON.stringify(await config.rewrites?.() ?? []));`,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 10000,
      env: {
        ...process.env,
        NEXT_PUBLIC_CLICKHOUSE_BUILD: clickhouseBuild ? 'true' : '',
        NEXT_PUBLIC_HYPERDX_BASE_PATH: '',
      },
    },
  );
  const parsed: unknown = JSON.parse(output.trim().split('\n').at(-1) ?? '');
  return rewritesSchema.parse(parsed);
}

const resource = 'https://app.example.com/api/mcp';
const issuer = 'https://identity.example.com';

describe('WorkOS URL-only OAuth discovery', () => {
  it.each([
    '/.well-known/oauth-protected-resource/api/mcp',
    '/.well-known/oauth-protected-resource',
  ])('discovers the exact issuer and CIMD through %s', async discoveryPath => {
    const rewrites = loadRewrites();
    const requests: string[] = [];
    const result = await discoverOAuthServerInfo(resource, {
      fetchFn: async (input, init = {}) => {
        expect(init.method ?? 'GET').toBe('GET');
        const requested = new URL(input);
        requests.push(requested.href);
        if (requested.origin === new URL(resource).origin) {
          const rewrite = rewrites.find(
            rule => rule.source === requested.pathname,
          );
          if (
            requested.pathname === discoveryPath &&
            rewrite?.destination ===
              '/api/.well-known/oauth-protected-resource/mcp'
          ) {
            return Response.json({
              resource,
              authorization_servers: [issuer],
            });
          }
        }
        if (
          requested.href === `${issuer}/.well-known/oauth-authorization-server`
        ) {
          return Response.json({
            issuer,
            authorization_endpoint: `${issuer}/oauth2/authorize`,
            token_endpoint: `${issuer}/oauth2/token`,
            response_types_supported: ['code'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
            code_challenge_methods_supported: ['S256'],
            token_endpoint_auth_methods_supported: ['none'],
            client_id_metadata_document_supported: true,
          });
        }
        return new Response(null, { status: 404 });
      },
    });

    expect(result.resourceMetadata?.resource).toBe(resource);
    expect(result.authorizationServerUrl).toBe(issuer);
    expect(result.authorizationServerMetadata?.issuer).toBe(issuer);
    expect(
      result.authorizationServerMetadata?.client_id_metadata_document_supported,
    ).toBe(true);
    expect(requests).toContain(`${new URL(resource).origin}${discoveryPath}`);
    expect(requests.at(-1)).toBe(
      `${issuer}/.well-known/oauth-authorization-server`,
    );
  });

  it('keeps the static ClickHouse export free of OAuth server rewrites', () => {
    expect(loadRewrites(true)).toEqual([]);
  });
});
