import type {
  AdjustStockBatchInput,
  RecordStockBatchInput,
  StickerStockDto,
} from '@shared/contract';
import { formatStockQty, STICKER_LIMITS } from '@shared/stickers';
import { useEffect, useMemo, useState } from 'react';
import { useUnsavedChanges } from '@/app/pwa/unsaved-changes';
import { LinkMultiField, type LinkOption } from '@/components/link-field';
import { Select } from '@/components/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { describeError } from '@/lib/api/describe-error';
import { locationsWith } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { useActiveLocations } from '@/modules/location/active-locations-context';
import { LocationField } from '@/modules/location/location-field';
import {
  buildBatchInput,
  type EntryMode,
  type EntryRow,
  emptyEntryRow,
  isEmptyRow,
  newEntryClientId,
  rowError,
  rowWarning,
  summarize,
} from '../lib/entry-rows';
import { STICKER_STATUS_LABEL } from '../lib/status';
import { CountInput } from './count-input';

/** Hasil kirim entri batch gagal: pesan galat server tampil, isian dipertahankan. */
export interface EntryFailure {
  message: string;
}
export type EntrySaveResult = string | EntryFailure | null;

export const ENTRY_MODE_LABEL: Record<EntryMode, string> = {
  in: 'Masuk',
  out: 'Keluar',
  adjust: 'Koreksi',
};

/** Entri yang sudah ditambah: isian + kunci idempoten (K1). */
interface AddedEntry {
  stickerId: string;
  row: EntryRow;
  clientId: string;
}

export interface EntryPageProps {
  /** Id elemen `<form>`: tombol Simpan ada di bar judul `FormPage` (di luar form) dan memakai `form={formId}`. */
  formId: string;
  mode: EntryMode;
  onModeChange: (mode: EntryMode) => void;
  /** Stok terbaru (`stickerStock.list`); baris stok tiap stiker di lokasi yang dipilih menjadi daftar tambah. */
  rows: readonly StickerStockDto[];
  /** Pilihan Koreksi hanya bagi pemegang `stickerstock: manage`. */
  canAdjust: boolean;
  onSave: (
    mode: EntryMode,
    input: RecordStockBatchInput | AdjustStockBatchInput,
  ) => Promise<EntrySaveResult>;
  /** Dipanggil setelah simpan berhasil (biasanya kembali ke halaman Stiker). */
  onDone: () => void;
  /** Ada isian yang belum disimpan? Dipakai rute untuk menahan navigasi keluar. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Proses simpan berjalan atau tidak (untuk tombol Simpan di bar judul). */
  onBusyChange?: (busy: boolean) => void;
  /** Simpan boleh dipencet atau tidak. */
  onSubmittableChange?: (submittable: boolean) => void;
  /** Stiker awal (dari tombol "Entri stok" di View Stiker): mengisi kolom cari dan masuk entri. */
  initialStickerId?: string;
  /**
   * Banyak stiker awal (dari aksi stok massal di katalog Stiker): semuanya langsung masuk entri (maks. `opnameRows`).
   * Satu stiker saja berperilaku seperti `initialStickerId` (kolom cari terisi namanya).
   */
  initialStickerIds?: readonly string[];
}

function qtyAt(row: StickerStockDto, locationId: string): number {
  return row.byLocation.find((entry) => entry.locationId === locationId)?.qty ?? 0;
}

/** Jenis difilter menurut nama (unik tanpa membedakan huruf besar/kecil di server), seperti halaman opname. */
function typeOptionsOf(rows: readonly StickerStockDto[]): LinkOption[] {
  const names = [...new Set(rows.map((row) => row.typeName))].sort((a, b) => a.localeCompare(b));
  return names.map((name) => ({ id: name, label: name }));
}

/**
 * Halaman "Entri stok": mencatat stok masuk, keluar, atau koreksi untuk banyak stiker dalam satu kali kerja (padanan
 * halaman opname). Satu lokasi per entri dan satu alasan per batch; maks. `opnameRows` stiker. Simpan atomik: satu baris
 * ditolak server = tidak ada yang tersimpan, dan isian dipertahankan.
 */
