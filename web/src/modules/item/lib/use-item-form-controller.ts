import type {
  BrandDto,
  BusinessUnitOptionDto,
  ItemDto,
  StickerDto,
  StickerTypeDto,
} from '@shared/contract';
import { useState } from 'react';
import { toast } from 'sonner';
import { describeError } from '@/lib/api/describe-error';
import { itemFormLinkAccess } from '@/lib/link-access';
import { pickFieldErrors } from '@/modules/access/lib/field-errors';
import { useSaveBusinessUnit } from '@/modules/access/queries';
import { can, liveBuIdsWithLevelOf, locationsWith } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { useSaveBrand } from '@/modules/brand/queries';
import { useSaveSticker, useSaveStickerType } from '@/modules/sticker/queries';
import type { ItemFormProps } from '../components/item-form';
import { useFirmwareOptions, useSaveItem } from '../queries';
import type { ItemFieldErrors, ItemFormOutput } from '../schemas';
import { ITEM_FIELD_KEYS, toItemFormDefaults, toSaveItemInput } from '../schemas';
import { mergeBusinessUnits } from './default-business-units';

/**
 * Menambahkan merk milik item yang diubah bila tak ada di daftar merk hidup (merk terhapus): form menampilkan nama
 * dan penanda "Terhapus" alih-alih id, dan opsi firmware tetap dihitung dari namanya. Status nonaktif = tak
 * ditawarkan untuk pilihan baru (hanya tetap terpilih).
 */
export function mergeItemBrand(brands: readonly BrandDto[], item?: ItemDto): readonly BrandDto[] {
  if (!item || brands.some((brand) => brand.id === item.brandId)) return brands;
  return [
    ...brands,
    {
      id: item.brandId,
      name: item.brand,
      status: 'inactive',
      itemCount: 0,
      updatedAt: '',
      businessUnitIds: [],
      ...(item.brandDeleted ? { deleted: { deletedAt: '', deletedBy: '' } } : {}),
    },
  ];
}

export interface ItemFormLists {
  brands: readonly BrandDto[];
  businessUnits: readonly BusinessUnitOptionDto[];
  stickers: readonly StickerDto[];
  stickerTypes: readonly StickerTypeDto[];
}

/**
 * Menyatukan semua yang dibutuhkan `ItemForm` oleh pembungkus halaman (`ItemFormPage`) maupun dialog
 * (`ItemFormDialog`): izin Tambah/Buka field relasi, mutasi simpan beserta galatnya, dan nilai awal. Pembungkus hanya
 * menaruh `formProps` ke `ItemForm`, `submitting` ke tombol Simpan, dan bereaksi lewat `onSaved`.
 */
export function useItemFormController({
  item,
  lists,
  onSaved,
  allowedBusinessUnitIds,
}: {
  /** Item yang diubah; kosong = item baru. */
  item?: ItemDto | undefined;
  lists: ItemFormLists;
  onSaved: (saved: ItemDto) => void | Promise<void>;
  /** Membatasi BU yang boleh dipilih (irisan dengan BU `item: edit` user); kosong = semua BU yang boleh diedit. */
  allowedBusinessUnitIds?: readonly string[] | undefined;
}) {
  const me = useMe();
  const saveItem = useSaveItem();
  const saveBrand = useSaveBrand();
  const saveBusinessUnit = useSaveBusinessUnit();
  const saveSticker = useSaveSticker();
  const saveStickerType = useSaveStickerType();
  const firmwareOptions = useFirmwareOptions();
  // Tanpa tombol "Buka untuk ekspor": pindah halaman akan membuang isian form item.
  const links = itemFormLinkAccess(me);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Gambar yang masih diunggah di form: pembungkus menahan Simpan selama true (`blocking`).
  const [blocking, setBlocking] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<ItemFieldErrors>({});

  async function onSubmit(values: ItemFormOutput) {
    setSubmitError(null);
    setFieldErrors({});
    try {
      const saved = await saveItem.mutateAsync(
        item ? toSaveItemInput(values, item.id, item.updatedAt) : toSaveItemInput(values),
      );
      toast.success('Item disimpan');
      await onSaved(saved);
    } catch (error) {
      const picked = pickFieldErrors(error, ITEM_FIELD_KEYS);
      if (Object.keys(picked).length > 0) setFieldErrors(picked);
      else setSubmitError(describeError(error));
    }
  }

  const formProps = {
    brands: mergeItemBrand(lists.brands, item),
    firmwareOptions,
    businessUnits: item
      ? mergeBusinessUnits(lists.businessUnits, item.businessUnits)
      : lists.businessUnits,
    editableBusinessUnitIds: liveBuIdsWithLevelOf(me, 'item', 'edit').filter(
      (id) => !allowedBusinessUnitIds || allowedBusinessUnitIds.includes(id),
    ),
    onCreateBrand: can(me, 'item', 'edit') ? (input) => saveBrand.mutateAsync(input) : undefined,
    onCreateBusinessUnit: links.canCreateBusinessUnit
      ? (input) => saveBusinessUnit.mutateAsync(input)
      : undefined,
    openBrandHref: links.openBrandHref,
    openBusinessUnitHref: links.openBusinessUnitHref,
    stickers: lists.stickers,
    stickerTypes: lists.stickerTypes,
    onCreateSticker: links.canCreateSticker ? (input) => saveSticker.mutateAsync(input) : undefined,
    onCreateStickerType: links.canCreateStickerType
      ? (input) => saveStickerType.mutateAsync(input)
      : undefined,
    canSetStickerTypeDefaultMin: can(me, 'sticker', 'manage'),
    // Dialog tambah stiker dari form Item: tambah jenis, tambah BU, stok awal, dan tautan jenis. Postel/Manual Book
    // sengaja tidak dipasang di sini (dari form Item hasilnya tak bisa menjadi sasaran penanda dan dialognya
    // bertumpuk); keduanya dibuat dari halaman Postel/QR atau katalog stiker.
    openStickerTypeHref: links.openStickerTypeHref,
    stockLocations: locationsWith(me, 'stickerstock', 'edit').map((location) => ({
      id: location.id,
      name: location.name,
      code: location.code,
    })),
    ...(item
      ? {
          itemId: item.id,
          guides: item.stickerPhotos.map((photo) => ({
            id: photo.guideId,
            name: photo.guideName,
            width: photo.width,
            height: photo.height,
          })),
        }
      : {}),
    defaultValues: toItemFormDefaults(item),
    submitError,
    fieldErrors,
    onSubmit,
    onBusyChange: setBlocking,
  } satisfies Omit<ItemFormProps, 'formId'>;

  return { formProps, submitting: saveItem.isPending, blocking };
}
