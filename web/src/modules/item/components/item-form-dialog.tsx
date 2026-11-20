import type { ItemDto } from '@shared/contract';
import { useQuery } from '@tanstack/react-query';
import { FormDialogShell } from '@/components/form-dialog-shell';
import { businessUnitOptionsQueryOptions } from '@/modules/access/queries';
import { brandsQueryOptions } from '@/modules/brand/queries';
import { stickersQuery, stickerTypesQuery } from '@/modules/sticker/queries';
import { useItemFormController } from '../lib/use-item-form-controller';
import { ItemForm } from './item-form';

export const ITEM_FORM_DIALOG_ID = 'item-form-dialog';

interface ItemFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (item: ItemDto) => void;
}

function OpenItemFormDialog({ open, onOpenChange, onCreated }: ItemFormDialogProps) {
  const brands = useQuery(brandsQueryOptions());
  const businessUnits = useQuery(businessUnitOptionsQueryOptions());
  const stickers = useQuery(stickersQuery());
  const stickerTypes = useQuery(stickerTypesQuery());
  const ready = brands.data && businessUnits.data && stickers.data && stickerTypes.data;
  const { formProps, submitting } = useItemFormController({
    lists: {
      brands: brands.data ?? [],
      businessUnits: businessUnits.data ?? [],
      stickers: stickers.data ?? [],
      stickerTypes: stickerTypes.data ?? [],
    },
    onSaved: (item) => {
      onOpenChange(false);
      onCreated(item);
    },
  });
  return (
    <FormDialogShell
      open={open}
      onOpenChange={onOpenChange}
      formId={ITEM_FORM_DIALOG_ID}
      title="Tambah item"
      size="lg"
      submitting={submitting}
    >
      {ready ? (
        <ItemForm formId={ITEM_FORM_DIALOG_ID} {...formProps} />
      ) : (
        <p className="text-sm text-muted-foreground">Memuat…</p>
      )}
    </FormDialogShell>
  );
}

/**
 * Tambah item dari dialog (baris "Tambah item" pada `LinkField` Item modul lain). BU yang ditawarkan hanya yang boleh
 * diedit pengguna (`item: edit`), sehingga item baru langsung muncul di pilihan pemanggil. Wajib dirender di LUAR
 * `<form>` pemanggil. `onCreated` menerima item yang tersimpan; dialog menutup sendiri. Status galat dan isian dibuang
 * tiap kali dialog ditutup (komponen dalam hanya terpasang saat terbuka).
 */
export function ItemFormDialog(props: ItemFormDialogProps) {
  return props.open ? <OpenItemFormDialog {...props} /> : null;
}
