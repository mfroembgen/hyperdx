import { vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import {
  COMPACT_MAX_WIDTH,
  useCompactViewport,
} from '@/components/CompactViewport/useCompactViewport';
import { useWindowSize } from '@/utils';

vi.mock('@/utils', () => ({
  useWindowSize: vi.fn(() => ({ width: undefined, height: undefined })),
}));

const useWindowSizeMock = vi.mocked(useWindowSize);

describe('useCompactViewport', () => {
  it('treats an unknown width as desktop', () => {
    useWindowSizeMock.mockReturnValue({
      width: undefined,
      height: undefined,
    });
    const { result } = renderHook(() => useCompactViewport());
    expect(result.current).toBe(false);
  });

  it('is compact below the cutoff', () => {
    useWindowSizeMock.mockReturnValue({
      width: COMPACT_MAX_WIDTH - 1,
      height: 800,
    });
    const { result } = renderHook(() => useCompactViewport());
    expect(result.current).toBe(true);
  });

  it('is not compact at the cutoff', () => {
    useWindowSizeMock.mockReturnValue({
      width: COMPACT_MAX_WIDTH,
      height: 800,
    });
    const { result } = renderHook(() => useCompactViewport());
    expect(result.current).toBe(false);
  });
});
