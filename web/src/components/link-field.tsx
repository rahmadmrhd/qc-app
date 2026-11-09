import { Check, ExternalLink, Plus, X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export interface LinkOption {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

interface LinkFieldCommon {
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
  /** Tombol "Tambah" tampil hanya bila disediakan (mis. membuka dialog form master). */
  onCreate?: () => void;
  /** Tautan ke record (tab baru); `null` = tidak ada tautan. */
  openHref?: (id: string) => string | null;
  error?: string;
  disabled?: boolean;
}

export interface LinkFieldProps extends LinkFieldCommon {
  value: string | null;
  onChange: (id: string | null) => void;
  /** Label nilai terpilih yang bisa tak ada lagi di `options` (mis. tersaring pencarian). */
  labelOf?: (id: string) => string | undefined;
}

export interface LinkMultiFieldProps extends LinkFieldCommon {
  value: readonly string[];
  onChange: (ids: string[]) => void;
  labelOf: (id: string) => string;
}

const DEFAULT_DEBOUNCE_MS = 200;

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

interface Chip {
  id: string;
  label: string;
  href: string | null;
}

interface BaseProps extends LinkFieldCommon {
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
function LinkFieldBase({
  id,
  label,
  options,
  placeholder,
  loading,
  hasMore,
  onSearchChange,
  searchDebounceMs,
  onCreate,
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
}: BaseProps) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [term, setTerm] = useSearchTerm(onSearchChange, searchDebounceMs ?? DEFAULT_DEBOUNCE_MS);

  const selected = new Set(selectedIds);
  const visible = multi ? options.filter((option) => !selected.has(option.id)) : options;
  const enabled = visible.filter((option) => !option.disabled);
  const active = enabled.find((option) => option.id === activeId) ?? enabled[0];
  const showList = open && !disabled;
  const optionDomId = (optionId: string) => `${listId}-${optionId}`;

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
  const activeKey = showList ? active?.id : undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `optionDomId` hanya turunan dari `listId`
  useEffect(() => {
    if (activeKey === undefined) return;
    document.getElementById(optionDomId(activeKey))?.scrollIntoView?.({ block: 'nearest' });
  }, [activeKey]);

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
    if (enabled.length === 0) return;
    const index = active ? enabled.indexOf(active) : -1;
    const next = enabled[(index + step + enabled.length) % enabled.length];
    if (next) setActiveId(next.id);
  }

  const inputValue = multi || editing ? term : (displayText ?? '');
  const describedBy = error ? `${id}-error` : undefined;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-start gap-1">
        <div className="relative min-w-0 flex-1">
          {/* biome-ignore lint/a11y/noStaticElementInteractions: bingkai hanya mengarahkan klik ke input di dalamnya */}
          <div
            data-slot="link-field-frame"
            className={cn(
              'flex min-h-8 w-full flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent px-1.5 py-0.5 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30',
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
                <span className="truncate">{chip.label}</span>
                {chip.href ? (
                  <a
                    href={chip.href}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Buka ${chip.label}`}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                ) : null}
                {disabled ? null : (
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={`Hapus ${chip.label}`}
                    className="text-muted-foreground hover:text-foreground"
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
              autoComplete="off"
              aria-expanded={showList}
              aria-controls={showList ? listId : undefined}
              aria-autocomplete="list"
              aria-activedescendant={showList && active ? optionDomId(active.id) : undefined}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy}
              disabled={disabled}
              placeholder={multi && chips.length > 0 ? undefined : placeholder}
              value={inputValue}
              className="h-6 min-w-24 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
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
                    if (active) pick(active);
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
              <Button asChild variant="ghost" size="icon" className="size-6">
                <a href={openLink} target="_blank" rel="noreferrer" aria-label={`Buka ${label}`}>
                  <ExternalLink />
                </a>
              </Button>
            ) : null}
            {onCreate && !disabled ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                tabIndex={-1}
                className="size-6"
                aria-label={`Tambah ${label}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={onCreate}
              >
                <Plus />
              </Button>
            ) : null}
          </div>
          {showList ? (
            <div
              id={listId}
              role="listbox"
              aria-label={label}
              aria-multiselectable={multi || undefined}
              className="absolute top-full right-0 left-0 z-50 mt-1 max-h-60 overflow-y-auto rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10"
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
                    'flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 select-none',
                    option.id === active?.id && 'bg-muted text-foreground',
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
                    <span className="truncate">{option.label}</span>
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
                <div className="px-2 py-3 text-center text-muted-foreground">Tidak ada hasil.</div>
              ) : null}
              {hasMore ? (
                <p className="border-t px-2 pt-2 pb-1 text-xs text-muted-foreground">
                  Ada hasil lain, persempit pencarian
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Pilih SATU record yang sudah ada. Tombol X mengosongkan; panah membuka record; Tambah membuat baru. */
export function LinkField({ value, onChange, labelOf, openHref, ...common }: LinkFieldProps) {
  const text =
    value === null
      ? null
      : (labelOf?.(value) ?? common.options.find((option) => option.id === value)?.label ?? value);
  return (
    <LinkFieldBase
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

/** Pilih BANYAK record; nilai terpilih tampil sebagai chip di dalam bingkai input. */
export function LinkMultiField({
  value,
  onChange,
  labelOf,
  openHref,
  ...common
}: LinkMultiFieldProps): ReactNode {
  return (
    <LinkFieldBase
      {...common}
      multi
      selectedIds={value}
      displayText={null}
      chips={value.map((chipId) => ({
        id: chipId,
        label: labelOf(chipId),
        href: openHref?.(chipId) ?? null,
      }))}
      onPick={(picked) => onChange([...value, picked])}
      onRemove={(removed) => onChange(value.filter((existing) => existing !== removed))}
    />
  );
}
