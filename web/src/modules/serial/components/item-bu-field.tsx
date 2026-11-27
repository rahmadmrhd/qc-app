import { formatBuLabel } from '@shared/business-units';
import type { ItemDto, SerialItemOptionDto } from '@shared/contract';
import { normalizeKey } from '@shared/items';
import { proofMinimumOf } from '@shared/serials';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { LinkField, type LinkOption } from '@/components/link-field';
import { businessUnitLinkAccess, itemLinkAccess, serialItemCreateAccess } from '@/lib/link-access';
import { meQueryOptions } from '@/modules/auth/queries';
import { useItemCreate } from '@/modules/item/components/item-create-host';
import { serialBuOptionsQueryOptions, serialItemOptionsQueryOptions } from '../queries';
import type { BuChoice } from './recheck-bu-field';

/** Item dan BU yang dipilih pada rombongan, baris, atau ubah massal. */
export interface ItemBuValue {
  itemId: string;
  itemLabel: string;
  buId: string;
  buLabel: string;
  /** Minimum foto bukti item ini saat dicatat (0 = item tidak wajib foto). */
  proofMin: number;
}

export const EMPTY_ITEM_BU: ItemBuValue = {
  itemId: '',
  itemLabel: '',
  buId: '',
  buLabel: '',
  proofMin: 0,
};

export interface ItemBuFieldProps {
  /** Label field item (juga nama combobox); label field BU adalah `buFieldLabel`. */
  label: string;
  buFieldLabel: string;
  idPrefix: string;
  value: ItemBuValue;
  onChange: (value: ItemBuValue) => void;
  /** Galat pada field item. */
  error?: string | undefined;
  /** Galat pada field BU. */
  buError?: string | undefined;
  disabled?: boolean;
  /** Item dan BU sama-sama wajib: bintang pada label dan `aria-required`. */
  required?: boolean;
}

/**
 * BU bawaan setelah item dipilih (spek Catat wajib foto, butir N): BU item yang termasuk daftar BU tulis. Tepat satu =
 * terisi; lebih dari satu = BU sebelumnya dipertahankan bila salah satunya, selain itu kosong sampai dipilih; item
 * tanpa BU yang dikenal tidak menyentuh pilihan BU sekarang. Murni, agar dapat diuji sendiri.
 */
export function defaultBuForItem(
  itemBus: readonly BuChoice[],
  allowed: readonly { id: string }[] | null,
  current: BuChoice,
): BuChoice {
  const known =
    allowed === null ? itemBus : itemBus.filter((bu) => allowed.some((a) => a.id === bu.id));
  if (known.length === 0) return current;
  const [only] = known;
  if (known.length === 1 && only) return only;
  return known.find((bu) => bu.id === current.id) ?? { id: '', code: '' };
}

/**
 * Item (`LinkField`, pencarian di server lewat `serials.itemOptions`) dan BU (`LinkField`, SELALU tampil dengan semua BU
 * yang boleh ditulis pengguna lewat `serials.buOptions`; BU serial tidak lagi dibatasi pada BU item). BU terisi dari item
 * sesuai `defaultBuForItem` dan boleh diganti ke BU mana pun. Tambah item hanya lewat `serialItemCreateAccess`; Buka ke
 * View Item dan View BU hanya bila pengguna berhak (`itemLinkAccess`, `businessUnitLinkAccess`; aturan field relasi).
 * Dirender sebagai dua blok bersaudara (fragmen) agar pemanggil dapat menempatkannya dalam grid atau tumpukan form.
 */
