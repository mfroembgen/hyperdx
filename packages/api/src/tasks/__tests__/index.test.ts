import { type MockInstance, vi } from 'vitest';

const mockShutdown = vi.fn<() => Promise<void>>();
const mockCronStop = vi.fn();
const mockCronFrom = vi.fn((_options: unknown) => ({ stop: mockCronStop }));
const mockConfig = {
  CODE_VERSION: 'test',
  RUN_SCHEDULED_TASKS_EXTERNALLY: false,
};

vi.mock('@clickhouse/clickstack-node', () => ({
  shutdown: () => mockShutdown(),
}));
vi.mock('cron', () => ({
  CronJob: { from: (options: unknown) => mockCronFrom(options) },
}));
vi.mock('@/config', () => mockConfig);
vi.mock('@/utils/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/tasks/checkAlerts', () => ({
  __esModule: true,
  default: vi.fn(),
}));
vi.mock('@/tasks/provisionDashboards', () => ({
  __esModule: true,
  default: vi.fn(),
}));

const flushPromises = () => new Promise(resolve => setImmediate(resolve));

describe('tasks entry point', () => {
  const originalArgv = process.argv;
  // Jest's process copy forwards exitCode to the real process.
  const originalExitCode = process.exitCode;
  let processOn: MockInstance;
  let processExit: MockInstance;
  let finishShutdown: () => void;

  const loadTasks = async () => {
    process.argv = ['node', 'tasks', 'ping-pong'];
    vi.resetModules();
    await import('@/tasks/index.js');
  };

  const handlerFor = (event: string) => {
    const call = processOn.mock.calls.find(([name]) => name === event);
    if (!call) {
      throw new Error(`No ${event} handler registered`);
    }
    return call[1];
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockShutdown.mockReturnValue(
      new Promise(resolve => {
        finishShutdown = resolve;
      }),
    );
    processOn = vi.spyOn(process, 'on').mockReturnValue(process);
    processExit = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
  });

  it('stops the cron job and shuts down once, exiting with the first code', async () => {
    mockConfig.RUN_SCHEDULED_TASKS_EXTERNALLY = false;
    await loadTasks();
    expect(mockCronFrom).toHaveBeenCalledTimes(1);

    handlerFor('uncaughtException')(new Error('first'));
    handlerFor('unhandledRejection')(new Error('second'));
    handlerFor('uncaughtException')(new Error('third'));

    expect(mockCronStop).toHaveBeenCalledTimes(1);
    expect(mockShutdown).toHaveBeenCalledTimes(1);
    expect(mockCronStop.mock.invocationCallOrder[0]).toBeLessThan(
      mockShutdown.mock.invocationCallOrder[0],
    );
    expect(process.exitCode).toBe(1);
    expect(processExit).not.toHaveBeenCalled();

    finishShutdown();
    await flushPromises();

    expect(processExit).toHaveBeenCalledTimes(1);
    expect(processExit).toHaveBeenCalledWith(1);
  });

  it('keeps exit code 0 when a rejection arrives during the one-shot shutdown', async () => {
    mockConfig.RUN_SCHEDULED_TASKS_EXTERNALLY = true;
    await loadTasks();
    await flushPromises();
    expect(mockCronFrom).not.toHaveBeenCalled();
    expect(mockShutdown).toHaveBeenCalledTimes(1);

    handlerFor('unhandledRejection')(new Error('late'));
    expect(mockShutdown).toHaveBeenCalledTimes(1);

    finishShutdown();
    await flushPromises();

    expect(processExit).toHaveBeenCalledTimes(1);
    expect(processExit).toHaveBeenCalledWith(0);
  });
});
