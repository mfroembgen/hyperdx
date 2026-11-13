import { type Mock, vi } from 'vitest';
import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';

import { SourcesList } from '@/components/Sources/SourcesList';
import { useConnections } from '@/connection';
import { useSources } from '@/source';

vi.mock('next/router', () => ({
  useRouter: () => ({ push: vi.fn(), query: {}, pathname: '/' }),
}));
vi.mock('@/source', () => ({ useSources: vi.fn() }));
vi.mock('@/connection', () => ({ useConnections: vi.fn() }));
vi.mock('@/config', () => ({ IS_LOCAL_MODE: false }));
// TableSourceForm only renders while editing/creating; stub it so the list test
// does not pull in the full source form.
vi.mock('../Sources/SourceForm', () => ({ TableSourceForm: () => null }));

const asMock = (fn: unknown) => fn as Mock;

const makeSource = (
  id: string,
  name: string,
  overrides: Partial<TSource> = {},
): TSource =>
  ({
    id,
    name,
    kind: SourceKind.Log,
    connection: 'conn-a',
    ...overrides,
  }) as unknown as TSource;

describe('SourcesList section display', () => {
  beforeEach(() => {
    asMock(useConnections).mockReturnValue({
      data: [{ id: 'conn-a', name: 'Default' }],
      isLoading: false,
      refetch: vi.fn(),
    });
  });

  it('shows the section on a sectioned source and nothing on an unsectioned one', () => {
    asMock(useSources).mockReturnValue({
      data: [
        makeSource('a', 'Billing Logs', { section: 'Billing' }),
        makeSource('b', 'Plain Source'),
      ],
      isLoading: false,
      refetch: vi.fn(),
    });
    renderWithMantine(<SourcesList withCard={false} />);

    expect(screen.getByText('Billing Logs')).toBeInTheDocument();
    expect(screen.getByText('Plain Source')).toBeInTheDocument();
    // The section label renders only for the source that has one.
    expect(screen.getAllByText('Billing')).toHaveLength(1);
  });

  it('shows no section labels when no source has a section', () => {
    asMock(useSources).mockReturnValue({
      data: [makeSource('a', 'App'), makeSource('b', 'Host')],
      isLoading: false,
      refetch: vi.fn(),
    });
    renderWithMantine(<SourcesList withCard={false} />);

    expect(screen.getByText('App')).toBeInTheDocument();
    expect(screen.getByText('Host')).toBeInTheDocument();
  });

  it('shows the plural kind label for each source', () => {
    asMock(useSources).mockReturnValue({
      data: [
        makeSource('a', 'A'),
        makeSource('b', 'B', { kind: SourceKind.Trace }),
        makeSource('c', 'C', { kind: SourceKind.Metric }),
        makeSource('d', 'D', { kind: SourceKind.Session }),
        makeSource('e', 'E', { kind: SourceKind.Promql }),
      ],
      isLoading: false,
      refetch: vi.fn(),
    });
    renderWithMantine(<SourcesList withCard={false} />);

    for (const label of [
      'Logs',
      'Traces',
      'OTel metrics',
      'Sessions',
      'PromQL',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
