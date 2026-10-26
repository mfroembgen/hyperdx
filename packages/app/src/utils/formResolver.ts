import type { FieldValues, Resolver } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

// These forms validate editable fields while retaining their typed context
// (such as an alert's source discriminator) in a passthrough schema.
export function passthroughFormResolver<T extends FieldValues>(
  schema: z.ZodType<Partial<T>, z.ZodTypeDef, unknown>,
): Resolver<T> {
  const formSchema = z.custom<T>().transform((values, context) => {
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) context.addIssue(issue);
      return z.NEVER;
    }
    return { ...values, ...parsed.data };
  });
  return zodResolver(formSchema);
}
