import type { OpnameInput, StickerStockDto } from '@shared/contract';
import { piecesOfCount, STICKER_LIMITS, type StockCount } from '@shared/stickers';
import { useState } from 'react';
import {
  FormDialog,
  FormDialogContent,
  FormDialogDescription,
  FormDialogFooter,
  FormDialogHeader,
  FormDialogTitle,
} from '@/components/form-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { describeError } from '@/lib/api/describe-error';
import { locationsWith } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { useActiveLocations } from '@/modules/location/active-locations-context';
import { LocationField } from '@/modules/location/location-field';
import { CountInput, cleanCount, emptyCount } from './count-input';

/** Hasil kirim opname: `stale` = stok berubah sejak dihitung (seluruh permintaan ditolak server). */
export interface OpnameFailure {
  message: string;
  stale?: boolean;
}
export type OpnameSaveResult = string | OpnameFailure | null;

/** Pesan opname usang dari server (409 CONFLICT pada rute tanpa If-Match). */
export const OPNAME_STALE_MESSAGE = 'Stok berubah sejak dihitung; hitung ulang';

export interface OpnameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Stok terbaru yang dilihat halaman; salinannya saat dibuka menjadi `expectedQty` tiap baris. */
  rows: readonly StickerStockDto[];
  onSave: (input: OpnameInput) => Promise<OpnameSaveResult>;
}

interface BodyProps {
  rows: readonly StickerStockDto[];
  onSave: OpnameDialogProps['onSave'];
  onClose: () => void;
}

function qtyAt(row: StickerStockDto, locationId: string): number {
  return row.byLocation.find((entry) => entry.locationId === locationId)?.qty ?? 0;
}

/** Terpasang hanya saat dialog terbuka, sehingga hitungan dan galat selalu mulai bersih. */
function OpnameBody({ rows, onSave, onClose }: BodyProps) {
  const me = useMe();
  const { selectedIds } = useActiveLocations();
  const writable = locationsWith(me, 'stickerstock', 'manage', selectedIds);
  const [locationId, setLocationId] = useState(
    writable.length === 1 ? (writable[0]?.id ?? '') : '',
  );
  // Stok yang dilihat penghitung: salinan saat dialog dibuka (atau saat "Hitung ulang"), bukan data yang berubah-ubah.
  const [snapshot, setSnapshot] = useState(rows);
  const [counts, setCounts] = useState<Record<string, StockCount>>({});
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);

  const counted = snapshot.filter((row) => counts[row.stickerId] !== undefined);
  const tooMany = counted.length > STICKER_LIMITS.opnameRows;
  const canSubmit = locationId !== '' && counted.length > 0 && !tooMany && !busy;

  function changeLocation(id: string) {
    setLocationId(id);
    // Stok tercatat berbeda per lokasi: hitungan lokasi sebelumnya tidak berlaku lagi.
    setCounts({});
    setError(null);
  }

  function setCount(stickerId: string, next: StockCount | undefined) {
    setCounts((current) => {
      const copy = { ...current };
      if (next === undefined) delete copy[stickerId];
      else copy[stickerId] = next;
      return copy;
    });
    setError(null);
  }

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    let failure: OpnameFailure | null;
    try {
      const result = await onSave({
        rows: counted.map((row) => ({
          stickerId: row.stickerId,
          locationId,
          expectedQty: qtyAt(row, locationId),
          count: cleanCount(counts[row.stickerId] as StockCount),
        })),
      });
      failure = typeof result === 'string' ? { message: result } : result;
    } catch (cause) {
      failure = { message: describeError(cause) };
    }
    setBusy(false);
    if (failure === null) {
      onClose();
      return;
    }
    setError(failure.message);
    setStale(failure.stale === true);
  }

  function recount() {
    setSnapshot(rows);
    setCounts({});
    setError(null);
    setStale(false);
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void submit();
      }}
    >
      <LocationField
        id="opname-location"
        module="stickerstock"
        level="manage"
        value={locationId}
        onChange={changeLocation}
      />
      {locationId === '' ? (
        <p className="text-sm text-muted-foreground">Pilih lokasi untuk mulai menghitung.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {snapshot.map((row) => {
            const recorded = qtyAt(row, locationId);
            const count = counts[row.stickerId];
            const difference = count ? piecesOfCount(cleanCount(count)) - recorded : 0;
            return (
              <li key={row.stickerId} className="space-y-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-medium">{row.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{row.typeName}</span>
                    {row.status === 'inactive' ? (
                      <Badge variant="secondary" className="ml-2">
                        Nonaktif
                      </Badge>
                    ) : null}
                  </div>
                  <span className="text-sm tabular-nums">{`Tercatat ${recorded}`}</span>
                </div>
                {count ? (
                  <div className="space-y-2">
                    <CountInput value={count} onChange={(next) => setCount(row.stickerId, next)} />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium tabular-nums">
                        {`Selisih ${difference > 0 ? '+' : ''}${difference}`}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`Batal hitung ${row.name}`}
                        onClick={() => setCount(row.stickerId, undefined)}
                      >
                        Batal hitung
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-label={`Hitung ${row.name}`}
                    onClick={() => setCount(row.stickerId, emptyCount())}
                  >
                    Hitung
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Hanya stiker yang dihitung yang diubah; stok ditetapkan menjadi hasil hitung. Stiker yang
        tidak dihitung tidak disentuh.
      </p>
      {tooMany ? (
        <p role="alert" className="text-sm text-destructive">
          {`Maksimal ${STICKER_LIMITS.opnameRows} stiker per opname.`}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <FormDialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Batal
        </Button>
        {stale ? (
          <Button type="button" onClick={recount}>
            Hitung ulang
          </Button>
        ) : (
          <Button type="submit" disabled={!canSubmit}>
            {busy ? 'Menyimpan…' : 'Simpan opname'}
          </Button>
        )}
      </FormDialogFooter>
    </form>
  );
}

/** Dialog stok opname: pilih lokasi, hitung stiker (lembar x isi + lepas), tetapkan stok menjadi hasil hitung. */
export function OpnameDialog({ open, onOpenChange, rows, onSave }: OpnameDialogProps) {
  return (
    <FormDialog open={open} onOpenChange={onOpenChange}>
      <FormDialogContent className="max-h-[90vh] overflow-y-auto data-[size=default]:sm:max-w-2xl">
        <FormDialogHeader>
          <FormDialogTitle>Stok opname</FormDialogTitle>
          <FormDialogDescription>
            Hitung stok fisik di satu lokasi. Simpan menetapkan stok tiap stiker yang dihitung
            menjadi hasil hitung.
          </FormDialogDescription>
        </FormDialogHeader>
        {open ? (
          <OpnameBody rows={rows} onSave={onSave} onClose={() => onOpenChange(false)} />
        ) : null}
      </FormDialogContent>
    </FormDialog>
  );
}
