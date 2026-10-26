import { type Mock, vi } from 'vitest';
import { DisplayType, PromqlReducer } from '@hyperdx/common-utils/dist/types';
import { screen, within } from '@testing-library/react';

import DateRangeIndicator from '@/components/charts/DateRangeIndicator';
import { DBPieChart } from '@/components/DBPieChart';
import MVOptimizationIndicator from '@/components/MaterializedViews/MVOptimizationIndicator';
import {
  getMinGranularitySeconds,
  useQueriedChartConfig,
} from '@/hooks/useChartConfig';
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

describe('DBPieChart', () => {
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

    renderWithMantine(<DBPieChart config={baseTestConfig} />);
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

      renderWithMantine(<DBPieChart config={baseTestConfig} />);
      expect(screen.getByTestId('pie-chart-container')).toHaveClass(
        'effect-pulse',
      );
      // The legend shows values too, so it pulses along with the pie
      expect(
        screen.getByTestId('pie-chart-legend').closest('.effect-pulse'),
      ).not.toBeNull();
    });

    it('does not pulse once fresh data has loaded', () => {
      mockUseQueriedChartConfig.mockReturnValue({
        data: groupedData,
        isLoading: false,
        isPlaceholderData: false,
        isError: false,
      });

      renderWithMantine(<DBPieChart config={baseTestConfig} />);
      expect(screen.getByTestId('pie-chart-container')).not.toHaveClass(
        'effect-pulse',
      );
    });

    it('pulses the empty state while a refetch is running', () => {
      mockUseQueriedChartConfig.mockReturnValue({
        data: { data: [], meta: groupedData.meta },
        isLoading: false,
        isPlaceholderData: true,
        isError: false,
      });

      renderWithMantine(<DBPieChart config={baseTestConfig} />);
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

    renderWithMantine(<DBPieChart config={baseTestConfig} />);
    expect(screen.getByText(/Error loading chart/)).toBeInTheDocument();
  });

  it('should render pie chart correctly', () => {
    renderWithMantine(
      <DBPieChart config={baseTestConfig} errorVariant="inline" />,
    );
    expect(screen.getByTestId('pie-chart-container')).toBeInTheDocument();
  });

  it('should render pie chart legend with labels', () => {
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

    renderWithMantine(<DBPieChart config={baseTestConfig} />);
    const legend = screen.getByTestId('pie-chart-legend');
    expect(legend).toBeInTheDocument();
    expect(screen.getByText('success')).toBeInTheDocument();
    expect(screen.getByText('error')).toBeInTheDocument();
    expect(screen.getByText('timeout')).toBeInTheDocument();
  });

  it('should render scrollable legend with many groups', () => {
    const manyGroups = Array.from({ length: 30 }, (_, i) => ({
      status: `group-${i}`,
      count: 100 - i,
    }));

    mockUseQueriedChartConfig.mockReturnValue({
      data: {
        data: manyGroups,
        meta: [
          { name: 'status', type: 'String' },
          { name: 'count', type: 'UInt64' },
        ],
      },
      isLoading: false,
      isError: false,
    });

    renderWithMantine(<DBPieChart config={baseTestConfig} />);
    const legend = screen.getByTestId('pie-chart-legend');
    expect(legend).toBeInTheDocument();
    expect(legend).toHaveStyle({ alignSelf: 'stretch' });
    expect(screen.getByText('group-0')).toBeInTheDocument();
    expect(screen.getByText('group-29')).toBeInTheDocument();
  });

  it('passes the same config to useMVOptimizationExplanation, useQueriedChartConfig, and MVOptimizationIndicator', () => {
    // Mock useSource to return a source so MVOptimizationIndicator is rendered
    vi.mocked(useSource).mockReturnValue({
      data: { id: 'test-source', name: 'Test Source' },
    } as any);

    renderWithMantine(<DBPieChart config={baseTestConfig} />);

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

    renderWithMantine(<DBPieChart config={config} />);

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

    renderWithMantine(<DBPieChart config={baseTestConfig} />);

    // Verify DateRangeIndicator was not called
    expect(vi.mocked(DateRangeIndicator)).not.toHaveBeenCalled();
  });

  describe('PromQL', () => {
    const promqlConfig = {
      configType: 'promql' as const,
      displayType: DisplayType.Pie,
      connection: 'test-connection',
      source: 'source-promql',
      promqlExpression: [{ expression: 'up' }, { expression: 'down' }],
      dateRange: [
        new Date('2025-11-26T00:00:14.076Z'),
        new Date('2025-11-26T01:00:14.076Z'),
      ] as [Date, Date],
    };

    it('queries the first expression, reduced to one value per series', () => {
      renderWithMantine(<DBPieChart config={promqlConfig} />);

      const queriedConfig = mockUseQueriedChartConfig.mock.calls[0][0];
      expect(queriedConfig.promqlExpression).toEqual([
        { expression: 'up', reducer: PromqlReducer.LastNotNull },
      ]);
      expect(queriedConfig.granularity).toBe('1 minute');
    });

    it("floors an auto granularity at the source's minimum", () => {
      vi.mocked(getMinGranularitySeconds).mockReturnValueOnce(300);

      renderWithMantine(<DBPieChart config={promqlConfig} />);

      const queriedConfig = mockUseQueriedChartConfig.mock.calls[0][0];
      expect(queriedConfig.granularity).toBe('5 minute');
      expect(queriedConfig.minGranularitySeconds).toBe(300);
    });

    it('keeps the same query key when only the reducer changes', () => {
      renderWithMantine(<DBPieChart config={promqlConfig} />);
      renderWithMantine(
        <DBPieChart
          config={{
            ...promqlConfig,
            promqlExpression: [
              { expression: 'up', reducer: PromqlReducer.Max },
            ],
          }}
        />,
      );

      const [first, second] = mockUseQueriedChartConfig.mock.calls.map(
        ([, options]) => options.queryKey,
      );
      expect(second).toEqual(first);
    });

    const mockThreeSeries = () =>
      mockUseQueriedChartConfig.mockReturnValue({
        data: {
          data: [
            { series_name: 'cart', value: 2 },
            { series_name: 'checkout', value: 7 },
            { series_name: 'ad', value: 4 },
          ],
          meta: [
            { name: 'series_name', type: 'String' },
            { name: 'value', type: 'Float64' },
          ],
        },
        isLoading: false,
        isError: false,
      });

    const legendLabels = () =>
      within(screen.getByTestId('pie-chart-legend'))
        .getAllByTitle(/.+/)
        .map(el => el.getAttribute('title'));

    it('draws a slice per series, largest first', () => {
      mockThreeSeries();
      renderWithMantine(<DBPieChart config={promqlConfig} />);
      expect(legendLabels()).toEqual(['checkout', 'ad', 'cart']);
    });

    it('keeps only the largest seriesLimit slices', () => {
      mockThreeSeries();
      renderWithMantine(
        <DBPieChart config={{ ...promqlConfig, seriesLimit: 2 }} />,
      );
      expect(legendLabels()).toEqual(['checkout', 'ad']);
    });

    it('treats a seriesLimit of 0 as unlimited', () => {
      mockThreeSeries();
      renderWithMantine(
        <DBPieChart config={{ ...promqlConfig, seriesLimit: 0 }} />,
      );
      expect(legendLabels()).toEqual(['checkout', 'ad', 'cart']);
    });
  });
});
