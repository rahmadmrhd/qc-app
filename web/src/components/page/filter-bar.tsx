import { ListFilter, Search, X } from 'lucide-react';
import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import { ComboboxInlineContext } from '@/components/combobox';
import { FilterDraftContext } from '@/components/page/filter-draft';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';

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
 * Teks `display` chip filter banyak pilihan: kosong = `null` (chip belum aktif), satu atau dua nilai disebut semua,
 * selebihnya "{pertama} +N".
 */
export function multiFilterDisplay(labels: readonly string[]): string | null {
  if (labels.length === 0) return null;
  if (labels.length <= 2) return labels.join(', ');
  return `${labels[0]} +${labels.length - 1}`;
}

/**
 * Chip filter: kosong = tombol garis putus dengan ikon filter dan `{label}`; terisi = chip padat "{label}: {display}"
 * dengan tombol hapus. Menekan chip membuka kontrol filter (`children`: `LinkField`, `Select`, dst.): di ponsel
 * (< 768 px) SELALU lembar bawah, di desktop popover. Combobox di dalamnya (`ComboboxInlineContext`) merender
 * daftarnya di tempat, jadi hanya ada SATU lapisan terbuka (tanpa popover/dropdown bersarang; B2, B2c). Memilih satu
 * nilai menutup chip dan langsung diterapkan; kontrol banyak pilihan, tanggal, dan centang menahan perubahannya sebagai
 * draf (`useChipDraft`) dan menerapkannya SEKALI saat chip menutup, lewat jalan apa pun (Esc, klik luar, tombol
 * kembali, seret turun, X; R8, R9). Tombol chip menampilkan nilai lama sampai draf diterapkan.
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
  const phone = useIsMobile();
  const [open, setOpen] = useState(false);
  const drafts = useRef(new Set<() => void>());
  // Menutup = tutup dulu, lalu terapkan semua draf (tiap penguras mengosongkan drafnya sebelum memanggil komit, jadi
  // penutupan ulang oleh navigasi ponsel lewat `runAfterOverlays` tidak mengomit dua kali).
  const close = useCallback(() => {
    setOpen(false);
    for (const flush of [...drafts.current]) flush();
  }, []);
  const inline = useMemo(() => ({ onPicked: close }), [close]);
  const draftApi = useMemo(
    () => ({
      register: (flush: () => void) => {
        drafts.current.add(flush);
        return () => {
          drafts.current.delete(flush);
        };
      },
    }),
    [],
  );
  const onOpenChange = useCallback(
    (next: boolean) => {
      if (next) setOpen(true);
      else close();
    },
    [close],
  );
  const trigger = (
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
          <ListFilter aria-hidden className="size-3.5" />
          <span>{label}</span>
        </>
      )}
    </button>
  );
  const body = (
    <FilterDraftContext.Provider value={draftApi}>
      <ComboboxInlineContext.Provider value={inline}>{children}</ComboboxInlineContext.Provider>
    </FilterDraftContext.Provider>
  );
  return (
    <div
      data-filled={filled || undefined}
      className={
        filled
          ? 'shrink-0 inline-flex h-8 items-center rounded-full border border-info-text/35 bg-info-text/10 text-sm touch:h-11'
          : 'shrink-0 inline-flex h-8 items-center rounded-full border border-dashed text-sm touch:h-11'
      }
    >
      {phone ? (
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetTrigger asChild>{trigger}</SheetTrigger>
          <SheetContent side="bottom" className="max-h-[85dvh]">
            <SheetHeader>
              <SheetTitle>{label}</SheetTitle>
              <SheetDescription className="sr-only">Atur filter {label}.</SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-4">{body}</div>
          </SheetContent>
        </Sheet>
      ) : (
        <Popover open={open} onOpenChange={onOpenChange}>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          <PopoverContent align="start" className="w-72 max-w-[calc(100vw-2rem)]">
            {body}
          </PopoverContent>
        </Popover>
      )}
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
