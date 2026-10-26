import { vi } from 'vitest';

import { createRunQueryKeyBinding } from '@/components/SQLEditor/SQLEditor';

vi.mock('@/hooks/useMetadata', () => ({
  useMultipleAllFields: vi.fn().mockReturnValue({ data: [] }),
}));

describe('SQLEditor', () => {
  it('creates a Cmd/Ctrl+Enter key binding that submits the query', () => {
    const onSubmit = vi.fn();
    const binding = createRunQueryKeyBinding(onSubmit);

    expect(binding.key).toBe('Mod-Enter');
    expect(binding.run()).toBe(true);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
