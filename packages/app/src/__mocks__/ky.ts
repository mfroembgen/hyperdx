import { vi } from 'vitest';
// HTTP client fixture for API hook tests.
const ky = vi.fn(() => ({
  get: vi.fn(() => Promise.resolve({})),
  post: vi.fn(() => Promise.resolve({})),
  put: vi.fn(() => Promise.resolve({})),
  patch: vi.fn(() => Promise.resolve({})),
  delete: vi.fn(() => Promise.resolve({})),
  head: vi.fn(() => Promise.resolve({})),
}));

// Mock the create and extend methods to return the ky mock itself
// @ts-expect-error this exists
ky.create = vi.fn(() => ky);
// @ts-expect-error this exists
ky.extend = vi.fn(() => ky);

module.exports = ky;
