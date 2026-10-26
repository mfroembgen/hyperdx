import { useMemo } from 'react';
import type { FieldValues } from 'react-hook-form';
import { UseControllerProps } from 'react-hook-form';
import { IconServer } from '@tabler/icons-react';

import SelectControlled from '@/components/SelectControlled';
import { useConnections } from '@/connection';

export function ConnectionSelectControlled<TFieldValues extends FieldValues>({
  size,
  ...props
}: { size?: string } & UseControllerProps<TFieldValues>) {
  const { data } = useConnections();

  const values = useMemo(
    () =>
      data?.map(d => ({
        value: d.id,
        label: d.name,
      })),
    [data],
  );

  return (
    <SelectControlled
      {...props}
      allowDeselect={false}
      data={values}
      // disabled={isDatabasesLoading}
      comboboxProps={{ withinPortal: true }}
      searchable
      placeholder="Connection"
      leftSection={<IconServer size={16} />}
      maxDropdownHeight={280}
      size={size}
    />
  );
}
