import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { RejectedFile } from './types';

/** Panel berkas yang ditolak saat masuk (nama + alasan), dengan tombol tutup. Kosong = tidak tampil. */
export function RejectedList({
  items,
  onClear,
}: {
  items: readonly RejectedFile[];
  onClear(): void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-destructive-text">
          {items.length} berkas tidak dapat ditambahkan
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Tutup daftar berkas ditolak"
          onClick={onClear}
        >
          <X />
        </Button>
      </div>
      <ul aria-label="Berkas ditolak" className="mt-1 space-y-0.5">
        {items.map((item, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: nama berkas boleh kembar
          <li key={`${item.name}-${index}`} className="break-words">
            <span className="font-medium">{item.name}</span>
            <span className="text-muted-foreground"> — {item.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
