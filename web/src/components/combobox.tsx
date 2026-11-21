import { Check, ExternalLink, Plus, X } from 'lucide-react';
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useBackToClose } from '@/hooks/use-back-to-close';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import { cn } from '@/lib/utils';

/** `true` di dalam popover chip filter: combobox mulai dengan daftar terbuka (K8). */
export const ComboboxAutoOpenContext = createContext(false);

export interface LinkOption {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface ComboboxCommon {
  id: string;
  label: string;
  /** Hasil pencarian terkini; pencarian dan batas jumlah dikerjakan pemakai lewat `onSearchChange`. */
  options: readonly LinkOption[];
  placeholder?: string;
  /** Opsi sedang dimuat: daftar menampilkan "Memuat…" alih-alih "Tidak ada hasil". */
  loading?: boolean;
  /** Ada hasil lain yang tidak ditampilkan: tampilkan petunjuk "persempit pencarian". */
  hasMore?: boolean;
  onSearchChange?: (term: string) => void;
  /** Jeda (ms) sebelum `onSearchChange` dipanggil; bawaan 200. */
  searchDebounceMs?: number;
  /** Baris "Tambah {label}" di bawah daftar saran, hanya bila disediakan (mis. membuka dialog form master). */
  onCreate?: () => void;
  /** Teks pada baris "Tambah …" bila label field tidak cocok dibaca di sana (bawaan: `label`). */
  createLabel?: string;
  /** Tautan ke record (tab baru); `null` = tidak ada tautan. Mode banyak pilihan: label chip menjadi tautan. */
  openHref?: (id: string) => string | null;
  error?: string;
  disabled?: boolean;
  /** Field wajib: bintang merah pada label dan `aria-required` pada input (validasi tetap lewat zod). */
  required?: boolean;
  /** Label hanya untuk pembaca layar (filter di halaman daftar yang tak punya label tampak). */
  hideLabel?: boolean;
  /** Kelas tambahan untuk pembungkus terluar (mis. lebar kolom filter: `sm:w-56`). */
  className?: string;
  /**
   * Saring `options` di dalam komponen menurut teks yang diketik (label atau deskripsi, tak peka huruf). Dipakai
   * pilihan tetap (`Select`) dan daftar record yang seluruhnya sudah dimuat; bila pemakai mencari ke server lewat
   * `onSearchChange`, jangan dinyalakan.
   */
  localFilter?: boolean;
  /** Tandai potongan label opsi yang cocok dengan yang diketik (`<mark>`). */
  highlight?: boolean;
  /** Daftar pendek yang tak perlu diketik (enum kecil): papan ketik layar tidak dimunculkan saat field diketuk. */
  keyboardless?: boolean;
}

const DEFAULT_DEBOUNCE_MS = 200;
/** Id baris aksi "Tambah" di bawah daftar; bukan id record. */
const CREATE_ID = '__link_field_create__';

/** Tinggi daftar saran paling besar (setara `max-h-60`) dan jarak ke input/tepi layar, dalam piksel. */
const LIST_MAX_HEIGHT = 240;
const LIST_GAP = 4;
const LIST_EDGE = 8;
/** Ruang di bawah input yang masih dianggap cukup untuk membuka daftar ke bawah. */
const LIST_MIN_BELOW = 160;

/** Tinggi satu baris opsi di ponsel (target sentuh) dan jumlah baris minimum agar daftar dibuka di bawah field. */
const PHONE_ROW = 44;
const PHONE_MIN_ROWS = 3;
const PHONE_MAX_HEIGHT = 320;

/** Letak daftar saran di layar (`position: fixed`): di bawah input, atau di atasnya bila ruang bawah sempit. */
export interface ListPlacement {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
  /** Ponsel dengan ruang < 3 baris: daftar menjadi lembar bawah yang menempel tepat di atas papan ketik. */
  sheet?: boolean;
}

export interface PlaceOptions {
  /** Bagian layar yang terlihat (`visualViewport`); papan ketik layar mengecilkannya. Bawaan seluruh layar. */
  visible?: { top: number; bottom: number };
  /** Ponsel: selalu dibuka di bawah field pada ruang di atas papan ketik, atau lembar bawah bila < 3 baris. */
  phone?: boolean;
  viewportWidth?: number;
}

/**
 * Menghitung letak daftar dari kotak input (`rect`) dan tinggi layar. Daftar dirender di `document.body`, bukan di
 * dalam kontainer yang bisa di-scroll (dialog), agar tidak terpotong; karena itu letaknya dihitung sendiri.
 */
export function placeList(
  rect: DOMRect,
  viewportHeight: number,
  options: PlaceOptions = {},
): ListPlacement {
  const visibleBottom = options.visible?.bottom ?? viewportHeight;
  const visibleTop = options.visible?.top ?? 0;
  const below = visibleBottom - rect.bottom - LIST_EDGE - LIST_GAP;
  const above = rect.top - visibleTop - LIST_EDGE - LIST_GAP;
  const base = { left: rect.left, width: rect.width };
  if (options.phone) {
    if (below >= PHONE_ROW * PHONE_MIN_ROWS) {
      return {
        ...base,
        top: rect.bottom + LIST_GAP,
        maxHeight: Math.min(PHONE_MAX_HEIGHT, below),
      };
    }
    const visibleHeight = visibleBottom - visibleTop;
    return {
      left: LIST_EDGE,
      width: (options.viewportWidth ?? rect.left * 2 + rect.width) - LIST_EDGE * 2,
      bottom: viewportHeight - visibleBottom + LIST_EDGE,
      maxHeight: Math.max(
        PHONE_ROW * PHONE_MIN_ROWS,
        Math.min(PHONE_MAX_HEIGHT, visibleHeight * 0.5),
      ),
      sheet: true,
    };
  }
  if (below >= LIST_MIN_BELOW || below >= above) {
    return {
      ...base,
      top: rect.bottom + LIST_GAP,
      maxHeight: Math.max(0, Math.min(LIST_MAX_HEIGHT, below)),
    };
  }
  return {
    ...base,
    bottom: viewportHeight - rect.top + LIST_GAP,
    maxHeight: Math.max(0, Math.min(LIST_MAX_HEIGHT, above)),
  };
}

/** Teks pencarian lokal + panggilan `onSearchChange` yang di-debounce (tidak dipanggil saat mount). */
function useSearchTerm(onSearchChange: ((term: string) => void) | undefined, debounceMs: number) {
  const [term, setTerm] = useState('');
  const notified = useRef('');
  const callback = useRef(onSearchChange);
  callback.current = onSearchChange;

  useEffect(() => {
    if (term === notified.current) return;
    const timer = setTimeout(() => {
      notified.current = term;
      callback.current?.(term);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [term, debounceMs]);

  return [term, setTerm] as const;
}

/** Teks dengan potongan yang cocok dengan kata-kata `term` ditandai `<mark>` (tanpa HTML mentah). */
function Highlighted({ text, term }: { text: string; term: string }) {
  const words = term
    .split(/\s+/)
    .filter((word) => word !== '')
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (words.length === 0) return text;
  const pattern = new RegExp(`(${words.join('|')})`, 'gi');
  return text.split(pattern).map((part, index) =>
    index % 2 === 1 ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: potongan teks statis, urutannya tetap
      <mark key={index} className="rounded-sm bg-warning/40 text-inherit">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

interface Chip {
  id: string;
  label: string;
  href: string | null;
}

export interface ComboboxBaseProps extends ComboboxCommon {
  multi: boolean;
  selectedIds: readonly string[];
  /** Mode satu pilihan: teks nilai terpilih yang tampil di dalam input saat tidak sedang mengetik. */
  displayText: string | null;
  /** Mode banyak pilihan: chip terpilih di dalam bingkai input. */
  chips: readonly Chip[];
  onPick: (id: string) => void;
  onRemove: (id: string) => void;
  /** Mode satu pilihan: tombol X, tautan buka. */
  onClear?: () => void;
  openLink?: string | null;
}

/**
 * Input teks yang sekaligus pencarian: mengetik mencari, daftar saran muncul tepat di bawah input (bukan popover yang
 * menangkap fokus), fokus tetap di input. Nilai selalu record yang sudah ada; teks tanpa pasangan dikosongkan saat
 * input kehilangan fokus. Mode banyak pilihan menaruh chip di dalam bingkai input (Backspace pada input kosong
 * melepas chip terakhir).
 */
export function ComboboxBase({
  id,
  label,
  options,
  placeholder,
  loading,
  hasMore,
  onSearchChange,
  searchDebounceMs,
  onCreate,
  createLabel,
  error,
  disabled,
  multi,
  selectedIds,
  displayText,
  chips,
  onPick,
  onRemove,
  onClear,
  openLink,
  localFilter,
  highlight,
  keyboardless,
  hideLabel,
  required,
  className,
}: ComboboxBaseProps) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  // Di dalam popover chip filter daftar langsung terbuka (satu ketukan lebih sedikit; K8).
  const autoOpen = useContext(ComboboxAutoOpenContext);
  const [open, setOpen] = useState(autoOpen);
  const [editing, setEditing] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [term, setTerm] = useSearchTerm(onSearchChange, searchDebounceMs ?? DEFAULT_DEBOUNCE_MS);

  const selected = new Set(selectedIds);
  const needle = term.trim().toLowerCase();
  const matching =
    localFilter && needle !== ''
      ? options.filter(
          (option) =>
            option.label.toLowerCase().includes(needle) ||
            option.description?.toLowerCase().includes(needle),
        )
      : options;
  const visible = multi ? matching.filter((option) => !selected.has(option.id)) : matching;
  const enabled = visible.filter((option) => !option.disabled);
  const canCreate = Boolean(onCreate) && !disabled;
  // Urutan sorotan keyboard: opsi aktif lalu baris aksi "Tambah" (seperti LinkModel erp).
  const navigable = [...enabled.map((option) => option.id), ...(canCreate ? [CREATE_ID] : [])];
  const activeKey = activeId !== null && navigable.includes(activeId) ? activeId : enabled[0]?.id;
  const active = enabled.find((option) => option.id === activeKey);
  const showList = open && !disabled;
  const optionDomId = (optionId: string) => `${listId}-${optionId}`;

  // Daftar dirender di `document.body` (portal) dengan posisi `fixed` agar tidak terpotong kontainer yang bisa
  // di-scroll (mis. badan dialog); letaknya mengikuti kotak input dan dihitung ulang saat layar/kontainer di-scroll,
  // ukuran berubah, atau jumlah chip (tinggi bingkai) berubah.
  const anchorRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<ListPlacement | null>(null);
  const phone = !useIsDesktop();
  // Lembar bawah (daftar terlalu sempit di atas/bawah): back menutupnya lebih dulu (butir 41b).
  useBackToClose(showList && placement?.sheet === true, close);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `chips.length` hanya memicu ukur ulang saat bingkai membesar
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!showList || !anchor) {
      setPlacement(null);
      return;
    }
    const viewport = window.visualViewport;
    const update = () =>
      setPlacement(
        placeList(anchor.getBoundingClientRect(), window.innerHeight, {
          phone,
          viewportWidth: window.innerWidth,
          ...(viewport && phone
            ? { visible: { top: viewport.offsetTop, bottom: viewport.offsetTop + viewport.height } }
            : {}),
        }),
      );
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    if (phone) {
      viewport?.addEventListener('resize', update);
      viewport?.addEventListener('scroll', update);
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(anchor);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, [showList, chips.length, phone]);

  // Ponsel: saat daftar terbuka, gulirkan field ke bagian atas area terlihat (di bawah header menempel) agar
  // daftar punya ruang di atas papan ketik layar. Hanya sekali per pembukaan.
  const scrolledFor = useRef(false);
  useEffect(() => {
    if (!showList || !phone) {
      scrolledFor.current = false;
      return;
    }
    if (scrolledFor.current) return;
    scrolledFor.current = true;
    anchorRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, [showList, phone]);

  function close() {
    setOpen(false);
    setEditing(false);
    setActiveId(null);
    setTerm('');
  }

  // Escape saat daftar terbuka hanya menutup daftar. Dialog (Radix) mendengar Escape pada `document` di fase capture,
  // jadi `stopPropagation` pada handler React terlambat: pegangan di `window` (capture) lebih dulu.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `close` hanya memakai setter yang stabil
  useEffect(() => {
    if (!showList) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      event.preventDefault();
      close();
    };
    window.addEventListener('keydown', onEscape, true);
    return () => window.removeEventListener('keydown', onEscape, true);
  }, [showList]);

  // Opsi yang disorot keyboard selalu terlihat di dalam daftar yang bisa di-scroll.
  const scrollKey = showList ? activeKey : undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `optionDomId` hanya turunan dari `listId`
  useEffect(() => {
    if (scrollKey === undefined) return;
    document.getElementById(optionDomId(scrollKey))?.scrollIntoView?.({ block: 'nearest' });
  }, [scrollKey]);

  function pick(option: LinkOption) {
    if (option.disabled) return;
    onPick(option.id);
    setEditing(false);
    setActiveId(null);
    setTerm('');
    if (!multi) setOpen(false);
    inputRef.current?.focus();
  }

  function move(step: 1 | -1) {
    if (!showList) {
      if (!disabled) setOpen(true);
      return;
    }
    if (navigable.length === 0) return;
    const index = activeKey === undefined ? -1 : navigable.indexOf(activeKey);
    const next = navigable[(index + step + navigable.length) % navigable.length];
    if (next !== undefined) setActiveId(next);
  }

  function create() {
    close();
    onCreate?.();
  }

  const inputValue = multi || editing ? term : (displayText ?? '');
  const describedBy = error ? `${id}-error` : undefined;

  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id} required={required} className={hideLabel ? 'sr-only' : undefined}>
        {label}
      </Label>
      <div className="flex items-start gap-1">
        <div
          ref={anchorRef}
          className="min-w-0 flex-1 max-md:scroll-mt-[calc(var(--dialog-header-height,var(--headroom-offset,3.5rem))+0.5rem)]"
        >
          {/* biome-ignore lint/a11y/noStaticElementInteractions: bingkai hanya mengarahkan klik ke input di dalamnya */}
          <div
            data-slot="link-field-frame"
            className={cn(
              'flex min-h-8 touch:min-h-11 w-full flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent px-1.5 py-0.5 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30',
              error &&
                'border-destructive focus-within:border-destructive focus-within:ring-destructive/20',
              disabled && 'pointer-events-none cursor-not-allowed opacity-50',
            )}
            onMouseDown={(event) => {
              if ((event.target as HTMLElement).closest('button, a, input')) return;
              event.preventDefault();
              inputRef.current?.focus();
              if (!disabled) setOpen(true);
            }}
          >
            {chips.map((chip) => (
              <span
                key={chip.id}
                className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-sm"
              >
                {chip.href ? (
                  <a
                    href={chip.href}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Buka ${chip.label}`}
                    className="truncate hover:underline"
                  >
                    {chip.label}
                  </a>
                ) : (
                  <span className="truncate">{chip.label}</span>
                )}
                {disabled ? null : (
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={`Hapus ${chip.label}`}
                    className="text-muted-foreground hover:text-foreground touch:-m-[15px] touch:p-[15px]"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onRemove(chip.id)}
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                )}
              </span>
            ))}
            <input
              ref={inputRef}
              id={id}
              type="text"
              role="combobox"
              inputMode={keyboardless ? 'none' : undefined}
              autoComplete="off"
              aria-expanded={showList}
              aria-controls={showList ? listId : undefined}
              aria-autocomplete="list"
              aria-activedescendant={
                showList && activeKey !== undefined ? optionDomId(activeKey) : undefined
              }
              aria-invalid={error ? true : undefined}
              aria-required={required ? true : undefined}
              aria-describedby={describedBy}
              disabled={disabled}
              placeholder={multi && chips.length > 0 ? undefined : placeholder}
              value={inputValue}
              className="h-6 min-w-24 flex-1 bg-transparent px-1 text-base outline-none md:text-sm touch:h-9 placeholder:text-muted-foreground"
              onFocus={(event) => {
                if (!multi) event.currentTarget.select();
              }}
              onClick={(event) => {
                // Setelah klik mouse (caret sudah diletakkan): pilih semua teks nilai agar mengetik langsung mengganti.
                if (!multi && !editing) event.currentTarget.select();
                if (!disabled) setOpen(true);
              }}
              onChange={(event) => {
                setEditing(true);
                setTerm(event.target.value);
                setActiveId(null);
                if (!disabled) setOpen(true);
              }}
              onBlur={close}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  move(1);
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  move(-1);
                } else if (event.key === 'Enter') {
                  // Enter pada daftar terbuka memilih opsi yang disorot dan tidak pernah mengirim form.
                  if (showList) {
                    event.preventDefault();
                    if (activeKey === CREATE_ID) create();
                    else if (active) pick(active);
                  }
                } else if (event.key === 'Backspace' && multi && term === '') {
                  const last = chips.at(-1);
                  if (last) onRemove(last.id);
                }
              }}
            />
            {!multi && onClear && !disabled ? (
              <Button
                type="button"
                variant="ghost"
                color="primary"
                size="icon"
                tabIndex={-1}
                className="size-6"
                aria-label={`Kosongkan ${label}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={onClear}
              >
                <X />
              </Button>
            ) : null}
            {!multi && openLink ? (
              <Button asChild variant="ghost" color="primary" size="icon" className="size-6">
                <a href={openLink} target="_blank" rel="noreferrer" aria-label={`Buka ${label}`}>
                  <ExternalLink />
                </a>
              </Button>
            ) : null}
          </div>
          {showList && placement
            ? createPortal(
                // Di luar dialog Radix: `pointerEvents: auto` (dialog mematikan klik di luar kontennya), dan
                // pointerdown/wheel/touch tidak diteruskan ke `document` supaya dialog tidak menutup atau memblokir gulir.
                <div
                  id={listId}
                  role="listbox"
                  aria-label={label}
                  aria-multiselectable={multi || undefined}
                  data-slot="link-field-list"
                  data-sheet={placement.sheet || undefined}
                  className="fixed z-[60] overflow-y-auto overscroll-contain rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 data-[sheet]:rounded-b-none data-[sheet]:shadow-xl"
                  style={{
                    pointerEvents: 'auto',
                    left: placement.left,
                    width: placement.width,
                    maxHeight: placement.maxHeight,
                    ...(placement.top === undefined ? {} : { top: placement.top }),
                    ...(placement.bottom === undefined ? {} : { bottom: placement.bottom }),
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onWheel={(event) => event.stopPropagation()}
                  onTouchMove={(event) => event.stopPropagation()}
                >
                  {visible.map((option) => (
                    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard ditangani input (ArrowUp/Down/Enter), opsi tidak menerima fokus
                    <div
                      key={option.id}
                      id={optionDomId(option.id)}
                      role="option"
                      tabIndex={-1}
                      aria-selected={selected.has(option.id)}
                      aria-disabled={option.disabled || undefined}
                      className={cn(
                        'flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 select-none touch:min-h-11',
                        option.id === activeKey && 'bg-muted text-foreground',
                        option.disabled && 'pointer-events-none opacity-50',
                      )}
                      // Jangan memindah fokus dari input: blur akan menutup daftar sebelum klik sempat dipilih.
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => {
                        if (!option.disabled) setActiveId(option.id);
                      }}
                      onClick={() => pick(option)}
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">
                          {highlight ? (
                            <Highlighted text={option.label} term={term} />
                          ) : (
                            option.label
                          )}
                        </span>
                        {option.description ? (
                          <span className="truncate text-xs text-muted-foreground">
                            {option.description}
                          </span>
                        ) : null}
                      </span>
                      {selected.has(option.id) ? (
                        <Check className="size-4 shrink-0" aria-hidden />
                      ) : null}
                    </div>
                  ))}
                  {loading ? (
                    <div className="px-2 py-3 text-center text-muted-foreground">Memuat…</div>
                  ) : visible.length === 0 ? (
                    <div className="px-2 py-3 text-center text-muted-foreground">
                      Tidak ada hasil.
                    </div>
                  ) : null}
                  {hasMore ? (
                    <p className="border-t px-2 pt-2 pb-1 text-xs text-muted-foreground">
                      Ada hasil lain, persempit pencarian
                    </p>
                  ) : null}
                  {canCreate ? (
                    <div className="sticky bottom-0 -mx-1 -mb-1 border-t bg-popover p-1">
                      {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard ditangani input (ArrowUp/Down/Enter), baris tidak menerima fokus */}
                      <div
                        id={optionDomId(CREATE_ID)}
                        role="option"
                        tabIndex={-1}
                        aria-selected={false}
                        className={cn(
                          'flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 select-none touch:min-h-11',
                          activeKey === CREATE_ID && 'bg-muted text-foreground',
                        )}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setActiveId(CREATE_ID)}
                        onClick={create}
                      >
                        <Plus className="size-4" aria-hidden />
                        Tambah {createLabel ?? label}
                      </div>
                    </div>
                  ) : null}
                </div>,
                document.body,
              )
            : null}
        </div>
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      ) : null}
      {/* Ponsel: ruang gulir tambahan setinggi daftar agar field bisa naik ke atas area terlihat. */}
      {showList && phone && placement ? (
        <div aria-hidden data-slot="combobox-spacer" style={{ height: placement.maxHeight + 16 }} />
      ) : null}
    </div>
  );
}
