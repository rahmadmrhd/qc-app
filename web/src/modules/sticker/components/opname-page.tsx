import type { OpnameInput, StickerStockDto } from '@shared/contract';
import { formatStockQty, piecesOfCount, STICKER_LIMITS, type StockCount } from '@shared/stickers';
import { useEffect, useMemo, useState } from 'react';
import { useUnsavedChanges } from '@/app/pwa/unsaved-changes';
import { LinkMultiField, type LinkOption } from '@/components/link-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { describeError } from '@/lib/api/describe-error';
import { locationsWith } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { useActiveLocations } from '@/modules/location/active-locations-context';
import { LocationField } from '@/modules/location/location-field';
import { STICKER_STATUS_LABEL } from '../lib/status';
import { CountInput, cleanCount, emptyCount } from './count-input';

/** Hasil kirim opname: `stale` = stok berubah sejak dihitung (seluruh permintaan ditolak server). */
export interface OpnameFailure {
  message: string;
  stale?: boolean;
}
export type OpnameSaveResult = string | OpnameFailure | null;

/** Pesan opname usang dari server (409 CONFLICT pada rute tanpa If-Match). */
export const OPNAME_STALE_MESSAGE = 'Stok berubah sejak dihitung; hitung ulang';

export interface OpnamePageProps {
  /** Id elemen `<form>`: tombol Simpan ada di bar judul `FormPage` (di luar form) dan memakai `form={formId}`. */
  formId: string;
  /** Stok terbaru yang dilihat halaman; salinannya saat dibuka menjadi `expectedQty` tiap baris. */
  rows: readonly StickerStockDto[];
  onSave: (input: OpnameInput) => Promise<OpnameSaveResult>;
  /** Dipanggil setelah simpan berhasil (biasanya kembali ke halaman Stiker). */
  onDone: () => void;
  /** Ada hitungan yang belum disimpan? Dipakai rute untuk menahan navigasi keluar. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Proses simpan berjalan atau tidak (untuk tombol Simpan di bar judul). */
  onBusyChange?: (busy: boolean) => void;
  /** Simpan boleh dipencet atau tidak (ada hitungan sah, tidak melebihi batas, tidak usang). */
  onSubmittableChange?: (submittable: boolean) => void;
  /** Kata kunci awal kolom cari (mis. nama stiker dari tombol "Stok opname" di View Stiker). */
  initialSearch?: string;
}

function qtyAt(row: StickerStockDto, locationId: string): number {
  return row.byLocation.find((entry) => entry.locationId === locationId)?.qty ?? 0;
}

/** Nama jenis dipakai sebagai id opsi filter: unik tanpa membedakan huruf besar/kecil di server (`sticker_types_name_unique`). */
function typeOptionsOf(rows: readonly StickerStockDto[]): LinkOption[] {
  const names = [...new Set(rows.map((row) => row.typeName))].sort((a, b) => a.localeCompare(b));
  return names.map((name) => ({ id: name, label: name }));
}

/**
 * Halaman stok opname: pilih lokasi, hitung stiker (lembar x isi + butir), tetapkan stok menjadi hasil hitung.
 * Daftar dapat dicari menurut nama dan disaring menurut jenis (banyak jenis); hitungan disimpan per stiker sehingga
 * stiker yang tersaring keluar dari tampilan tetap ikut tersimpan.
 */
