import React from 'react';
import { useForm } from 'react-hook-form';
import { vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ChartEditorFormState } from '@/components/ChartEditor/types';
import { ChartSaveActions } from '@/components/DBEditTimeChartForm/ChartSaveActions';

function Harness(
  props: Omit<
    React.ComponentProps<typeof ChartSaveActions>,
    'handleSubmit' | 'handleSave'
  > & { handleSave?: (form: ChartEditorFormState) => void },
) {
  const { handleSubmit } = useForm<ChartEditorFormState>();
  return (
    <ChartSaveActions
      handleSubmit={handleSubmit}
      handleSave={props.handleSave ?? vi.fn()}
      {...props}
    />
  );
}

describe('ChartSaveActions', () => {
  it('renders Save when saving is handled', () => {
    renderWithMantine(<Harness onSave={vi.fn()} />);

    expect(screen.getByTestId('chart-save-button')).toHaveTextContent('Save');
  });

  it('saves through the form', async () => {
    const handleSave = vi.fn();
    renderWithMantine(<Harness onSave={vi.fn()} handleSave={handleSave} />);

    await userEvent.click(screen.getByTestId('chart-save-button'));

    expect(handleSave).toHaveBeenCalled();
  });

  it('renders Cancel when closing is handled', async () => {
    const onClose = vi.fn();
    renderWithMantine(<Harness onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalled();
  });

  it('disables Cancel while saving', () => {
    renderWithMantine(<Harness onSave={vi.fn()} onClose={vi.fn()} isSaving />);

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('renders nothing when neither is handled', () => {
    renderWithMantine(<Harness />);

    expect(screen.queryByTestId('chart-save-button')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Cancel' }),
    ).not.toBeInTheDocument();
  });
});
