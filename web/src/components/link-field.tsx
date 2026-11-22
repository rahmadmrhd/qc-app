import type { ReactNode } from 'react';
import { ComboboxBase, type ComboboxCommon } from '@/components/combobox';
import { useChipDraft } from '@/components/page/filter-draft';

export type { LinkOption, ListPlacement } from '@/components/combobox';
export { placeList } from '@/components/combobox';

export interface LinkFieldProps extends ComboboxCommon {
  value: string | null;
  onChange: (id: string | null) => void;
  /** Label nilai terpilih yang bisa tak ada lagi di `options` (mis. tersaring pencarian). */
  labelOf?: (id: string) => string | undefined;
}

export interface LinkMultiFieldProps extends ComboboxCommon {
  value: readonly string[];
  onChange: (ids: string[]) => void;
  labelOf: (id: string) => string;
}

/** Pilih SATU record yang sudah ada. Tombol X mengosongkan; panah membuka record; Tambah membuat baru. */
export function LinkField({ value, onChange, labelOf, openHref, ...common }: LinkFieldProps) {
  const text =
    value === null
      ? null
      : (labelOf?.(value) ?? common.options.find((option) => option.id === value)?.label ?? value);
  return (
    <ComboboxBase
      {...common}
      multi={false}
      selectedIds={value === null ? [] : [value]}
      displayText={text}
      chips={[]}
      onPick={(picked) => onChange(picked)}
      onRemove={() => undefined}
      onClear={value === null ? undefined : () => onChange(null)}
      openLink={value === null ? null : (openHref?.(value) ?? null)}
    />
  );
}

/**
 * Pilih BANYAK record; nilai terpilih tampil sebagai chip di dalam bingkai input. Di dalam `FilterChip` perubahan
 * ditahan sebagai draf dan `onChange` dipanggil sekali saat chip menutup; di luar chip seketika.
 */
export function LinkMultiField({
  value: applied,
  onChange,
  labelOf,
  openHref,
  ...common
}: LinkMultiFieldProps): ReactNode {
  const [value, setValue] = useChipDraft<readonly string[]>(applied, (next) => onChange([...next]));
  return (
    <ComboboxBase
      {...common}
      multi
      selectedIds={value}
      displayText={null}
      chips={value.map((chipId) => ({
        id: chipId,
        label: labelOf(chipId),
        href: openHref?.(chipId) ?? null,
      }))}
      onPick={(picked) => setValue([...value, picked])}
      onRemove={(removed) => setValue(value.filter((existing) => existing !== removed))}
    />
  );
}
