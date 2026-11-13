import type { SerialItemOptionDto } from '@shared/contract';
import { normalizeKey } from '@shared/items';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { LinkField, type LinkOption } from '@/components/link-field';
import { serialItemOptionsQueryOptions } from '../queries';

/** Item (dan BU-nya) yang dipilih pada rombongan, baris, atau ubah massal. */
export interface ItemBuValue {
  itemId: string;
  itemLabel: string;
  buId: string;
  buLabel: string;
}

export const EMPTY_ITEM_BU: ItemBuValue = { itemId: '', itemLabel: '', buId: '', buLabel: '' };

export interface ItemBuFieldProps {
  /** Label field item (juga nama combobox); label field BU menjadi `${buLabel}`. */
  label: string;
  buFieldLabel: string;
  idPrefix: string;
  value: ItemBuValue;
  onChange: (value: ItemBuValue) => void;
  error?: string | undefined;
  disabled?: boolean;
}

/**
 * Item (`LinkField`, pencarian di server lewat `serials.itemOptions`, hanya item pada BU yang boleh ditulis) dan BU-nya:
 * BU otomatis bila item hanya di satu BU yang boleh ditulis, `LinkField` BU bila lebih dari satu. Tanpa Tambah/Buka:
 * item dikelola di Data Item.
 */
export function ItemBuField({
  label,
  buFieldLabel,
  idPrefix,
  value,
  onChange,
  error,
  disabled,
}: ItemBuFieldProps) {
  const [term, setTerm] = useState('');
  const [buTerm, setBuTerm] = useState('');
  const [picked, setPicked] = useState<SerialItemOptionDto | null>(null);
  const { data, isFetching } = useQuery(serialItemOptionsQueryOptions(term.trim()));
  const known = new Map<string, SerialItemOptionDto>();
  for (const item of data?.items ?? []) known.set(item.id, item);
  if (picked) known.set(picked.id, picked);
  const options: LinkOption[] = (data?.items ?? []).map((item) => ({
    id: item.id,
    label: item.label,
  }));
  const buOptions = value.itemId === '' ? [] : (known.get(value.itemId)?.buOptions ?? []);
  const buKey = normalizeKey(buTerm);
  const buLinkOptions: LinkOption[] = buOptions
    .map((bu) => ({ id: bu.id, label: bu.code }))
    .filter((option) => buKey === '' || normalizeKey(option.label).includes(buKey));

  function pickItem(id: string | null) {
    if (id === null) {
      setPicked(null);
      onChange(EMPTY_ITEM_BU);
      return;
    }
    const item = known.get(id);
    if (!item) return;
    setPicked(item);
    const keep = item.buOptions.find((bu) => bu.id === value.buId);
    const only = item.buOptions.length === 1 ? item.buOptions[0] : undefined;
    const bu = keep ?? only;
    onChange({
      itemId: item.id,
      itemLabel: item.label,
      buId: bu?.id ?? '',
      buLabel: bu?.code ?? '',
    });
  }

  return (
    <div className="space-y-1.5">
      <LinkField
        id={`${idPrefix}-item`}
        label={label}
        placeholder="Cari merk atau tipe item…"
        value={value.itemId === '' ? null : value.itemId}
        labelOf={(id) => (id === value.itemId ? value.itemLabel : (known.get(id)?.label ?? id))}
        options={options}
        loading={isFetching && data === undefined}
        hasMore={data?.nextCursor != null}
        onSearchChange={setTerm}
        searchDebounceMs={200}
        onChange={pickItem}
        error={error}
        disabled={disabled ?? false}
      />
      {value.itemId !== '' && buOptions.length > 1 ? (
        <LinkField
          id={`${idPrefix}-bu`}
          label={buFieldLabel}
          placeholder="Pilih Business Unit…"
          value={value.buId === '' ? null : value.buId}
          labelOf={(id) =>
            id === value.buId ? value.buLabel : (buOptions.find((bu) => bu.id === id)?.code ?? id)
          }
          options={buLinkOptions}
          onSearchChange={setBuTerm}
          searchDebounceMs={0}
          onChange={(id) => {
            const bu = buOptions.find((option) => option.id === id);
            onChange({ ...value, buId: bu?.id ?? '', buLabel: bu?.code ?? '' });
          }}
          disabled={disabled ?? false}
        />
      ) : value.itemId !== '' && value.buLabel !== '' ? (
        <p className="text-xs text-muted-foreground">Business Unit: {value.buLabel}</p>
      ) : null}
    </div>
  );
}
