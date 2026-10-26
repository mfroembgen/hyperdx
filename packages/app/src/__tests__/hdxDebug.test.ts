import { vi } from 'vitest';
// hdxDebug reads config constants at module-load, so each config permutation is
// exercised by resetting modules and re-requiring with a fresh @/config mock.

const baseConfig = {
  APP_VERSION: '9.9.9',
  INSTANCE_LABEL: '',
  INSTANCE_TITLE_SUFFIX: '',
  BASE_PATH: '',
  IS_ADHOC_FILTERS_ENABLED: false,
  IS_ALERT_DETAILS_ENABLED: false,
  IS_CLICKHOUSE_BUILD: false,
  IS_LLM_COST_ENABLED: false,
  IS_DEV: false,
  IS_LOCAL_MODE: false,
  IS_OSS: true as unknown,
  IS_PROMQL_ENABLED: false,
};

async function loadHdxDebug(configOverrides: Partial<typeof baseConfig> = {}) {
  vi.resetModules();
  vi.doMock('@/config', () => ({ ...baseConfig, ...configOverrides }));
  vi.doMock('@hyperdx/browser', () => ({
    __esModule: true,
    default: { getSessionId: () => undefined },
  }));
  vi.doMock('@/utils/clipboard', () => ({
    copyTextToClipboard: vi.fn().mockResolvedValue(true),
  }));
  return await vi.importActual<typeof import('@/hdxDebug')>('@/hdxDebug');
}

// Render the report through the public surface: install window.hdx, then read
// what report() produces. Keeps buildReport/safeUrl internal.
function reportFor(
  mod: typeof import('@/hdxDebug'),
  identity?: Parameters<typeof mod.setHdxIdentity>[0],
): string {
  if (identity) mod.setHdxIdentity(identity);
  mod.installHdxDebug();
  if (!window.hdx) throw new Error('window.hdx was not installed');
  return window.hdx.report();
}

afterEach(async () => {
  delete window.hdx;
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('fetchServerVersion', () => {
  const realFetch = global.fetch;

  // A minimal fetch stub — fetchServerVersion only reads res.ok and res.json().
  function setFetch(fn: (...args: any[]) => Promise<any>) {
    global.fetch = fn as typeof global.fetch;
  }

  afterEach(async () => {
    global.fetch = realFetch;
  });

  it('returns undefined in local mode without fetching', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve({ ok: true }));
    setFetch(fetchSpy);
    const { fetchServerVersion } = await loadHdxDebug({ IS_LOCAL_MODE: true });

    await expect(fetchServerVersion()).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns undefined on a non-ok response', async () => {
    setFetch(() => Promise.resolve({ ok: false }));
    const { fetchServerVersion } = await loadHdxDebug();

    await expect(fetchServerVersion()).resolves.toBeUndefined();
  });

  it('returns undefined when the body is not JSON', async () => {
    setFetch(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.reject(new Error('not json')),
      }),
    );
    const { fetchServerVersion } = await loadHdxDebug();

    await expect(fetchServerVersion()).resolves.toBeUndefined();
  });

  it('returns undefined when fetch throws', async () => {
    setFetch(() => Promise.reject(new Error('network')));
    const { fetchServerVersion } = await loadHdxDebug();

    await expect(fetchServerVersion()).resolves.toBeUndefined();
  });

  it('returns undefined when the payload lacks a version', async () => {
    setFetch(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: 'OK' }),
      }),
    );
    const { fetchServerVersion } = await loadHdxDebug();

    await expect(fetchServerVersion()).resolves.toBeUndefined();
  });

  it('returns the parsed version on success and feeds it into the report', async () => {
    setFetch(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ version: '2.0.1-sha0724861' }),
      }),
    );
    const mod = await loadHdxDebug();

    await expect(mod.fetchServerVersion()).resolves.toBe('2.0.1-sha0724861');
    expect(reportFor(mod)).toContain('backend:  2.0.1-sha0724861');
  });
});

describe('report mode line', () => {
  it('reports oss when IS_OSS is true', async () => {
    expect(reportFor(await loadHdxDebug({ IS_OSS: true }))).toContain(
      'mode:     oss',
    );
  });

  it('reports cloud when NEXT_PUBLIC_IS_OSS resolves to the string "false"', async () => {
    // Mirrors config.ts's IS_OSS precedence quirk, where a disabled deployment
    // surfaces the truthy string "false".
    expect(reportFor(await loadHdxDebug({ IS_OSS: 'false' }))).toContain(
      'mode:     cloud',
    );
  });

  it('reports local when in local mode', async () => {
    expect(reportFor(await loadHdxDebug({ IS_LOCAL_MODE: true }))).toContain(
      'mode:     local',
    );
  });

  it('appends the clickstack suffix for ClickHouse builds', async () => {
    expect(
      reportFor(await loadHdxDebug({ IS_CLICKHOUSE_BUILD: true })),
    ).toContain('mode:     oss (clickstack)');
  });
});

describe('report identity + features', () => {
  it('omits user/team lines until identity is set', async () => {
    const report = reportFor(await loadHdxDebug());
    expect(report).not.toContain('user:');
    expect(report).not.toContain('team:');
  });

  it('includes user/team lines once identity is set', async () => {
    const report = reportFor(await loadHdxDebug(), {
      userId: 'u1',
      teamId: 't1',
    });
    expect(report).toContain('user:     u1');
    expect(report).toContain('team:     t1');
  });

  it('lists only enabled features and dynamic toggles', async () => {
    const report = reportFor(await loadHdxDebug({ IS_PROMQL_ENABLED: true }), {
      features: { aiAssistant: true, usageStats: false },
    });
    expect(report).toContain('features: promql, aiAssistant');
    expect(report).not.toContain('usageStats');
  });

  it('reports "none" when no feature is enabled', async () => {
    expect(reportFor(await loadHdxDebug())).toContain('features: none');
  });
});

describe('report url line', () => {
  afterEach(async () => {
    window.history.replaceState(null, '', '/');
  });

  // jsdom won't let us redefine window.location, but history.replaceState
  // updates location.pathname/search.
  function setLocation(pathname: string, search: string) {
    window.history.replaceState(null, '', `${pathname}${search}`);
  }

  it('reports the pathname without the query string', async () => {
    setLocation('/search', '?source=abc&from=1');
    expect(reportFor(await loadHdxDebug())).toContain('url:      /search');
  });

  it('drops query params, so tokens never reach the report', async () => {
    setLocation('/join-team', '?token=super-secret');
    const report = reportFor(await loadHdxDebug());
    expect(report).toContain('url:      /join-team');
    expect(report).not.toContain('super-secret');
    expect(report).not.toContain('token');
  });
});
