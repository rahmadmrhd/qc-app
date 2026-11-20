import type { QrItemOptionDto } from '@shared/contract';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { LinkMultiField, type LinkOption } from '@/components/link-field';
import { qrItemOptionsQueryOptions } from '../queries';

/** Item terpilih pada form QR; `businessUnitIds` kosong bila belum diketahui (item dari konfigurasi tersimpan). */
export interface PickedItem {
  id: string;
  brand: string;
  model: string;
  businessUnitIds: string[];
}

const labelOf = (item: Pick<PickedItem, 'brand' | 'model'>) => `${item.brand} ${item.model}`;

export interface ItemPickerProps {
  selected: readonly PickedItem[];
  onChange: (selected: PickedItem[]) => void;
  /** Item yang sudah tergabung ke konfigurasi ini (tetap dapat dipilih walau ber-Manual Book). */
  ownedIds?: ReadonlySet<string>;
  /** Tautan ke halaman lihat item (`itemLinkAccess` di `lib/link-access.ts`); kosong = tanpa tautan. */
  openHref?: (id: string) => string | null;
  /** Membuka dialog Tambah item (baris "Tambah Item" di dasar daftar); tanpa ini baris tidak ada. */
  onCreate?: () => void;
  error?: string;
  disabled?: boolean;
  required?: boolean;
}

/**
 * Pemilih item Manual Book (`LinkMultiField`; pencarian di server lewat `qrcodes.itemOptions`). Item yang sudah
 * tergabung ke Manual Book lain tampil nonaktif beserta nama Manual Book-nya: harus dikeluarkan dulu dari sana.
 */
export function ItemPicker({
  selected,
  onChange,
  ownedIds,
  openHref,
  onCreate,
  error,
  disabled,
  required,
}: ItemPickerProps) {
  const [term, setTerm] = useState('');
  const { data, isFetching } = useQuery(qrItemOptionsQueryOptions(term.trim()));
  const known = new Map<string, QrItemOptionDto | PickedItem>();
  for (const item of data?.items ?? []) known.set(item.id, item);
  for (const item of selected) known.set(item.id, item);
  const options: LinkOption[] = (data?.items ?? []).map((item) => {
    const taken = item.manualBookName !== '' && !ownedIds?.has(item.id);
    return {
      id: item.id,
      label: labelOf(item),
      ...(taken
        ? { disabled: true, description: `Sudah tergabung ke Manual Book "${item.manualBookName}"` }
        : {}),
    };
  });
  return (
    <LinkMultiField
      id="qr-items"
      required={required}
      label="Item"
      placeholder="Cari merk atau tipe item…"
      value={selected.map((item) => item.id)}
      labelOf={(id) => {
        const item = known.get(id);
        return item ? labelOf(item) : id;
      }}
      options={options}
      loading={isFetching && data === undefined}
      hasMore={data?.nextCursor != null}
      onSearchChange={setTerm}
      searchDebounceMs={200}
      openHref={openHref}
      onCreate={onCreate}
      error={error}
      disabled={disabled}
      onChange={(ids) =>
        onChange(
          ids.flatMap((id) => {
            const item = known.get(id);
            if (!item) return [];
            return [
              {
                id,
                brand: item.brand,
                model: item.model,
                businessUnitIds: 'businessUnitIds' in item ? [...item.businessUnitIds] : [],
              },
            ];
          }),
        )
      }
    />
  );
}
