import { type MockInstance, vi } from 'vitest';

// uPlot builds an Intl.NumberFormat from navigator.language at import time.
// Chromium on LANG=C.UTF-8 hosts reports 'en-US@posix', which Intl rejects;
// our uplot patch makes uPlot fall back to 'en-US' instead of throwing.
describe('uplot locale patch', () => {
  let languageSpy: MockInstance;

  afterEach(() => {
    languageSpy.mockRestore();
  });

  it('imports and formats numbers when navigator.language is not a valid BCP 47 tag', async () => {
    languageSpy = vi
      .spyOn(window.navigator, 'language', 'get')
      .mockReturnValue('en-US@posix');

    expect(() => new Intl.NumberFormat('en-US@posix')).toThrow(RangeError);

    vi.resetModules();
    const { default: uPlot } = await import('uplot');
    expect(uPlot.fmtNum(1234.5)).toBe('1,234.5');
  });
});
