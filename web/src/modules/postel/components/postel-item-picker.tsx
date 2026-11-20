import type { PostelItemOptionDto } from '@shared/contract';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { LinkMultiField, type LinkOption } from '@/components/link-field';
import { ItemFormDialog } from '@/modules/item/components/item-form-dialog';
import type { PickedItem } from '../lib/schemas';
import { postelItemOptionsQueryOptions } from '../queries';

export type { PickedItem } from '../lib/schemas';

const labelOf = (item: Pick<PickedItem, 'brand' | 'model'>) => `${item.brand} ${item.model}`;

export interface PostelItemPickerProps {
  selected: readonly PickedItem[];
  onChange: (selected: PickedItem[]) => void;
  /** Item yang sudah tergabung ke catatan ini (tetap dapat dipilih walau ber-Postel). */
  ownedIds?: ReadonlySet<string> | undefined;
  /** Jumlah item tergabung yang tak terlihat oleh pengguna (tetap terpasang); hanya angka. */
  hiddenCount?: number | undefined;
  error?: string | undefined;
  /** Boleh menambah item dari pemilih (`itemLinkAccess(...).canCreate`): memunculkan baris "Tambah Item". */
  canCreateItem?: boolean | undefined;
}

/**
 * Pemilih item catatan Postel (`LinkMultiField`; pencarian di server lewat `postels.itemOptions`). Item yang sudah
 * tergabung ke catatan Postel lain tampil nonaktif beserta nomor Aktif catatan itu.
 */
export function PostelItemPicker({
  selected,
  onChange,
  ownedIds,
  hiddenCount = 0,
  error,
  canCreateItem = false,
}: PostelItemPickerProps) {
  const [term, setTerm] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const { data, isFetching } = useQuery(postelItemOptionsQueryOptions(term.trim()));
  const known = new Map<string, PostelItemOptionDto | PickedItem>();
  for (const item of data?.items ?? []) known.set(item.id, item);
  for (const item of selected) known.set(item.id, item);
  const options: LinkOption[] = (data?.items ?? []).map((item) => {
    const taken = item.postelNumber !== '' && !ownedIds?.has(item.id);
    return {
      id: item.id,
      label: labelOf(item),
      ...(taken
        ? { disabled: true, description: `Sudah tergabung ke Postel "${item.postelNumber}"` }
        : {}),
    };
  });
  return (
    <div className="space-y-1.5">
      <LinkMultiField
        id="postel-items"
        label="Item"
        required
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
        error={error}
        onCreate={canCreateItem ? () => setCreateOpen(true) : undefined}
        onChange={(ids) =>
          onChange(
            ids.flatMap((id) => {
              const item = known.get(id);
              return item ? [{ id, brand: item.brand, model: item.model }] : [];
            }),
          )
        }
      />
      {canCreateItem ? (
        // Submit dialog tidak menjalar ke form Postel di atasnya (ItemForm menghentikan propagasi submit).
        <ItemFormDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={(item) =>
            onChange([...selected, { id: item.id, brand: item.brand, model: item.model }])
          }
        />
      ) : null}
      {hiddenCount > 0 ? (
        <p className="text-sm text-muted-foreground">
          {`${hiddenCount} item lain tergabung di sini tetapi tidak terlihat oleh Anda; tetap terpasang.`}
        </p>
      ) : null}
    </div>
  );
}
