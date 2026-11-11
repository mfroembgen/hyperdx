import { type Mock, vi } from 'vitest';
import { screen } from '@testing-library/react';

import DateRangeIndicator from '@/components/charts/DateRangeIndicator';
import { DBBarChart } from '@/components/DBBarChart';
import MVOptimizationIndicator from '@/components/MaterializedViews/MVOptimizationIndicator';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useMVOptimizationExplanation } from '@/hooks/useMVOptimizationExplanation';
import { useSource } from '@/source';

vi.mock('@/hooks/useChartConfig', () => ({
  useQueriedChartConfig: vi.fn(),
  getMinGranularitySeconds: vi.fn().mockReturnValue(undefined),
}));

vi.mock('@/hooks/useMVOptimizationExplanation', () => ({
  useMVOptimizationExplanation: vi.fn().mockReturnValue({
    data: undefined,
    isLoading: false,
    isPlaceholderData: false,
  }),
}));

vi.mock('@/source', () => ({
  useSource: vi.fn().mockReturnValue({ data: null }),
  useSingleSeriesNumberFormat: vi.fn().mockReturnValue(undefined),
}));

vi.mock('../MaterializedViews/MVOptimizationIndicator', () => ({
  default: vi.fn(() => null),
}));

vi.mock('../charts/DateRangeIndicator', () => ({ default: vi.fn(() => null) }));

