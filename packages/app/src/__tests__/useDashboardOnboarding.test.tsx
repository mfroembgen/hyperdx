import { vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// Local (temporary URL-state) dashboards never hit the backend, so setDashboard
// must record the 'dashboard' onboarding task itself once a tile exists. These
// tests exercise that branch in isolation.

const mutate = vi.fn();
let localDashboardValue: unknown = null;
const setLocalDashboard = vi.fn((v: unknown) => {
  localDashboardValue = v;
});
let meData: {
  id: string;
  onboardingData: { completedTasks: string[]; isDismissed: boolean };
} | null = null;

// A real 24-hex ObjectId: recording is gated on the user id being persistable.
const REAL_USER_ID = 'a1b2c3d4e5f6a1b2c3d4e5f6';

vi.mock('../config', () => ({ IS_LOCAL_MODE: false }));
vi.mock('@mantine/notifications', () => ({
  notifications: { show: vi.fn() },
}));
vi.mock('nuqs', () => ({
  parseAsJson: () => ({}),
  useQueryState: () => [localDashboardValue, setLocalDashboard],
}));
vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ mutate: vi.fn() }),
  useQuery: () => ({ data: undefined, isFetching: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('../api', () => ({
  __esModule: true,
  default: { useMe: () => ({ data: meData }) },
  hdxServer: vi.fn(),
  useMarkOnboardingTaskComplete: () => vi.fn(),
  useInvalidateTags: () => vi.fn(),
  useCompleteOnboardingTask: () => ({ mutate }),
}));

import { useDashboard } from '@/dashboard';

const tile = {
  id: 't1',
  x: 0,
  y: 0,
  w: 1,
  h: 1,
  config: { name: 'c', source: 's', displayType: 'line', select: [] },
};

function makeDashboard(tiles: unknown[]) {
  return { id: '', name: 'Temp', tiles, tags: [] } as never;
}

describe('useDashboard local-dashboard onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localDashboardValue = null;
    meData = {
      id: REAL_USER_ID,
      onboardingData: { completedTasks: [], isDismissed: false },
    };
  });

  it('records the dashboard task when a tile is added to a temporary dashboard', () => {
    const { result } = renderHook(() => useDashboard({}));
    act(() => {
      result.current.setDashboard(makeDashboard([tile]));
    });
    expect(mutate).toHaveBeenCalledWith('dashboard');
  });

  it('does not record for an empty temporary dashboard', () => {
    const { result } = renderHook(() => useDashboard({}));
    act(() => {
      result.current.setDashboard(makeDashboard([]));
    });
    expect(mutate).not.toHaveBeenCalled();
  });

  it('does not re-record once the task is already completed', () => {
    meData = {
      id: REAL_USER_ID,
      onboardingData: { completedTasks: ['dashboard'], isDismissed: false },
    };
    const { result } = renderHook(() => useDashboard({}));
    act(() => {
      result.current.setDashboard(makeDashboard([tile]));
    });
    expect(mutate).not.toHaveBeenCalled();
  });

  it('does not record when the user id is not a real ObjectId (noauth image)', () => {
    meData = {
      id: '_local_user_',
      onboardingData: { completedTasks: [], isDismissed: false },
    };
    const { result } = renderHook(() => useDashboard({}));
    act(() => {
      result.current.setDashboard(makeDashboard([tile]));
    });
    expect(mutate).not.toHaveBeenCalled();
  });
});
