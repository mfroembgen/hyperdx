import { vi } from 'vitest';
// Suppress noisy console.debug output (e.g. ClickHouse query logging)
// during test runs. Warnings and errors still appear.
vi.spyOn(console, 'debug').mockImplementation(() => {});
vi.spyOn(console, 'info').mockImplementation(() => {});
