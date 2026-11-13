import { useCallback } from 'react';
import type { FieldPath, FieldValues } from 'react-hook-form';
import { useController, UseControllerProps } from 'react-hook-form';
import { Select, SelectProps } from '@mantine/core';

enum SelectControlledSpecialValues {
  CreateNewValue = '_create_new_value',
  EditValue = '_edit_value',
}

export type SelectControlledProps<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = SelectProps &
  UseControllerProps<TFieldValues, TName> & {
    onCreate?: () => void;
    onEdit?: () => void;
    allowDeselect?: boolean;
  };

/** Whether `value` is one of a select's options, flat or grouped. */
export function isValueInSelectData(
  data: SelectProps['data'],
  value: unknown,
): boolean {
  return (
    data?.some(d => {
      if (typeof d === 'string') return d === value;
      if ('value' in d) return d.value === value;
      if ('items' in d) {
        return d.items.some(item =>
          typeof item === 'string' ? item === value : item.value === value,
        );
      }
      return false;
    }) ?? false
  );
}

export default function SelectControlled<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>(props: SelectControlledProps<TFieldValues, TName>) {
  const {
    field: {
      value: fieldValue,
      onChange: fieldOnChange,
      onBlur: fieldOnBlur,
      name: fieldName,
      ref: fieldRef,
    },
    fieldState,
  } = useController(props);
  const { onCreate, onEdit, allowDeselect = true, ...restProps } = props;

  // Mantine does not clear the select if the value is removed from data
  // after it was previously present (ex. data was deleted)
  const selected = isValueInSelectData(props.data, fieldValue);

  const onChange = useCallback(
    (value: string | null) => {
      if (
        value === SelectControlledSpecialValues.CreateNewValue &&
        onCreate != null
      ) {
        onCreate();
      } else if (
        value === SelectControlledSpecialValues.EditValue &&
        onEdit != null
      ) {
        onEdit();
      } else if (value !== null || allowDeselect) {
        fieldOnChange(value);
      }
    },
    [fieldOnChange, onCreate, onEdit, allowDeselect],
  );

  return (
    <Select
      {...restProps}
      error={fieldState.error?.message}
      value={selected ? fieldValue : null}
      onChange={onChange}
      onBlur={fieldOnBlur}
      name={fieldName}
      ref={fieldRef}
    />
  );
}
