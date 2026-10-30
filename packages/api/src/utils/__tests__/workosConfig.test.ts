import { parseWorkosConfig } from '@/utils/workosConfig';

const enabled = {
  WORKOS_API_KEY: 'fixture-api-key',
  WORKOS_CLIENT_ID: 'client_example',
  WORKOS_AUTHKIT_DOMAIN: 'https://identity.example.com',
  WORKOS_TEAM_ID: '507f1f77bcf86cd799439011',
  EXPRESS_SESSION_SECRET: 'fixture-shared-secret-at-least-32-characters',
};

describe('WorkOS startup boundary', () => {
  it('preserves legacy authentication only when WorkOS is entirely unset', () => {
    expect(parseWorkosConfig({}, false, '')).toBeUndefined();
    expect(
      parseWorkosConfig(
        { WORKOS_OPERATIONS_CLIENT_ID: 'separate-app-alias' },
        false,
        '',
      ),
    ).toBeUndefined();
    expect(
      parseWorkosConfig({ WORKOS_ENABLED: 'false' }, false, ''),
    ).toBeUndefined();
    expect(() =>
      parseWorkosConfig(
        { WORKOS_API_KEY: 'partial' },
        false,
        'https://app.example.com',
      ),
    ).toThrow(/WorkOS/);
  });

  it('fails closed when explicitly enabled but secrets are missing, or explicitly disabled with credentials', () => {
    expect(() =>
      parseWorkosConfig(
        { WORKOS_ENABLED: 'true' },
        false,
        'https://app.example.com',
      ),
    ).toThrow(/WorkOS/);
    expect(() =>
      parseWorkosConfig(
        { ...enabled, WORKOS_ENABLED: 'false' },
        false,
        'https://app.example.com',
      ),
    ).toThrow(/WorkOS/);
    expect(() =>
      parseWorkosConfig({ WORKOS_ENABLED: 'yes' }, false, ''),
    ).toThrow(/WorkOS/);
    expect(
      parseWorkosConfig(
        { ...enabled, WORKOS_ENABLED: 'true' },
        false,
        'https://app.example.com',
      )?.clientId,
    ).toBe('client_example');
  });

  it('pins web and MCP to distinct fixed issuers and public resources', () => {
    expect(
      parseWorkosConfig(
        {
          ...enabled,
          WORKOS_SESSION_ISSUER:
            'https://api.workos.com/user_management/client_environment',
        },
        false,
        'https://app.example.com',
      ),
    ).toMatchObject({
      issuer: 'https://identity.example.com',
      sessionIssuer:
        'https://api.workos.com/user_management/client_environment',
      resource: 'https://app.example.com/api/mcp',
      metadataUrl:
        'https://app.example.com/api/.well-known/oauth-protected-resource/mcp',
      redirectUri: 'https://app.example.com/api/auth/workos/callback',
    });
  });

  it('disables automatic membership by default and normalizes one exact domain', () => {
    expect(
      parseWorkosConfig(enabled, false, 'https://app.example.com'),
    ).not.toHaveProperty('autoJoinDomain', expect.anything());
    expect(
      parseWorkosConfig(
        { ...enabled, WORKOS_AUTO_JOIN_DOMAIN: 'EXAMPLE.COM' },
        false,
        'https://app.example.com',
      )?.autoJoinDomain,
    ).toBe('example.com');
  });

  it('keeps a preconfigured domain policy inert without WorkOS credentials', () => {
    expect(
      parseWorkosConfig({ WORKOS_AUTO_JOIN_DOMAIN: 'example.com' }, false, ''),
    ).toBeUndefined();
    expect(
      parseWorkosConfig(
        { WORKOS_ENABLED: 'false', WORKOS_AUTO_JOIN_DOMAIN: 'example.com' },
        false,
        '',
      ),
    ).toBeUndefined();
  });

  it('treats an empty automatic join domain as off when WorkOS is enabled', () => {
    expect(
      parseWorkosConfig(
        { ...enabled, WORKOS_ENABLED: 'true', WORKOS_AUTO_JOIN_DOMAIN: '' },
        false,
        'https://app.example.com',
      )?.autoJoinDomain,
    ).toBeUndefined();
  });

  it.each([
    { WORKOS_AUTHKIT_DOMAIN: 'http://identity.example.com' },
    { WORKOS_AUTHKIT_DOMAIN: 'https://identity.example.com/other' },
    { WORKOS_AUTHKIT_DOMAIN: 'https://user:secret@identity.example.com' },
    { WORKOS_SESSION_ISSUER: 'https://identity.example.com/?code=secret' },
    { WORKOS_TEAM_ID: 'not-a-team' },
    { EXPRESS_SESSION_SECRET: 'short' },
    { WORKOS_AUTO_JOIN_DOMAIN: ' example.com' },
    { WORKOS_AUTO_JOIN_DOMAIN: '@example.com' },
    { WORKOS_AUTO_JOIN_DOMAIN: '*.example.com' },
    { WORKOS_AUTO_JOIN_DOMAIN: 'https://example.com' },
    { WORKOS_AUTO_JOIN_DOMAIN: 'example.com,other.example.com' },
    { WORKOS_AUTO_JOIN_DOMAIN: 'example.com.' },
    { WORKOS_AUTO_JOIN_DOMAIN: '-example.com' },
  ])('rejects unsafe configuration %j', invalid => {
    expect(() =>
      parseWorkosConfig(
        { ...enabled, ...invalid },
        false,
        'https://app.example.com',
      ),
    ).toThrow(/WorkOS/);
  });

  it('rejects no-auth mode, nonloopback HTTP, and a process-generated sealing secret', () => {
    expect(() =>
      parseWorkosConfig(enabled, true, 'https://app.example.com'),
    ).toThrow(/WorkOS/);
    expect(() =>
      parseWorkosConfig(enabled, false, 'http://app.example.com'),
    ).toThrow(/WorkOS/);
    expect(() =>
      parseWorkosConfig(
        { ...enabled, NODE_ENV: 'production' },
        false,
        'http://localhost:3000',
      ),
    ).toThrow(/WorkOS/);
    expect(
      parseWorkosConfig(enabled, false, 'http://localhost:3000')?.resource,
    ).toBe('http://localhost:3000/api/mcp');
  });
});