export function OpnamePage({
  formId,
  rows,
  onSave,
  onDone,
  onDirtyChange,
  onBusyChange,
  onSubmittableChange,
  initialSearch = '',
}: OpnamePageProps) {
  const me = useMe();
  const { selectedIds } = useActiveLocations();
  const writable = locationsWith(me, 'stickerstock', 'manage', selectedIds);
  const [locationId, setLocationId] = useState(
    writable.length === 1 ? (writable[0]?.id ?? '') : '',
  );
  // Stok yang dilihat penghitung: salinan saat halaman dibuka (atau saat "Hitung ulang"), bukan data yang berubah-ubah.
  const [snapshot, setSnapshot] = useState(rows);
  const [counts, setCounts] = useState<Record<string, StockCount>>({});
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState(initialSearch);
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const dirty = Object.keys(counts).length > 0;
  useUnsavedChanges(dirty);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const typeOptions = useMemo(() => typeOptionsOf(snapshot), [snapshot]);
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return snapshot.filter(
      (row) =>
        (typeFilter.length === 0 || typeFilter.includes(row.typeName)) &&
        (term === '' || row.name.toLowerCase().includes(term)),
    );
  }, [snapshot, search, typeFilter]);

  // Semua yang dihitung ikut dikirim, juga yang sedang tersaring dari tampilan.
  const counted = snapshot.filter((row) => counts[row.stickerId] !== undefined);
  const tooMany = counted.length > STICKER_LIMITS.opnameRows;
  // Total butir hasil hitung tiap baris dibatasi seperti di server; baris yang melebihi ditandai dan memblokir kirim.
  const overLimitRows = counted.filter(
    (row) => piecesOfCount(cleanCount(counts[row.stickerId] as StockCount)) > STICKER_LIMITS.qtyMax,
  );
  const canSubmit =
    locationId !== '' && counted.length > 0 && !tooMany && overLimitRows.length === 0 && !busy;

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

  const submittable = canSubmit && !stale;
  useEffect(() => {
    onSubmittableChange?.(submittable);
  }, [submittable, onSubmittableChange]);

  async function submit() {
    if (!submittable) return;
    setBusy(true);
    onBusyChange?.(true);
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
    onBusyChange?.(false);
    if (failure === null) {
      onDone();
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
      id={formId}
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void submit();
      }}
    >
      <p className="text-sm text-muted-foreground">
        Hitung stok fisik di satu lokasi. Simpan menetapkan stok tiap stiker yang dihitung menjadi
        hasil hitung.
      </p>
      <LocationField
        id="opname-location"
        highlightInitial
        module="stickerstock"
        level="manage"
        value={locationId}
        onChange={changeLocation}
      />
      {locationId === '' ? (
        <p className="text-sm text-muted-foreground">Pilih lokasi untuk mulai menghitung.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="opname-search">Cari stiker</Label>
              <Input
                id="opname-search"
                type="search"
                placeholder="Ketik nama stiker"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <LinkMultiField
              id="opname-type-filter"
              label="Jenis stiker"
              placeholder="Semua jenis"
              value={typeFilter}
              labelOf={(id) => id}
              options={typeOptions}
              localFilter
              highlight
              onChange={setTypeFilter}
            />
          </div>
          {visible.length === 0 ? (
            <p className="rounded-md border p-3 text-sm text-muted-foreground">
              Tidak ada stiker yang cocok.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {visible.map((row) => {
                const recorded = qtyAt(row, locationId);
                const count = counts[row.stickerId];
                const pieces = count ? piecesOfCount(cleanCount(count)) : 0;
                const difference = pieces - recorded;
                return (
                  <li key={row.stickerId} className="space-y-2 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-medium">{row.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{row.typeName}</span>
                        {row.status === 'active' ? null : (
                          <Badge color="secondary" variant="soft" className="ml-2">
                            {STICKER_STATUS_LABEL[row.status]}
                          </Badge>
                        )}
                      </div>
                      <span className="text-sm tabular-nums">{`Tercatat ${formatStockQty(recorded)}`}</span>
                    </div>
                    {count ? (
                      <div className="space-y-2">
                        <CountInput
                          value={count}
                          onChange={(next) => setCount(row.stickerId, next)}
                        />
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
        </>
      )}
      <p className="text-xs text-muted-foreground">
        Hanya stiker yang dihitung yang diubah; stok ditetapkan menjadi hasil hitung. Stiker yang
        tidak dihitung tidak disentuh.
        {counted.length > 0 ? ` Sudah dihitung: ${counted.length} stiker.` : ''}
      </p>
      {tooMany ? (
        <p role="alert" className="text-sm text-destructive-text">
          {`Maksimal ${STICKER_LIMITS.opnameRows} stiker per opname.`}
        </p>
      ) : null}
      {/* Di luar daftar agar baris yang tersaring dari tampilan tetap terlihat masalahnya. */}
      {overLimitRows.map((row) => (
        <p key={row.stickerId} role="alert" className="text-sm text-destructive-text">
          {`${row.name}: jumlah butir maksimal ${STICKER_LIMITS.qtyMax}`}
        </p>
      ))}
      {error ? (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      ) : null}
      {stale ? (
        <Button type="button" onClick={recount}>
          Hitung ulang
        </Button>
      ) : null}
      {/* Penerima Enter di kolom isian: tombol Simpan sebenarnya ada di bar judul halaman (di luar form). */}
      <button type="submit" hidden tabIndex={-1} aria-hidden />
    </form>
  );
}
