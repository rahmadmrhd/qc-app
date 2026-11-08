import { ChevronsUpDown, ExternalLink, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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

interface PickerProps extends LinkFieldCommon {
  options: readonly LinkOption[];
  selectedId: string | null;
  triggerText: string | null;
  describedBy: string | undefined;
  onPick: (id: string) => void;
  /** Tetap terbuka setelah memilih (mode banyak pilihan). */
  keepOpen: boolean;
}

function Picker({
  id,
  label,
  options,
  placeholder,
  loading,
  hasMore,
  onSearchChange,
  searchDebounceMs,
  error,
  disabled,
  selectedId,
  triggerText,
  describedBy,
  onPick,
  keepOpen,
}: PickerProps) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useSearchTerm(onSearchChange, searchDebounceMs ?? DEFAULT_DEBOUNCE_MS);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // Teks yang tak dipilih tidak menjadi nilai: dikosongkan saat daftar ditutup.
    if (!next) setTerm('');
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          disabled={disabled}
          className={cn(
            'min-w-0 flex-1 justify-between font-normal',
            triggerText === null && 'text-muted-foreground',
          )}
        >
          <span className="truncate">{triggerText ?? placeholder ?? `Pilih ${label}`}</span>
          <ChevronsUpDown className="size-4 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-64 gap-0 p-0"
      >
        <Command shouldFilter={false} label={`Cari ${label}`}>
          <CommandInput placeholder="Cari…" value={term} onValueChange={setTerm} />
          <CommandList>
            {loading ? (
              <div className="py-6 text-center text-sm text-muted-foreground">Memuat…</div>
            ) : (
              <CommandEmpty>Tidak ada hasil.</CommandEmpty>
            )}
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.id}
                  value={option.id}
                  disabled={option.disabled}
                  data-checked={option.id === selectedId ? 'true' : undefined}
                  onSelect={() => {
                    onPick(option.id);
                    if (!keepOpen) handleOpenChange(false);
                  }}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{option.label}</span>
                    {option.description ? (
                      <span className="truncate text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {hasMore ? (
            <p className="border-t px-3 py-2 text-xs text-muted-foreground">
              Ada hasil lain, persempit pencarian
            </p>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function FieldFrame({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Pilih SATU record yang sudah ada. Tombol X mengosongkan; panah membuka record; Tambah membuat baru. */
export function LinkField(props: LinkFieldProps) {
  const { id, label, value, onChange, labelOf, options, openHref, onCreate, disabled, error } =
    props;
  const href = value !== null ? (openHref?.(value) ?? null) : null;
  const text =
    value === null
      ? null
      : (labelOf?.(value) ?? options.find((o) => o.id === value)?.label ?? value);
  return (
    <FieldFrame id={id} label={label} error={error}>
      <div className="flex items-center gap-1">
        <Picker
          {...props}
          selectedId={value}
          triggerText={text}
          describedBy={error ? `${id}-error` : undefined}
          onPick={(picked) => onChange(picked)}
          keepOpen={false}
        />
        {value !== null && !disabled ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Kosongkan ${label}`}
            onClick={() => onChange(null)}
          >
            <X />
          </Button>
        ) : null}
        {href ? (
          <Button asChild variant="ghost" size="icon">
            <a href={href} target="_blank" rel="noreferrer" aria-label={`Buka ${label}`}>
              <ExternalLink />
            </a>
          </Button>
        ) : null}
        {onCreate && !disabled ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={`Tambah ${label}`}
            onClick={onCreate}
          >
            <Plus />
          </Button>
        ) : null}
      </div>
    </FieldFrame>
  );
}

/** Pilih BANYAK record; nilai terpilih tampil sebagai chip yang bisa dilepas. */
export function LinkMultiField(props: LinkMultiFieldProps) {
  const { id, label, value, onChange, labelOf, options, openHref, onCreate, disabled, error } =
    props;
  const selected = new Set(value);
  return (
    <FieldFrame id={id} label={label} error={error}>
      <div className="flex items-center gap-1">
        <Picker
          {...props}
          options={options.filter((option) => !selected.has(option.id))}
          selectedId={null}
          triggerText={null}
          describedBy={error ? `${id}-error` : undefined}
          onPick={(picked) => onChange([...value, picked])}
          keepOpen
        />
        {onCreate && !disabled ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={`Tambah ${label}`}
            onClick={onCreate}
          >
            <Plus />
          </Button>
        ) : null}
      </div>
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={`${label} terpilih`}>
          {value.map((chipId) => {
            const chipLabel = labelOf(chipId);
            const href = openHref?.(chipId) ?? null;
            return (
              <li
                key={chipId}
                className="inline-flex items-center gap-1 rounded-md border bg-muted px-2 py-0.5 text-sm"
              >
                <span>{chipLabel}</span>
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Buka ${chipLabel}`}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                ) : null}
                {disabled ? null : (
                  <button
                    type="button"
                    aria-label={`Hapus ${chipLabel}`}
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => onChange(value.filter((existing) => existing !== chipId))}
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </FieldFrame>
  );
}
