import { vi } from 'vitest';
describe('config', () => {
  describe('FRONTEND_REDIRECT_BASE', () => {
    const ORIGINAL_INLINE = process.env.HDX_PREVIEW_INLINE_API;
    const ORIGINAL_FRONTEND_URL = process.env.FRONTEND_URL;

    afterEach(() => {
      // Restore the original env vars so other tests in the suite see the
      // values they expect.
      if (ORIGINAL_INLINE === undefined) {
        delete process.env.HDX_PREVIEW_INLINE_API;
      } else {
        process.env.HDX_PREVIEW_INLINE_API = ORIGINAL_INLINE;
      }
      if (ORIGINAL_FRONTEND_URL === undefined) {
        delete process.env.FRONTEND_URL;
      } else {
        process.env.FRONTEND_URL = ORIGINAL_FRONTEND_URL;
      }
      vi.resetModules();
    });

    it('falls back to FRONTEND_URL when HDX_PREVIEW_INLINE_API is not set', async () => {
      delete process.env.HDX_PREVIEW_INLINE_API;
      process.env.FRONTEND_URL = 'https://hyperdx.io';

      {
        vi.resetModules();

        const config = await import('@/config.js');
        expect(config.IS_INLINE_API).toBe(false);
        expect(config.FRONTEND_REDIRECT_BASE).toBe('https://hyperdx.io');
        expect(config.FRONTEND_REDIRECT_BASE).toBe(config.FRONTEND_URL);
      }
    });

    it('falls back to FRONTEND_URL when HDX_PREVIEW_INLINE_API is "false"', async () => {
      process.env.HDX_PREVIEW_INLINE_API = 'false';
      process.env.FRONTEND_URL = 'https://hyperdx.io';

      {
        vi.resetModules();

        const config = await import('@/config.js');
        expect(config.IS_INLINE_API).toBe(false);
        expect(config.FRONTEND_REDIRECT_BASE).toBe('https://hyperdx.io');
      }
    });

    it('emits an empty string (relative redirects) when HDX_PREVIEW_INLINE_API is "true"', async () => {
      process.env.HDX_PREVIEW_INLINE_API = 'true';
      process.env.FRONTEND_URL = 'https://private.hyperdx.io';

      {
        vi.resetModules();

        const config = await import('@/config.js');
        expect(config.IS_INLINE_API).toBe(true);
        expect(config.FRONTEND_REDIRECT_BASE).toBe('');
        // Sanity check: FRONTEND_URL itself is unchanged so emails/SAML
        // callbacks still have the absolute origin available when needed.
        expect(config.FRONTEND_URL).toBe('https://private.hyperdx.io');
      }
    });
  });

  describe('EXTERNAL_API_RATE_LIMIT_MAX', () => {
    const ORIGINAL = process.env.EXTERNAL_API_RATE_LIMIT_MAX;

    afterEach(() => {
      if (ORIGINAL === undefined) {
        delete process.env.EXTERNAL_API_RATE_LIMIT_MAX;
      } else {
        process.env.EXTERNAL_API_RATE_LIMIT_MAX = ORIGINAL;
      }
      vi.resetModules();
    });

    it('defaults to 100 when unset', async () => {
      delete process.env.EXTERNAL_API_RATE_LIMIT_MAX;

      {
        vi.resetModules();

        const config = await import('@/config.js');
        expect(config.EXTERNAL_API_RATE_LIMIT_MAX).toBe(100);
      }
    });

    it('accepts a valid positive integer', async () => {
      process.env.EXTERNAL_API_RATE_LIMIT_MAX = '1000';

      {
        vi.resetModules();

        const config = await import('@/config.js');
        expect(config.EXTERNAL_API_RATE_LIMIT_MAX).toBe(1000);
      }
    });

    it('accepts exponential notation', async () => {
      process.env.EXTERNAL_API_RATE_LIMIT_MAX = '1e3';

      {
        vi.resetModules();

        const config = await import('@/config.js');
        expect(config.EXTERNAL_API_RATE_LIMIT_MAX).toBe(1000);
      }
    });

    it.each([
      ['garbage string (NaN)', 'abc'],
      ['zero (express-rate-limit v6 treats 0 as unlimited)', '0'],
      ['negative', '-5'],
      ['trailing garbage', '100/min'],
      ['empty string', ''],
      ['fractional (would block every request at max=0.5)', '0.5'],
      ['Infinity (would disable the limit entirely)', 'Infinity'],
    ])(
      'falls back to the default of 100 and does not silently disable the limit: %s (%p)',
      async (_desc, raw) => {
        process.env.EXTERNAL_API_RATE_LIMIT_MAX = raw;

        {
          vi.resetModules();

          const config = await import('@/config.js');
          expect(config.EXTERNAL_API_RATE_LIMIT_MAX).toBe(100);
        }
      },
    );
  });

  describe('EXTERNAL_API_SEARCH_MAX_RESULTS', () => {
    const ORIGINAL = process.env.EXTERNAL_API_SEARCH_MAX_RESULTS;

    afterEach(() => {
      if (ORIGINAL === undefined) {
        delete process.env.EXTERNAL_API_SEARCH_MAX_RESULTS;
      } else {
        process.env.EXTERNAL_API_SEARCH_MAX_RESULTS = ORIGINAL;
      }
      vi.resetModules();
    });

    const loadMaxResults = async () => {
      let loaded!: typeof import('@/config');
      {
        vi.resetModules();
        loaded = await vi.importActual<typeof import('@/config')>('@/config');
      }
      return loaded.EXTERNAL_API_SEARCH_MAX_RESULTS;
    };

    it('defaults to 2000 when unset', async () => {
      delete process.env.EXTERNAL_API_SEARCH_MAX_RESULTS;
      expect(await loadMaxResults()).toBe(2000);
    });

    it('accepts a valid positive integer', async () => {
      process.env.EXTERNAL_API_SEARCH_MAX_RESULTS = '10000';
      expect(await loadMaxResults()).toBe(10_000);
    });

    it.each(['abc', '0', '50', '-5', '100rows', '', '0.5', 'Infinity'])(
      'falls back to 2000 for %p',
      async raw => {
        process.env.EXTERNAL_API_SEARCH_MAX_RESULTS = raw;
        expect(await loadMaxResults()).toBe(2000);
      },
    );
  });

  describe('EXPRESS_SESSION_SECRET', () => {
    const ORIGINAL_SECRET = process.env.EXPRESS_SESSION_SECRET;
    const ORIGINAL_LOCAL_APP_MODE = process.env.IS_LOCAL_APP_MODE;

    beforeEach(() => {
      delete process.env.IS_LOCAL_APP_MODE;
    });

    afterEach(() => {
      if (ORIGINAL_SECRET === undefined) {
        delete process.env.EXPRESS_SESSION_SECRET;
      } else {
        process.env.EXPRESS_SESSION_SECRET = ORIGINAL_SECRET;
      }
      if (ORIGINAL_LOCAL_APP_MODE === undefined) {
        delete process.env.IS_LOCAL_APP_MODE;
      } else {
        process.env.IS_LOCAL_APP_MODE = ORIGINAL_LOCAL_APP_MODE;
      }
      vi.resetModules();
    });

    // The `vi` object's isolateModules returns `vi` itself rather than the
    // callback's value, so the module has to be captured from inside it.
    const loadConfig = async () => {
      let loaded!: typeof import('@/config');
      {
        vi.resetModules();
        loaded = await vi.importActual<typeof import('@/config')>('@/config');
      }
      return loaded;
    };

    it('uses a configured secret verbatim', async () => {
      process.env.EXPRESS_SESSION_SECRET = 'a-deployment-specific-secret';

      const config = await loadConfig();
      expect(config.EXPRESS_SESSION_SECRET).toBe(
        'a-deployment-specific-secret',
      );
      expect(config.IS_EXPRESS_SESSION_SECRET_GENERATED).toBe(false);
    });

    it('preserves a configured secret verbatim', async () => {
      process.env.EXPRESS_SESSION_SECRET = '  verbatim secret 👋  ';
      const config = await loadConfig();
      expect(config.EXPRESS_SESSION_SECRET).toBe('  verbatim secret 👋  ');
      expect(config.IS_EXPRESS_SESSION_SECRET_GENERATED).toBe(false);
    });

    it('generates a secret when unset, empty, or publicly known', async () => {
      for (const value of [undefined, '', 'hyperdx is cool 👋']) {
        if (value === undefined) {
          delete process.env.EXPRESS_SESSION_SECRET;
        } else {
          process.env.EXPRESS_SESSION_SECRET = value;
        }

        const config = await loadConfig();
        expect(config.EXPRESS_SESSION_SECRET).toMatch(/^[0-9a-f]{64}$/);
        expect(config.IS_EXPRESS_SESSION_SECRET_GENERATED).toBe(true);
      }
    });

    it('keeps the public demo secret only without authentication', async () => {
      process.env.IS_LOCAL_APP_MODE = 'DANGEROUSLY_is_local_app_mode💀';
      process.env.EXPRESS_SESSION_SECRET = 'hyperdx is cool 👋';

      const config = await loadConfig();
      expect(config.EXPRESS_SESSION_SECRET).toBe('hyperdx is cool 👋');
      expect(config.IS_EXPRESS_SESSION_SECRET_GENERATED).toBe(false);
    });

    it('generates a different secret on each load', async () => {
      delete process.env.EXPRESS_SESSION_SECRET;

      expect(await (await loadConfig()).EXPRESS_SESSION_SECRET).not.toBe(
        await (
          await loadConfig()
        ).EXPRESS_SESSION_SECRET,
      );
    });
  });
});
