import { Plus, Search, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { ComboboxAutoOpenContext } from '@/components/combobox';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface FilterBarSearch {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Nama aksesibel kolom cari. */
  label: string;
}

/** Baris filter di bawah judul halaman daftar: kolom cari + chip filter (spek redesain 6.5). */
export function FilterBar({
  search,
  children,
}: {
  search?: FilterBarSearch;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 narrow:flex-col narrow:flex-nowrap narrow:items-stretch">
      {search ? (
        <InputGroup className="w-full sm:w-64">
          <InputGroupAddon>
            <Search aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            value={search.value}
            onChange={(event) => search.onChange(event.target.value)}
            placeholder={search.placeholder}
            aria-label={search.label}
          />
        </InputGroup>
      ) : null}
      {/* Ponsel: chip dalam SATU baris yang digeser horizontal (bar judul tetap pendek); >= 768 px membungkus seperti biasa. */}
      {children ? (
        <div
          data-slot="filter-chips"
          className="flex items-center gap-2 narrow:min-w-0 narrow:overflow-x-auto narrow:pb-1 narrow:[scrollbar-width:none] narrow:[&::-webkit-scrollbar]:hidden wide:contents"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Chip filter: kosong = tombol garis putus "+ {label}"; terisi = chip padat "{label}: {display}" dengan tombol
 * hapus. Klik chip membuka popover berisi kontrol filter (`children`: `LinkField`, `Select`, dst.).
 */
export function FilterChip({
  label,
  display,
  onClear,
  children,
}: {
  label: string;
  display?: string | null;
  onClear?: () => void;
  children: ReactNode;
}) {
  const filled = display !== undefined && display !== null && display !== '';
  return (
    <div
      data-filled={filled || undefined}
      className={
        filled
          ? 'shrink-0 inline-flex h-8 items-center rounded-full border border-info-text/35 bg-info-text/10 text-sm touch:h-11'
          : 'shrink-0 inline-flex h-8 items-center rounded-full border border-dashed text-sm touch:h-11'
      }
    >
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex h-full items-center gap-1 rounded-full px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {filled ? (
              <span>
                {label}: <strong className="font-medium text-info-text">{display}</strong>
              </span>
            ) : (
              <>
                <Plus aria-hidden className="size-3.5" />
                <span>{label}</span>
              </>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 max-w-[calc(100vw-2rem)]">
          <ComboboxAutoOpenContext.Provider value>{children}</ComboboxAutoOpenContext.Provider>
        </PopoverContent>
      </Popover>
      {filled && onClear ? (
        <button
          type="button"
          onClick={onClear}
          aria-label={`Hapus filter ${label}`}
          className="mr-1 inline-flex size-6 touch:size-9 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-info-text/15 focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
