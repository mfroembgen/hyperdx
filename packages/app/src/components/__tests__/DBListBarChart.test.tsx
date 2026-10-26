import React from 'react';
import { type Mock, vi } from 'vitest';
import { screen } from '@testing-library/react';

import DateRangeIndicator from '@/components/charts/DateRangeIndicator';
import DBListBarChart from '@/components/DBListBarChart';
import MVOptimizationIndicator from '@/components/MaterializedViews/MVOptimizationIndicator';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useMVOptimizationExplanation } from '@/hooks/useMVOptimizationExplanation';
import { useSource } from '@/source';

// Mock dependencies
vi.mock('@/hooks/useChartConfig', () => ({
  useQueriedChartConfig: vi.fn(),
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
  useChartNumberFormats: vi
    .fn()
    .mockReturnValue({ formatByColumn: new Map(), chartFormat: undefined }),
}));

vi.mock('../MaterializedViews/MVOptimizationIndicator', () => ({
  default: vi.fn(() => null),
}));

vi.mock('../charts/DateRangeIndicator', () => ({ default: vi.fn(() => null) }));

describe('DBListBarChart', () => {
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
      data: { data: [{ group: 'test', value: 100 }] },
      isLoading: false,
      isError: false,
    });
  });

  it('passes the same config to useMVOptimizationExplanation, useQueriedChartConfig, and MVOptimizationIndicator', () => {
    // Mock useSource to return a source so MVOptimizationIndicator is rendered
    vi.mocked(useSource).mockReturnValue({
      data: { id: 'test-source', name: 'Test Source' },
    } as any);

    renderWithMantine(
      <DBListBarChart
        config={baseTestConfig}
        valueColumn="value"
        groupColumn="group"
      />,
    );

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

    renderWithMantine(
      <DBListBarChart
        config={config}
        valueColumn="value"
        groupColumn="group"
      />,
    );

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

    renderWithMantine(
      <DBListBarChart
        config={baseTestConfig}
        valueColumn="value"
        groupColumn="group"
      />,
    );

    // Verify DateRangeIndicator was not called
    expect(vi.mocked(DateRangeIndicator)).not.toHaveBeenCalled();
  });

  describe('refresh', () => {
    const renderChart = () =>
      renderWithMantine(
        <DBListBarChart
          config={baseTestConfig}
          valueColumn="value"
          groupColumn="group"
        />,
      );

    it('pulses the previous bars while a refresh loads', () => {
      mockUseQueriedChartConfig.mockReturnValue({
        data: { data: [{ group: 'checkout', value: 100 }] },
        isLoading: false,
        isPlaceholderData: true,
        isError: false,
      });

      renderChart();

      expect(
        screen.getByText('checkout').closest('.effect-pulse'),
      ).toBeInTheDocument();
    });

    it('does not pulse once fresh bars load', () => {
      mockUseQueriedChartConfig.mockReturnValue({
        data: { data: [{ group: 'checkout', value: 100 }] },
        isLoading: false,
        isPlaceholderData: false,
        isError: false,
      });

      renderChart();

      expect(screen.getByText('checkout').closest('.effect-pulse')).toBeNull();
    });

    it('pulses the empty state while a refresh loads', () => {
      mockUseQueriedChartConfig.mockReturnValue({
        data: { data: [] },
        isLoading: false,
        isPlaceholderData: true,
        isError: false,
      });

      renderChart();

      expect(screen.getByText('No data found within time range.')).toHaveClass(
        'effect-pulse',
      );
    });

    it('does not pulse a fresh empty result', () => {
      mockUseQueriedChartConfig.mockReturnValue({
        data: { data: [] },
        isLoading: false,
        isPlaceholderData: false,
        isError: false,
      });

      renderChart();

      expect(
        screen.getByText('No data found within time range.'),
      ).not.toHaveClass('effect-pulse');
    });
  });
});
