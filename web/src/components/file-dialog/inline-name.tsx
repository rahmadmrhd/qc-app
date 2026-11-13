import { useRef, useState } from 'react';
import { useUnsavedChanges } from '@/app/pwa/unsaved-changes';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface InlineNameProps {
  value: string;
  /** Dipanggil hanya bila nama (setelah dipangkas) tidak kosong dan berubah. */
  onSave(name: string): void;
  maxLength?: number;
  /** Tidak dapat diubah: nama tampil sebagai teks biasa. */
  readOnly?: boolean;
  className?: string;
}

/** Nama yang dapat diklik untuk diubah di tempat: Enter atau keluar fokus menyimpan, Esc membatalkan. */
export function InlineName({ value, onSave, maxLength, readOnly, className }: InlineNameProps) {
  const [draft, setDraft] = useState<string | null>(null);
  // Esc menutup editor lalu fokus lepas: blur sesudahnya tidak boleh menyimpan.
  const settled = useRef(false);
  // Nama yang sedang diketik dan berbeda dari nilai tersimpan belum disimpan (FR-P13).
  useUnsavedChanges(draft !== null && draft.trim() !== value);

  if (readOnly) {
    return (
      <span className={cn('truncate', className)} title={value}>
        {value}
      </span>
    );
  }

  if (draft === null) {
    return (
      <button
        type="button"
        aria-label={`Ubah nama ${value}`}
        title={`${value} (klik untuk mengubah nama)`}
        className={cn(
          'min-w-0 truncate rounded-sm text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring',
          className,
        )}
        onClick={() => {
          settled.current = false;
          setDraft(value);
        }}
      >
        {value}
      </button>
    );
  }

  function commit() {
    if (settled.current) return;
    settled.current = true;
    const next = (draft ?? '').trim();
    setDraft(null);
    if (next !== '' && next !== value) onSave(next);
  }

  return (
    <Input
      autoFocus
      aria-label="Nama"
      value={draft}
      maxLength={maxLength}
      className={cn('h-7 min-w-0', className)}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => event.target.select()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        } else if (event.key === 'Escape') {
          // Jangan menutup dialog induk.
          event.stopPropagation();
          settled.current = true;
          setDraft(null);
        }
      }}
      onBlur={commit}
    />
  );
}
