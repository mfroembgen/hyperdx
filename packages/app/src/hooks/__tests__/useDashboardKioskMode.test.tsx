import { type Mock, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const mockSetKioskMode = vi.fn();

vi.mock('nuqs', async () => {
  const actualModule0 = await vi.importActual<typeof import('nuqs')>('nuqs');

  const actual = actualModule0;
  return {
    ...actual,

    useQueryState: () => [false, mockSetKioskMode],
  };
});

vi.mock('@mantine/hooks', async () => {
  const actualModule1 =
    await vi.importActual<typeof import('@mantine/hooks')>('@mantine/hooks');

  const actual = actualModule1;
  return {
    ...actual,
    useHotkeys: vi.fn(),
  };
});

import { useDashboardKioskMode } from '@/hooks/useDashboardKioskMode';

describe('useDashboardKioskMode', () => {
  let fullscreenElement: Element | null;
  let requestFullscreen: Mock<(...args: []) => Promise<void>>;
  let exitFullscreen: Mock<(...args: []) => Promise<void>>;

  beforeEach(() => {
    fullscreenElement = null;
    requestFullscreen = vi.fn().mockResolvedValue(undefined);
    exitFullscreen = vi.fn().mockResolvedValue(undefined);
    mockSetKioskMode.mockReset();

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    });
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    });
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: exitFullscreen,
    });
  });

  it('changes kiosk URL state without controlling browser fullscreen', () => {
    const { result } = renderHook(() => useDashboardKioskMode());

    act(() => result.current.enterKioskMode());
    expect(mockSetKioskMode).toHaveBeenCalledWith(true);
    expect(requestFullscreen).not.toHaveBeenCalled();

    fullscreenElement = document.documentElement;
    act(() => result.current.exitKioskMode());
    expect(mockSetKioskMode).toHaveBeenLastCalledWith(null);
    expect(exitFullscreen).not.toHaveBeenCalled();
  });

  it('keeps kiosk mode active when the user changes fullscreen state', () => {
    const { result } = renderHook(() => useDashboardKioskMode());

    act(() => result.current.enterKioskMode());
    mockSetKioskMode.mockClear();
    fullscreenElement = document.body;
    act(() => document.dispatchEvent(new Event('fullscreenchange')));
    fullscreenElement = null;
    act(() => document.dispatchEvent(new Event('fullscreenchange')));

    expect(mockSetKioskMode).not.toHaveBeenCalled();
  });
});
