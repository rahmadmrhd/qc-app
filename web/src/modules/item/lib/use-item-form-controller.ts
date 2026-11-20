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
import { can, liveBuIdsWithLevelOf } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { useSaveBrand } from '@/modules/brand/queries';
import { useSaveSticker, useSaveStickerType } from '@/modules/sticker/queries';
import type { ItemFormProps } from '../components/item-form';
import { useSaveItem } from '../queries';
import type { ItemFieldErrors, ItemFormOutput } from '../schemas';
import { ITEM_FIELD_KEYS, toItemFormDefaults, toSaveItemInput } from '../schemas';
import { mergeBusinessUnits } from './default-business-units';

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
}: {
  /** Item yang diubah; kosong = item baru. */
  item?: ItemDto | undefined;
  lists: ItemFormLists;
  onSaved: (saved: ItemDto) => void | Promise<void>;
}) {
  const me = useMe();
  const saveItem = useSaveItem();
  const saveBrand = useSaveBrand();
  const saveBusinessUnit = useSaveBusinessUnit();
  const saveSticker = useSaveSticker();
  const saveStickerType = useSaveStickerType();
  const links = itemFormLinkAccess(me);
  const [submitError, setSubmitError] = useState<string | null>(null);
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
    brands: lists.brands,
    businessUnits: item
      ? mergeBusinessUnits(lists.businessUnits, item.businessUnits)
      : lists.businessUnits,
    editableBusinessUnitIds: liveBuIdsWithLevelOf(me, 'item', 'edit'),
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
  } satisfies Omit<ItemFormProps, 'formId'>;

  return { formProps, submitting: saveItem.isPending };
}
