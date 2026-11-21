import { Check } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useActiveLocations } from '../active-locations-context';

/**
 * Lembar pemilih lokasi aktif untuk ponsel (butir 42d): daftar centang, "Pilih semua", dan "Terapkan (n)" yang
 * nonaktif bila tak ada pilihan. Pilihan baru baru berlaku saat Terapkan; logikanya (normalisasi, penyimpanan)
 * adalah milik `ActiveLocationsProvider` yang sama dengan pemilih header desktop.
 */
export function LocationSheet({
  open,
  onOpenChange,
  tourProps,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sebar ke `SheetContent` (mis. `data-tour` dan penjaga tur). */
  tourProps?: Record<string, unknown>;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[85dvh] rounded-t-xl pb-[env(safe-area-inset-bottom)]"
        {...tourProps}
      >
        {/* Draf pilihan dibuat ulang tiap lembar dibuka (komponen isi dipasang saat terbuka). */}
        {open ? <SheetBody onDone={() => onOpenChange(false)} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function SheetBody({ onDone }: { onDone: () => void }) {
  const { available, selectedIds, select } = useActiveLocations();
  const [draft, setDraft] = useState<string[]>(() => [...selectedIds]);
  const allChosen = draft.length === available.length;
  const toggle = (id: string) =>
    setDraft((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  return (
    <>
      <SheetHeader>
        <SheetTitle>Lokasi aktif</SheetTitle>
        <SheetDescription>
          Daftar di halaman (papan, stok, dan lainnya) mengikuti lokasi yang dicentang.
        </SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-1 overflow-y-auto px-4">
        {available.length === 0 ? (
          <p className="py-2 text-sm text-warning-text">
            Belum ada lokasi untuk akun ini. Hubungi admin.
          </p>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              color="primary"
              className="justify-start text-sm"
              onClick={() => setDraft(allChosen ? [] : available.map((location) => location.id))}
            >
              {allChosen ? 'Kosongkan pilihan' : 'Pilih semua'}
            </Button>
            {available.map((location) => {
              const inputId = `loc-sheet-${location.id}`;
              return (
                <label
                  key={location.id}
                  htmlFor={inputId}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-muted"
                >
                  <Checkbox
                    id={inputId}
                    checked={draft.includes(location.id)}
                    onCheckedChange={() => toggle(location.id)}
                  />
                  <span className="min-w-0 flex-1 truncate">{location.name}</span>
                  <span className="text-muted-foreground">({location.code})</span>
                </label>
              );
            })}
          </>
        )}
      </div>
      <SheetFooter>
        <Button
          type="button"
          disabled={draft.length === 0}
          onClick={() => {
            select(draft);
            onDone();
          }}
        >
          <Check aria-hidden />
          Terapkan ({draft.length})
        </Button>
      </SheetFooter>
    </>
  );
}
