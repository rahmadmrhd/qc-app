import { normalizeKey } from '@shared/items';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { describeError } from '@/lib/api/describe-error';
import { pickFieldErrors } from '@/modules/access/lib/field-errors';
import { requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
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
  const me = useMe();
  const saveItem = useSaveItem();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ItemFieldErrors>({});

  async function handleSubmit(values: ItemFormOutput) {
    setSubmitError(null);
    setFieldErrors({});
    try {
      // Sementara (sampai field Merk dan BU di form): merk dicocokkan menurut nama, BU = semua BU aktif yang boleh diubah.
      const brandId =
        brands.find((brand) => normalizeKey(brand.name) === normalizeKey(values.brand))?.id ?? '';
      const businessUnitIds = (me?.businessUnits ?? [])
        .filter(
          (bu) =>
            bu.status === 'active' &&
            (bu.permissions.item === 'edit' || bu.permissions.item === 'manage'),
        )
        .map((bu) => bu.id);
      const saved = await saveItem.mutateAsync(
        toSaveItemInput(values, undefined, undefined, { brandId, businessUnitIds }),
      );
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
