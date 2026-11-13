import { vi } from 'vitest';
import type * as ClickStackBrowser from '@clickhouse/clickstack-browser';

// Unit tests never start RUM, so each export behaves as the SDK does before
// init (aliased in vitest.config.mts).
export const init: typeof ClickStackBrowser.init = vi.fn();
export const getSessionId: typeof ClickStackBrowser.getSessionId = vi.fn(
  () => null,
);
export const startNewSession: typeof ClickStackBrowser.startNewSession =
  vi.fn();
export const pauseReplay: typeof ClickStackBrowser.pauseReplay = vi.fn();
export const resumeReplay: typeof ClickStackBrowser.resumeReplay = vi.fn();
export const shutdown: typeof ClickStackBrowser.shutdown = vi.fn(() =>
  Promise.resolve(),
);
export const recordException: typeof ClickStackBrowser.recordException =
  vi.fn();
export const setUser: typeof ClickStackBrowser.setUser = vi.fn();
export const setAttributes: typeof ClickStackBrowser.setAttributes = vi.fn();
