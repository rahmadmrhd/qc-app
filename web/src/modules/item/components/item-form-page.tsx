import type { ItemDto } from '@shared/contract';
import { useSuspenseQuery } from '@tanstack/react-query';
import { FormPage } from '@/components/page/form-page';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { businessUnitOptionsQueryOptions } from '@/modules/access/queries';
import { brandsQueryOptions } from '@/modules/brand/queries';
import { stickersQuery, stickerTypesQuery } from '@/modules/sticker/queries';
import { useItemFormController } from '../lib/use-item-form-controller';
import { ItemForm } from './item-form';

export const ITEM_FORM_ID = 'item-form';

/**
 * Halaman Tambah/Ubah item: `FormPage` (bar judul + Batal/Simpan) membungkus `ItemForm` bertab. Data pilihan dimuat
 * rute (`loader`), jadi query di sini tak menunda tampil.
 */
export function ItemFormPage(props: { mode: 'create' } | { mode: 'edit'; item: ItemDto }) {
  const stack = useStackNavigation();
  const item = props.mode === 'edit' ? props.item : undefined;
  const { data: brands } = useSuspenseQuery(brandsQueryOptions());
  const { data: businessUnits } = useSuspenseQuery(businessUnitOptionsQueryOptions());
  const { data: stickers } = useSuspenseQuery(stickersQuery());
  const { data: stickerTypes } = useSuspenseQuery(stickerTypesQuery());
  const { formProps, submitting, blocking } = useItemFormController({
    item,
    lists: { brands, businessUnits, stickers, stickerTypes },
    // Tambah = replace ke View record baru; Ubah = kembali ke View asal (butir 41c).
    onSaved: (saved) => {
      const target = { to: '/item/$itemId', params: { itemId: saved.id } } as const;
      if (item) stack.pop(target);
      else stack.replace(target);
    },
  });
  const cancel = () =>
    item
      ? stack.pop({ to: '/item/$itemId', params: { itemId: item.id } })
      : stack.pop({ to: '/item' });

  return (
    <FormPage
      formId={ITEM_FORM_ID}
      title={item ? `Ubah item: ${item.brand} ${item.model}` : 'Tambah item'}
      onCancel={cancel}
      submitting={submitting}
      submitDisabled={blocking}
      busyText="Menyimpan item…"
    >
      <ItemForm key={item?.updatedAt} formId={ITEM_FORM_ID} {...formProps} />
    </FormPage>
  );
}
