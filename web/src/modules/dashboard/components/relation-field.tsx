import type { DashboardOptionKind, GroupFilterField } from '@shared/dashboard';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { LinkMultiField, type LinkOption } from '@/components/link-field';
import { FILTER_LIST_MAX } from '@/lib/filter-limits';
import { dashboardOptionsQueryOptions } from '../queries';

export const RELATION_KEY: Record<
  NonNullable<GroupFilterField['relation']>,
  DashboardOptionKind
> = {
  customer: 'customers',
  item: 'items',
  stickerType: 'stickerTypes',
  sticker: 'stickers',
};

/**
 * Pilihan relasi dengan pencarian di server (keputusan pemilik 2026-11-23): kata ketik dikirim ke `dashboard.options`
 * lewat `onSearchChange`, yang di-debounce `ComboboxBase` (`useSearchTerm`, bawaan 200 ms; tak dipanggil saat mount),
 * halaman pertama saja; `next` menyalakan petunjuk "persempit pencarian". Dipasang di dalam isi chip atau form, jadi
 * hanya meminta saat tampil. Setiap halaman hasil dicatat ke `remember` agar nama opsi yang baru dipilih langsung
 * dikenal (chip draf di input dan tombol chip), tanpa menunggu resolusi `ids`.
 */
export function RelationPicker({
  kind,
  field,
  value,
  labelOf,
  onChange,
  remember,
  id,
  showLabel = false,
}: {
  kind: DashboardOptionKind;
  field: GroupFilterField;
  value: string[];
  labelOf: (item: string) => string;
  onChange: (next: string[]) => void;
  remember: Map<string, string>;
  id: string;
  /** Label terlihat (form); bawaan tersembunyi karena chip filter sudah punya judul sendiri. */
  showLabel?: boolean;
}) {
  const [term, setTerm] = useState('');
  const page = useQuery({
    ...dashboardOptionsQueryOptions({ kind, ...(term === '' ? {} : { query: term }) }),
    placeholderData: keepPreviousData,
  });
  const source: LinkOption[] = (page.data?.[kind] ?? []).map((option) => ({
    id: option.value,
    label: option.label,
  }));
  // Ditulis saat render (monoton dan idempoten) agar chip draf di input yang dirender setelah ini sudah mengenalnya.
  for (const option of source) remember.set(option.id, option.label);
  return (
    <LinkMultiField
      maxSelected={FILTER_LIST_MAX}
      id={id}
      label={showLabel ? field.label : `Filter ${field.label}`}
      hideLabel={!showLabel}
      placeholder={`Semua ${field.label.toLowerCase()}`}
      highlight
      value={value}
      labelOf={labelOf}
      options={source}
      loading={page.isFetching}
      hasMore={page.data?.next?.[kind] !== undefined}
      onSearchChange={setTerm}
      onChange={onChange}
    />
  );
}

/**
 * Nama nilai relasi terpilih (dari URL, pilihan, atau tautan tersimpan) diresolusi server lewat `ids`. Urutan label:
 * nama yang diingat; galat resolusi = pesan gagal (bukan "Memuat..." selamanya dan bukan "tidak dikenal" untuk record
 * yang mungkin sah); "tidak dikenal" hanya bila respons `ids` yang final (bukan placeholder dari nilai sebelumnya) tak
 * memuat id itu, dan tetap stabil saat muat ulang latar; selain itu "Memuat...".
 */
export function useRelationLabels(
  field: GroupFilterField,
  value: string[],
): {
  kind: DashboardOptionKind;
  labelOf: (item: string) => string;
  remember: Map<string, string>;
} {
  const kind = RELATION_KEY[field.relation ?? 'customer'];
  const resolved = useQuery({
    ...dashboardOptionsQueryOptions({ kind, ids: value }),
    enabled: value.length > 0,
    placeholderData: keepPreviousData,
  });
  // Peta id -> nama yang diingat selama komponen hidup: dari halaman hasil pencarian dan dari resolusi `ids`.
  const remembered = useRef(new Map<string, string>());
  for (const option of resolved.data?.[kind] ?? [])
    remembered.current.set(option.value, option.label);
  const settled = resolved.isSuccess && !resolved.isPlaceholderData;
  const labelOf = (item: string) =>
    remembered.current.get(item) ??
    (resolved.isError ? 'Gagal memuat nama' : settled ? `${field.label} tidak dikenal` : 'Memuat…');
  return { kind, labelOf, remember: remembered.current };
}