export function ItemBuField({
  label,
  buFieldLabel,
  idPrefix,
  value,
  onChange,
  error,
  buError,
  disabled,
  required,
}: ItemBuFieldProps) {
  const [term, setTerm] = useState('');
  const [buTerm, setBuTerm] = useState('');
  const [picked, setPicked] = useState<SerialItemOptionDto | null>(null);
  // Dialog Tambah item dirender tuan rumah di luar `<form>` pemanggil; field hanya meminta lewat `useItemCreate`.
  const itemCreate = useItemCreate();
  // Tanpa suspense: data pengguna sudah dimuat cangkang; bila belum, baris Tambah item sekadar tak tampil.
  const me = useQuery(meQueryOptions()).data;
  const create = serialItemCreateAccess(me);
  const openItemHref = itemLinkAccess(me).openItemHref;
  const openBuHref = businessUnitLinkAccess(me).openBusinessUnitHref;
  const queryClient = useQueryClient();
  const { data, isFetching } = useQuery(serialItemOptionsQueryOptions(term.trim()));
  const { data: buData, isPending: buPending } = useQuery(serialBuOptionsQueryOptions());
  const known = new Map<string, SerialItemOptionDto>();
  for (const item of data?.items ?? []) known.set(item.id, item);
  if (picked) known.set(picked.id, picked);
  const options: LinkOption[] = (data?.items ?? []).map((item) => ({
    id: item.id,
    label: item.label,
  }));
  // Item yang baru dibuat dari dialog tetap tampil di pilihan sebelum muat ulang daftar server.
  if (picked && !options.some((option) => option.id === picked.id)) {
    options.unshift({ id: picked.id, label: picked.label });
  }

  // Daftar BU tulis belum ada (memuat atau gagal): pilihan sementara = BU item terpilih, supaya field tetap dapat dipakai.
  const allBus: BuChoice[] | null = buData
    ? buData.businessUnits.map((bu) => ({ id: bu.id, code: bu.code, name: bu.name }))
    : null;
  const itemBus = value.itemId === '' ? [] : (known.get(value.itemId)?.buOptions ?? []);
  const buChoices = allBus ?? itemBus;
  const buKey = normalizeKey(buTerm);
  const buLinkOptions: LinkOption[] = buChoices
    .map((bu) => ({ id: bu.id, label: formatBuLabel(bu) }))
    .filter((option) => buKey === '' || normalizeKey(option.label).includes(buKey));

  function pickCreated(created: ItemDto) {
    const allowed = create.allowedBuIds;
    const option: SerialItemOptionDto = {
      id: created.id,
      label: `${created.brand} ${created.model}`,
      buIds: created.businessUnits.filter((bu) => allowed.includes(bu.id)).map((bu) => bu.id),
      buOptions: created.businessUnits
        .filter((bu) => allowed.includes(bu.id))
        .map((bu) => ({ id: bu.id, code: bu.code, name: bu.name })),
      proofRequired: created.proofRequired,
      proofMin: created.proofMin,
    };
    known.set(option.id, option);
    void queryClient.invalidateQueries({ queryKey: ['serial', 'itemOptions'] });
    pickItem(option.id);
  }

  const latestPick = useRef(pickCreated);
  latestPick.current = pickCreated;

  function pickItem(id: string | null) {
    if (id === null) {
      setPicked(null);
      // BU tidak terikat item: mengosongkan item tidak mengosongkan BU.
      onChange({ ...EMPTY_ITEM_BU, buId: value.buId, buLabel: value.buLabel });
      return;
    }
    const item = known.get(id);
    if (!item) return;
    setPicked(item);
    const bu = defaultBuForItem(item.buOptions, allBus, { id: value.buId, code: value.buLabel });
    onChange({
      itemId: item.id,
      itemLabel: item.label,
      buId: bu.id,
      buLabel: formatBuLabel(bu),
      proofMin: proofMinimumOf(item),
    });
  }

  return (
    <>
      <div className="space-y-1.5">
        <LinkField
          id={`${idPrefix}-item`}
          label={label}
          required={required}
          placeholder="Cari merk atau tipe item…"
          value={value.itemId === '' ? null : value.itemId}
          labelOf={(id) => (id === value.itemId ? value.itemLabel : (known.get(id)?.label ?? id))}
          options={options}
          loading={isFetching && data === undefined}
          hasMore={data?.nextCursor != null}
          onSearchChange={setTerm}
          searchDebounceMs={200}
          onChange={pickItem}
          onCreate={
            create.canCreate && itemCreate.available && !disabled
              ? () =>
                  itemCreate.open({
                    allowedBuIds: create.allowedBuIds,
                    onCreated: (created) => latestPick.current(created),
                  })
              : undefined
          }
          openHref={openItemHref}
          error={error}
          disabled={disabled ?? false}
        />
      </div>
      <div className="space-y-1.5">
        <LinkField
          id={`${idPrefix}-bu`}
          label={buFieldLabel}
          required={required}
          placeholder="Pilih Business Unit…"
          value={value.buId === '' ? null : value.buId}
          labelOf={(id) =>
            id === value.buId
              ? value.buLabel
              : formatBuLabel(buChoices.find((bu) => bu.id === id) ?? {}) || id
          }
          options={buLinkOptions}
          loading={allBus === null && buPending}
          onSearchChange={setBuTerm}
          searchDebounceMs={0}
          onChange={(id) => {
            const bu = buChoices.find((option) => option.id === id);
            onChange({ ...value, buId: bu?.id ?? '', buLabel: bu ? formatBuLabel(bu) : '' });
          }}
          openHref={openBuHref}
          error={buError}
          disabled={disabled ?? false}
        />
      </div>
    </>
  );
}
