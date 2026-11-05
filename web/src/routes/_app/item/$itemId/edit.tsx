import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { describeError } from '@/lib/api/describe-error';
import { pickFieldErrors } from '@/modules/access/lib/field-errors';
import { requirePermission } from '@/modules/auth/permissions';
import { brandsQueryOptions } from '@/modules/brand/queries';
import { ItemForm } from '@/modules/item/components/item-form';
import { itemQueryOptions, useSaveItem } from '@/modules/item/queries';
import type { ItemFieldErrors, ItemFormOutput } from '@/modules/item/schemas';
import { ITEM_FIELD_KEYS, toItemFormDefaults, toSaveItemInput } from '@/modules/item/schemas';

export const Route = createFileRoute('/_app/item/$itemId/edit')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'item', 'edit'),
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(itemQueryOptions(params.itemId)),
      context.queryClient.ensureQueryData(brandsQueryOptions()),
    ]),
  component: EditItemPage,
});

function EditItemPage() {
  const { itemId } = Route.useParams();
  const navigate = useNavigate();
  const { data: item } = useSuspenseQuery(itemQueryOptions(itemId));
  const { data: brands } = useSuspenseQuery(brandsQueryOptions());
  const saveItem = useSaveItem();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ItemFieldErrors>({});

  async function handleSubmit(values: ItemFormOutput) {
    setSubmitError(null);
    setFieldErrors({});
    try {
      await saveItem.mutateAsync(toSaveItemInput(values, item.id, item.updatedAt));
      toast.success('Item disimpan');
      await navigate({ to: '/item/$itemId', params: { itemId: item.id } });
    } catch (error) {
      const picked = pickFieldErrors(error, ITEM_FIELD_KEYS);
      if (Object.keys(picked).length > 0) setFieldErrors(picked);
      else setSubmitError(describeError(error));
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <ItemForm
        title={`Ubah item: ${item.brand} ${item.model}`}
        key={item.updatedAt}
        brands={brands}
        defaultValues={toItemFormDefaults(item)}
        submitError={submitError}
        fieldErrors={fieldErrors}
        onSubmit={handleSubmit}
        onCancel={() => void navigate({ to: '/item/$itemId', params: { itemId: item.id } })}
      />
    </div>
  );
}
