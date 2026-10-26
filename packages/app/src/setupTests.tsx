import React from 'react';
/* Polyfills for browser APIs in Node.js test environment */
import { TextDecoder, TextEncoder } from 'util';
import { ClickUIProvider } from '@clickhouse/click-ui';
import { MantineProvider, Popover } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { render } from '@testing-library/react';
import structuredClone from '@ungap/structured-clone';

import '@testing-library/jest-dom/vitest';
global.TextEncoder = TextEncoder as any;
global.TextDecoder = TextDecoder as any;

// jsdom does not implement the Font Loading API used by Mantine autosizing.
if (!document.fonts) {
  Object.defineProperty(document, 'fonts', {
    value: Object.assign(new EventTarget(), {
      ready: Promise.resolve(),
      check: () => true,
      load: () => Promise.resolve([]),
    }),
  });
}

/* Mocks for mantine */
class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = ResizeObserver;
// jsdom has no scrollIntoView, and Mantine's Combobox calls it on the active
// option when a dropdown opens — from a setTimeout, so the resulting TypeError
// surfaces as an unrelated async test failure.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined;
}
Object.defineProperty(window, 'matchMedia', {
  value: () => ({
    matches: false,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  }),
});

// jsdom has no layout: preserve real portals, but do not hide popovers based
// on zero-sized anchor rectangles.
global.TestProviders = ({ children }: { children: React.ReactNode }) => (
  <MantineProvider
    theme={{
      components: {
        Popover: Popover.extend({ defaultProps: { hideDetached: false } }),
      },
    }}
  >
    <ClickUIProvider theme="dark" persistTheme={false}>
      <Notifications />
      {children}
    </ClickUIProvider>
  </MantineProvider>
);

global.renderWithMantine = (ui: React.ReactElement) => {
  return render(<TestProviders>{ui}</TestProviders>);
};

if (!globalThis.structuredClone) {
  // @ts-expect-error this is a correct polyfill
  globalThis.structuredClone = structuredClone;
}

declare global {
  function renderWithMantine(ui: React.ReactElement): ReturnType<typeof render>;
  // `var`, not `const`, so the global assignment above passes type-check
  var TestProviders: React.FC<{ children: React.ReactNode }>;
}
