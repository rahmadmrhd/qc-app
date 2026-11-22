import { ComboboxBase, type ComboboxCommon } from '@/components/combobox';
import { useChipDraft } from '@/components/page/filter-draft';

/** Satu pilihan tetap (enum/daftar kecil di kode). `value` boleh string kosong, mis. untuk "Semua …". */
export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

type SelectCommon = Omit<
  ComboboxCommon,
  | 'options'
  | 'onSearchChange'
  | 'searchDebounceMs'
  | 'hasMore'
  | 'loading'
  | 'onCreate'
  | 'openHref'
> & {
  options: readonly SelectOption[];
};

export interface SelectProps extends SelectCommon {
  value: string;
  onValueChange: (value: string) => void;
  /** Tampilkan tombol X yang mengembalikan nilai ke `emptyValue` (bawaan ''). Tanpa ini nilai selalu ada. */
  clearable?: boolean;
  emptyValue?: string;
}

export interface MultiSelectProps extends SelectCommon {
  value: readonly string[];
  onValueChange: (values: string[]) => void;
  /**
   * Menyesuaikan nilai setiap kali pengguna memilih/melepas satu opsi (mis. dua opsi yang saling meniadakan):
   * `(nilai baru, nilai sebelumnya) => nilai yang dipakai`. Berlaku pada draf di dalam chip maupun di luarnya.
   */
  reconcile?: (next: string[], previous: readonly string[]) => string[];
}

/** Pilihan tetap sependek ini tak perlu papan ketik layar (ketukan langsung memilih dari daftar). */
const KEYBOARDLESS_MAX = 8;

const toLinkOptions = (options: readonly SelectOption[]) =>
  options.map(({ value, ...rest }) => ({ id: value, ...rest }));

/**
 * Pilihan TUNGGAL dari daftar tetap (pengganti `<select>` bawaan): input teks yang menyaring daftar saat diketik
 * (kata yang cocok disorot), tombol X opsional, daftar di portal agar tak terpotong dialog. Untuk record dari
 * model lain pakai `LinkField`, bukan komponen ini.
 */
export function Select({
  value,
  onValueChange,
  clearable,
  emptyValue = '',
  options,
  ...common
}: SelectProps) {
  const current = options.find((option) => option.value === value);
  return (
    <ComboboxBase
      {...common}
      options={toLinkOptions(options)}
      multi={false}
      localFilter
      highlight
      keyboardless={options.length <= KEYBOARDLESS_MAX}
      selectedIds={current ? [current.value] : []}
      displayText={current?.label ?? ''}
      chips={[]}
      onPick={onValueChange}
      onRemove={() => undefined}
      onClear={clearable && value !== emptyValue ? () => onValueChange(emptyValue) : undefined}
      openLink={null}
    />
  );
}

/**
 * Pilihan BANYAK dari daftar tetap; nilai terpilih menjadi chip di dalam bingkai input. Di dalam `FilterChip`
 * perubahan ditahan sebagai draf dan `onValueChange` dipanggil sekali saat chip menutup; di luar chip seketika.
 */
export function MultiSelect({
  value: applied,
  onValueChange,
  reconcile,
  options,
  ...common
}: MultiSelectProps) {
  const [value, setValue] = useChipDraft<readonly string[]>(applied, (next) =>
    onValueChange([...next]),
  );
  const change = (next: string[]) => setValue(reconcile ? reconcile(next, value) : next);
  const labelOf = (id: string) => options.find((option) => option.value === id)?.label ?? id;
  return (
    <ComboboxBase
      {...common}
      options={toLinkOptions(options)}
      multi
      localFilter
      highlight
      selectedIds={value}
      displayText={null}
      chips={value.map((id) => ({ id, label: labelOf(id), href: null }))}
      onPick={(picked) => change([...value, picked])}
      onRemove={(removed) => change(value.filter((existing) => existing !== removed))}
    />
  );
}