describe('DBBarChart', () => {
  const mockUseQueriedChartConfig = useQueriedChartConfig as Mock;

  const baseTestConfig = {
    dateRange: [new Date(), new Date()] as [Date, Date],
    from: { databaseName: 'test', tableName: 'test' },
    timestampValueExpression: 'timestamp',
    connection: 'test-connection',
    select: '',
    where: '',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockUseQueriedChartConfig.mockReturnValue({
      data: {
        data: [{ test1: 1234, test2: 5678 }],
        meta: [
          { name: 'test1', type: 'UInt64' },
          { name: 'test2', type: 'UInt64' },
        ],
      },
      isLoading: false,
      isError: false,
    });
  });

  it('handles loading state correctly', () => {
    mockUseQueriedChartConfig.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    renderWithMantine(<DBBarChart config={baseTestConfig} />);
    expect(screen.getByText('Loading Chart Data...')).toBeInTheDocument();
  });

  describe('refresh indicator', () => {
    const groupedData = {
      data: [
        { status: 'success', count: 100 },
        { status: 'error', count: 50 },
      ],
      meta: [
        { name: 'status', type: 'String' },
        { name: 'count', type: 'UInt64' },
      ],
    };

    it('pulses while a refetch is showing the previous result', () => {
      mockUseQueriedChartConfig.mockReturnValue({
        data: groupedData,
        isLoading: false,
        isPlaceholderData: true,
        isError: false,
      });

      renderWithMantine(<DBBarChart config={baseTestConfig} />);
      expect(
        screen
          .getByTestId('bar-chart-container')
          .querySelector('.effect-pulse'),
      ).not.toBeNull();
    });

    it('does not pulse once fresh data has loaded', () => {
      mockUseQueriedChartConfig.mockReturnValue({
        data: groupedData,
        isLoading: false,
        isPlaceholderData: false,
        isError: false,
      });

      renderWithMantine(<DBBarChart config={baseTestConfig} />);
      expect(
        screen
          .getByTestId('bar-chart-container')
          .querySelector('.effect-pulse'),
      ).toBeNull();
    });

    it('pulses the empty state while a refetch is running', () => {
      mockUseQueriedChartConfig.mockReturnValue({
        data: { data: [], meta: groupedData.meta },
        isLoading: false,
        isPlaceholderData: true,
        isError: false,
      });

      renderWithMantine(<DBBarChart config={baseTestConfig} />);
      expect(screen.getByText('No data found within time range.')).toHaveClass(
        'effect-pulse',
      );
    });
  });

  it('handles error state correctly', () => {
    mockUseQueriedChartConfig.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Test error'),
    });

    renderWithMantine(<DBBarChart config={baseTestConfig} />);
    expect(screen.getByText(/Error loading chart/)).toBeInTheDocument();
  });

  it('handles empty state correctly', () => {
    mockUseQueriedChartConfig.mockReturnValue({
      data: {
        data: [],
        meta: [
          { name: 'status', type: 'String' },
          { name: 'count', type: 'UInt64' },
        ],
      },
      isLoading: false,
      isError: false,
    });

    renderWithMantine(<DBBarChart config={baseTestConfig} />);
    expect(
      screen.getByText('No data found within time range.'),
    ).toBeInTheDocument();
  });

  it('should render bar chart correctly', () => {
    renderWithMantine(
      <DBBarChart config={baseTestConfig} errorVariant="inline" />,
    );
    expect(screen.getByTestId('bar-chart-container')).toBeInTheDocument();
  });

  it('should render bar chart with grouped data', () => {
    mockUseQueriedChartConfig.mockReturnValue({
      data: {
        data: [
          { status: 'success', count: 100 },
          { status: 'error', count: 50 },
          { status: 'timeout', count: 25 },
        ],
        meta: [
          { name: 'status', type: 'String' },
          { name: 'count', type: 'UInt64' },
        ],
      },
      isLoading: false,
      isError: false,
    });

    renderWithMantine(<DBBarChart config={baseTestConfig} />);
    expect(screen.getByTestId('bar-chart-container')).toBeInTheDocument();
  });

  it('passes the same config to useMVOptimizationExplanation, useQueriedChartConfig, and MVOptimizationIndicator', () => {
    // Mock useSource to return a source so MVOptimizationIndicator is rendered
    vi.mocked(useSource).mockReturnValue({
      data: { id: 'test-source', name: 'Test Source' },
    } as any);

    renderWithMantine(<DBBarChart config={baseTestConfig} />);

    // Get the config that was passed to useMVOptimizationExplanation
    expect(vi.mocked(useMVOptimizationExplanation)).toHaveBeenCalled();
    const mvOptExplanationConfig = vi.mocked(useMVOptimizationExplanation).mock
      .calls[0][0];

    // Get the config that was passed to useQueriedChartConfig
    expect(vi.mocked(useQueriedChartConfig)).toHaveBeenCalled();
    const queriedChartConfig = vi.mocked(useQueriedChartConfig).mock
      .calls[0][0];

    // Get the config that was passed to MVOptimizationIndicator
    expect(vi.mocked(MVOptimizationIndicator)).toHaveBeenCalled();
    const indicatorConfig = vi.mocked(MVOptimizationIndicator).mock.calls[0][0]
      .config;

    // All three should receive the same config object reference
    expect(mvOptExplanationConfig).toBe(queriedChartConfig);
    expect(queriedChartConfig).toBe(indicatorConfig);
    expect(mvOptExplanationConfig).toBe(indicatorConfig);
  });

  it('renders DateRangeIndicator when MV optimization returns a different date range', () => {
    const originalStartDate = new Date('2024-01-01T00:00:30Z');
    const originalEndDate = new Date('2024-01-01T01:30:45Z');
    const alignedStartDate = new Date('2024-01-01T00:00:00Z');
    const alignedEndDate = new Date('2024-01-01T02:00:00Z');

    const config = {
      ...baseTestConfig,
      dateRange: [originalStartDate, originalEndDate] as [Date, Date],
    };

    // Mock useMVOptimizationExplanation to return an optimized config with aligned date range
    vi.mocked(useMVOptimizationExplanation).mockReturnValue({
      data: {
        optimizedConfig: {
          ...config,
          dateRange: [alignedStartDate, alignedEndDate] as [Date, Date],
        },
        explanations: [
          {
            success: true,
            mvConfig: {
              minGranularity: '1 minute',
              tableName: 'metrics_rollup_1m',
            },
          },
        ],
      },
      isLoading: false,
      isPlaceholderData: false,
    } as any);

    renderWithMantine(<DBBarChart config={config} />);

    // Verify DateRangeIndicator was called
    expect(vi.mocked(DateRangeIndicator)).toHaveBeenCalled();

    // Verify it was called with the correct props
    const dateRangeIndicatorCall =
      vi.mocked(DateRangeIndicator).mock.calls[0][0];
    expect(dateRangeIndicatorCall.originalDateRange).toEqual([
      originalStartDate,
      originalEndDate,
    ]);
    expect(dateRangeIndicatorCall.effectiveDateRange).toEqual([
      alignedStartDate,
      alignedEndDate,
    ]);
    expect(dateRangeIndicatorCall.mvGranularity).toBe('1 minute');
  });

  it('does not render DateRangeIndicator when MV optimization has no optimized date range', () => {
    // Mock useMVOptimizationExplanation to return data without an optimized config
    vi.mocked(useMVOptimizationExplanation).mockReturnValue({
      data: {
        optimizedConfig: undefined,
        explanations: [],
      },
      isLoading: false,
      isPlaceholderData: false,
    } as any);

    renderWithMantine(<DBBarChart config={baseTestConfig} />);

    // Verify DateRangeIndicator was not called
    expect(vi.mocked(DateRangeIndicator)).not.toHaveBeenCalled();
  });
});
