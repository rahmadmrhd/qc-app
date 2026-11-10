import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { describeError } from '@/lib/api/describe-error';
import { itemFormLinkAccess } from '@/lib/link-access';
import { pickFieldErrors } from '@/modules/access/lib/field-errors';
import { businessUnitOptionsQueryOptions, useSaveBusinessUnit } from '@/modules/access/queries';
import { buIdsWithLevelFor, can, requirePermission } from '@/modules/auth/permissions';
import { meQueryOptions } from '@/modules/auth/queries';
import { useMe } from '@/modules/auth/use-me';
import { brandsQueryOptions, useSaveBrand } from '@/modules/brand/queries';
import { ItemForm } from '@/modules/item/components/item-form';
import { mergeBusinessUnits } from '@/modules/item/lib/default-business-units';
import { assertCanEditItem } from '@/modules/item/lib/edit-access';
import { itemQueryOptions, useSaveItem } from '@/modules/item/queries';
import type { ItemFieldErrors, ItemFormOutput } from '@/modules/item/schemas';
import { ITEM_FIELD_KEYS, toItemFormDefaults, toSaveItemInput } from '@/modules/item/schemas';

export const Route = createFileRoute('/_app/item/$itemId/edit')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'item', 'edit'),
  loader: async ({ context, params }) => {
    const [item, me] = await Promise.all([
      context.queryClient.ensureQueryData(itemQueryOptions(params.itemId)),
      context.queryClient.ensureQueryData(meQueryOptions()),
      context.queryClient.ensureQueryData(brandsQueryOptions()),
      context.queryClient.ensureQueryData(businessUnitOptionsQueryOptions()),
    ]);
    assertCanEditItem(me, item);
  },
  component: EditItemPage,
});

function EditItemPage() {
  const { itemId } = Route.useParams();
  const navigate = useNavigate();
  const me = useMe();
  const { data: item } = useSuspenseQuery(itemQueryOptions(itemId));
  const { data: brands } = useSuspenseQuery(brandsQueryOptions());
  const { data: businessUnits } = useSuspenseQuery(businessUnitOptionsQueryOptions());
  const saveItem = useSaveItem();
  const saveBrand = useSaveBrand();
  const saveBusinessUnit = useSaveBusinessUnit();
  const links = itemFormLinkAccess(me);
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
        businessUnits={mergeBusinessUnits(businessUnits, item.businessUnits)}
        editableBusinessUnitIds={buIdsWithLevelFor(me, 'edit')}
        onCreateBrand={
          can(me, 'item', 'edit') ? (input) => saveBrand.mutateAsync(input) : undefined
        }
        onCreateBusinessUnit={
          links.canCreateBusinessUnit ? (input) => saveBusinessUnit.mutateAsync(input) : undefined
        }
        openBrandHref={links.openBrandHref}
        openBusinessUnitHref={links.openBusinessUnitHref}
        defaultValues={toItemFormDefaults(item)}
        submitError={submitError}
        fieldErrors={fieldErrors}
        onSubmit={handleSubmit}
        onCancel={() => void navigate({ to: '/item/$itemId', params: { itemId: item.id } })}
      />
    </div>
  );
}