export function EntryPage({
  formId,
  mode,
  onModeChange,
  rows,
  canAdjust,
  onSave,
  onDone,
  onDirtyChange,
  onBusyChange,
  onSubmittableChange,
  initialStickerId,
  initialStickerIds,
}: EntryPageProps) {
  const me = useMe();
  const { selectedIds } = useActiveLocations();
  const level = mode === 'adjust' ? 'manage' : 'edit';
  const writable = locationsWith(me, 'stickerstock', level, selectedIds);
  const [chosenLocation, setLocationId] = useState(
    writable.length === 1 ? (writable[0]?.id ?? '') : '',
  );
  // Mode Koreksi butuh hak lebih tinggi: lokasi yang tak lagi boleh ditulis dianggap belum dipilih.
  const locationId = writable.some((location) => location.id === chosenLocation)
    ? chosenLocation
    : writable.length === 1
      ? (writable[0]?.id ?? '')
      : '';
  // Stiker awal (satu dari View, banyak dari aksi massal): yang tak ada di data stok dilewati; mode Masuk hanya menerima
  // stiker dan jenis aktif (sama dengan daftar pilihan), dan jumlahnya dibatasi `opnameRows`.
  const initialRows = (initialStickerIds ?? (initialStickerId ? [initialStickerId] : []))
    .flatMap((id) => {
      const found = rows.find((row) => row.stickerId === id);
      return found ? [found] : [];
    })
    .filter((row) => mode !== 'in' || (row.status === 'active' && row.typeStatus === 'active'))
    .slice(0, STICKER_LIMITS.opnameRows);
  const [search, setSearch] = useState(
    initialRows.length === 1 ? (initialRows[0]?.name ?? '') : '',
  );
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [added, setAdded] = useState<AddedEntry[]>(() =>
    initialRows.map((row) => ({
      stickerId: row.stickerId,
      row: emptyEntryRow(),
      clientId: newEntryClientId(),
    })),
  );
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Baris awal dari tombol "Entri stok" (View) yang belum diisi bukan isian: keluar tak perlu konfirmasi.
  const dirty = added.some((entry) => !isEmptyRow(entry.row)) || reason.trim() !== '';
  useUnsavedChanges(dirty);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const typeOptions = useMemo(() => typeOptionsOf(rows), [rows]);
  // Masuk: hanya stiker dan jenis AKTIF. Keluar dan Koreksi: juga yang nonaktif/usang selama bersaldo di lokasi ini.
  const eligible = useMemo(
    () =>
      rows.filter((row) =>
        mode === 'in'
          ? row.status === 'active' && row.typeStatus === 'active'
          : row.status === 'active' || (locationId !== '' && qtyAt(row, locationId) !== 0),
      ),
    [rows, mode, locationId],
  );
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return eligible.filter(
      (row) =>
        (typeFilter.length === 0 || typeFilter.includes(row.typeName)) &&
        (term === '' || row.name.toLowerCase().includes(term)),
    );
  }, [eligible, search, typeFilter]);

  // Yang sudah ditambah tetap ikut walau tersaring dari tampilan atau tak lagi memenuhi syarat mode (mis. ganti mode).
  // Urutan kirim = urutan layar (daftar yang tampil dari atas ke bawah, lalu bagian "tidak tampil"), sehingga "Baris N"
  // dari server sama dengan nomor yang tampil di tiap baris isian.
  const addedEntries = added.flatMap((entry) => {
    const row = rows.find((candidate) => candidate.stickerId === entry.stickerId);
    return row ? [{ ...entry, stock: row }] : [];
  });
  const visibleIds = new Set(visible.map((row) => row.stickerId));
  const entries = [
    ...visible.flatMap((row) => addedEntries.filter((entry) => entry.stickerId === row.stickerId)),
    ...addedEntries.filter((entry) => !visibleIds.has(entry.stickerId)),
  ];
  const hiddenEntries = entries.filter((entry) => !visibleIds.has(entry.stickerId));
  const rowErrors = entries.map((entry) => rowError(mode, entry.row));
  const summary = summarize(
    mode,
    entries.map((entry) => entry.row),
  );
  const full = added.length >= STICKER_LIMITS.opnameRows;
  const reasonRequired = mode !== 'in';
  const reasonMissing = reasonRequired && reason.trim() === '';
  const submittable =
    locationId !== '' &&
    entries.length > 0 &&
    rowErrors.every((message) => message === null) &&
    !reasonMissing &&
    !busy;
  useEffect(() => {
    onSubmittableChange?.(submittable);
  }, [submittable, onSubmittableChange]);

  // K1: kunci idempoten dibuat SATU kali saat baris ditambah dan TIDAK diperbarui saat isian diubah. Server
  // membandingkan isi dengan entri tersimpan: kiriman ulang yang sama = hasil lama, isi berbeda dengan kunci yang
  // sudah tersimpan = CONFLICT (aman, tak menggandakan stok), kunci yang belum pernah tersimpan = ditulis biasa.
  // Memperbarui kunci diam-diam setelah kiriman yang responsnya hilang dapat menggandakan stok.
  function changeMode(next: EntryMode) {
    onModeChange(next);
    setError(null);
  }

  function setRow(stickerId: string, row: EntryRow) {
    setAdded((current) =>
      current.map((entry) => (entry.stickerId === stickerId ? { ...entry, row } : entry)),
    );
    setError(null);
  }

  async function submit() {
    if (!submittable) return;
    setBusy(true);
    onBusyChange?.(true);
    let failure: EntryFailure | null;
    try {
      const result = await onSave(
        mode,
        buildBatchInput(
          mode,
          locationId,
          reason,
          entries.map((entry) => ({
            stickerId: entry.stickerId,
            row: entry.row,
            clientId: entry.clientId,
          })),
        ),
      );
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
  }

  function renderRow(stock: StickerStockDto, hiddenFromList: boolean) {
    const entry = added.find((candidate) => candidate.stickerId === stock.stickerId);
    const recorded = qtyAt(stock, locationId);
    const at = entry ? entries.findIndex((e) => e.stickerId === stock.stickerId) : -1;
    const message = at >= 0 ? rowErrors[at] : null;
    const warning = entry ? rowWarning(mode, entry.row, recorded) : null;
    return (
      <li key={stock.stickerId} className="space-y-2 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            {entry && at >= 0 ? (
              <span className="mr-2 text-xs tabular-nums text-muted-foreground">{`Baris ${at + 1}`}</span>
            ) : null}
            <span className="font-medium">{stock.name}</span>
            <span className="ml-2 text-xs text-muted-foreground">{stock.typeName}</span>
            {stock.status === 'active' ? null : (
              <Badge color="secondary" variant="soft" className="ml-2">
                {STICKER_STATUS_LABEL[stock.status]}
              </Badge>
            )}
          </div>
          <span className="text-sm tabular-nums">{`Tercatat ${formatStockQty(recorded)}`}</span>
        </div>
        {entry ? (
          <div className="space-y-2">
            {mode === 'adjust' ? (
              <div className="space-y-1.5">
                <Label htmlFor={`entry-delta-${stock.stickerId}`}>
                  {`Perubahan ${stock.name} (butir)`}
                </Label>
                <Input
                  id={`entry-delta-${stock.stickerId}`}
                  type="number"
                  inputMode="numeric"
                  step={1}
                  placeholder="mis. -5 atau 10"
                  value={entry.row.delta}
                  aria-invalid={message ? true : undefined}
                  onChange={(event) =>
                    setRow(stock.stickerId, { ...entry.row, delta: event.target.value })
                  }
                />
                {Number.isInteger(Number(entry.row.delta)) && entry.row.delta.trim() !== '' ? (
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {`Hasil ${formatStockQty(recorded + Number(entry.row.delta))}`}
                  </p>
                ) : null}
              </div>
            ) : (
              <CountInput
                value={entry.row.count}
                onChange={(count) => setRow(stock.stickerId, { ...entry.row, count })}
              />
            )}
            {message ? (
              <p role="alert" className="text-sm text-destructive-text">
                {message}
              </p>
            ) : null}
            {warning ? <p className="text-sm text-warning-text">{warning}</p> : null}
            {hiddenFromList ? (
              <p className="text-xs text-muted-foreground">
                Tidak tampil di daftar mode atau penyaring ini, tetapi tetap ikut disimpan kecuali
                dibatalkan.
              </p>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              color="primary"
              aria-label={`Batal catat ${stock.name}`}
              onClick={() =>
                setAdded((current) =>
                  current.filter((candidate) => candidate.stickerId !== stock.stickerId),
                )
              }
            >
              Batal catat
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            color="primary"
            aria-label={`Tambah ${stock.name}`}
            disabled={full}
            onClick={() =>
              setAdded((current) => [
                ...current,
                { stickerId: stock.stickerId, row: emptyEntryRow(), clientId: newEntryClientId() },
              ])
            }
          >
            Tambah
          </Button>
        )}
      </li>
    );
  }

  const totalText =
    mode === 'adjust'
      ? `${summary.total > 0 ? '+' : ''}${summary.total} butir (bersih)`
      : `${summary.total} butir`;

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
        Catat stok masuk, keluar, atau koreksi untuk banyak stiker sekaligus di satu lokasi. Semua
        baris disimpan bersama: satu baris ditolak = tidak ada yang tersimpan.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          id="entry-mode"
          label="Jenis entri"
          options={[
            { value: 'in', label: ENTRY_MODE_LABEL.in },
            { value: 'out', label: ENTRY_MODE_LABEL.out },
            ...(canAdjust ? [{ value: 'adjust', label: ENTRY_MODE_LABEL.adjust }] : []),
          ]}
          value={mode}
          onValueChange={(next) => changeMode(next as EntryMode)}
        />
        <LocationField
          id="entry-location"
          highlightInitial
          required
          module="stickerstock"
          level={level}
          value={locationId}
          onChange={(id) => {
            setLocationId(id);
            setError(null);
          }}
        />
      </div>
      {locationId === '' ? (
        <p className="text-sm text-muted-foreground">Pilih lokasi untuk mulai mencatat.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="entry-search">Cari stiker</Label>
              <Input
                id="entry-search"
                type="search"
                placeholder="Ketik nama stiker"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <LinkMultiField
              id="entry-type-filter"
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
              {visible.map((stock) => renderRow(stock, false))}
            </ul>
          )}
          {hiddenEntries.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Sudah ditambah, tidak tampil di daftar</p>
              <ul className="divide-y rounded-md border">
                {hiddenEntries.map((entry) => renderRow(entry.stock, true))}
              </ul>
            </div>
          ) : null}
          {full ? (
            <p className="text-sm text-muted-foreground">
              {`Sudah ${STICKER_LIMITS.opnameRows} stiker, batas satu kali entri. Simpan dulu, lalu lanjutkan entri berikutnya.`}
            </p>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="entry-reason" required={reasonRequired}>
              Alasan
            </Label>
            <Input
              id="entry-reason"
              aria-required={reasonRequired ? 'true' : undefined}
              maxLength={STICKER_LIMITS.reasonMax}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setError(null);
              }}
            />
            <p className="text-xs text-muted-foreground">
              {reasonRequired
                ? 'Satu alasan untuk semua baris; wajib diisi.'
                : 'Satu alasan untuk semua baris; boleh dikosongkan.'}
            </p>
          </div>
          <p className="text-sm font-medium tabular-nums" aria-live="polite">
            {`${summary.stickers} stiker, ${totalText}`}
          </p>
        </>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      ) : null}
      {/* Penerima Enter di kolom isian: tombol Simpan sebenarnya ada di bar judul halaman (di luar form). */}
      <button type="submit" hidden tabIndex={-1} aria-hidden />
    </form>
  );
}
