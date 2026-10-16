import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { describeError } from '@/lib/rpc/describe-error';
import { pickFieldErrors } from '@/modules/access/lib/field-errors';
import { requirePermission } from '@/modules/auth/permissions';
import { brandsQueryOptions } from '@/modules/brand/queries';
import { ItemForm } from '@/modules/item/components/item-form';
import { useSaveItem } from '@/modules/item/queries';
import type { ItemFieldErrors, ItemFormOutput } from '@/modules/item/schemas';
import { ITEM_FIELD_KEYS, toItemFormDefaults, toSaveItemInput } from '@/modules/item/schemas';

export const Route = createFileRoute('/_app/item/new')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'item', 'edit'),
  loader: ({ context }) => context.queryClient.ensureQueryData(brandsQueryOptions()),
  component: NewItemPage,
});

function NewItemPage() {
  const navigate = useNavigate();
  const { data: brands } = useSuspenseQuery(brandsQueryOptions());
  const saveItem = useSaveItem();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ItemFieldErrors>({});

  async function handleSubmit(values: ItemFormOutput) {
    setSubmitError(null);
    setFieldErrors({});
    try {
      const saved = await saveItem.mutateAsync(toSaveItemInput(values));
      toast.success('Item disimpan');
      await navigate({ to: '/item/$itemId', params: { itemId: saved.id } });
    } catch (error) {
      const picked = pickFieldErrors(error, ITEM_FIELD_KEYS);
      if (Object.keys(picked).length > 0) setFieldErrors(picked);
      else setSubmitError(describeError(error));
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <ItemForm
        title="Tambah item"
        brands={brands}
        defaultValues={toItemFormDefaults()}
        submitError={submitError}
        fieldErrors={fieldErrors}
        onSubmit={handleSubmit}
        onCancel={() => void navigate({ to: '/item' })}
      />
    </div>
  );
}
