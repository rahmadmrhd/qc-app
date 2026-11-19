import { isIsoDate, normalizeSerial, proofMinimumOf, SERIAL_LIMITS } from '@shared/serials';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { BusyLabel } from '@/components/spinner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import { describeError } from '@/lib/api/describe-error';
import { cn } from '@/lib/utils';
import { useMe } from '@/modules/auth/use-me';
import { useOptionalActiveLocations } from '@/modules/location/active-locations-context';
import {
  addSerials,
  applyBulk,
  applyLookup,
  applyResults,
  type BulkPatch,
  type Defaults,
  type DraftControl,
  fromQcsnRows,
  isExistingBlocked,
  lookupKeyOf,
  missingDefaults,
  proofIdsOf,
  removeRows,
  rowsToLookup,
  type StagingRow,
  toBatches,
  toRowInput,
} from '../lib/draft';
import { clearDraft, loadDraft, resumeDraftWrites, saveDraft } from '../lib/draft-store';
import { isReferenceError, type VerifyDeps, verifyImported } from '../lib/import-verify';
import { hasProofPhotos } from '../lib/leave-guard';
import { lockedLocationOf, todayWib, toLocationOptions } from '../lib/locations';
import { applyProofMins, fetchProofMins, uniqueItemIds } from '../lib/proof-refresh';
import type { ProofPhotoRef } from '../lib/proof-source';
import type { QcsnImport } from '../lib/qcsn';
import { useSerialLocations } from '../lib/use-serial-locations';
import {
  discardProofPhotos,
  serialBuOptionsQueryOptions,
  serialItemsByIdQueryOptions,
  serialLocationOptionsQueryOptions,
  serialLookupManyQueryOptions,
  serialStickerOptionsQueryOptions,
  useSaveSerialBatch,
} from '../queries';
import { BulkEditDialog } from './bulk-edit-dialog';
import type { StrictScan } from './camera-scan-button';
import { ConfirmRemoveDialog } from './confirm-remove-dialog';
import { ImportExportBar } from './import-export-bar';
import { EMPTY_ITEM_BU, ItemBuField, type ItemBuValue } from './item-bu-field';
import { RowEditDialog, type RowEditResult } from './row-edit-dialog';
import { SELECTION_BAR_SPACE_CLASS, SelectionBar } from './selection-bar';
import { SerialLocationField } from './serial-location-field';
import { SerialNoteField } from './serial-note-field';
import { type ScanFeedback, SerialScanInput } from './serial-scan-input';
import { StagingCards } from './staging-cards';
import { rowStatus, StagingTable } from './staging-table';
import { defaultStickerChoice, StickerChecklist, useApplicableStickers } from './sticker-checklist';

type NoticeTone = 'info' | 'warn' | 'error';
interface Notice {
  tone: NoticeTone;
  text: string;
}

interface SaveSummary {
  created: number;
  /** Serial sudah ada: entri menjadi cek ulang lolos pada catatan yang sama. */
  rechecked: number;
  duplicate: number;
  failed: number;
  /** Baris yang tidak dikirim karena item atau BU-nya tidak lagi sah (ditandai di tabel). */
  skipped: number;
}

export interface RecordPageProps {
  /** Dipanggil saat tabel sementara berubah antara kosong dan berisi (untuk konfirmasi keluar halaman). */
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * Dipanggil setelah Simpan bila SEMUA baris tersimpan (tanpa sisa error, duplikat, atau baris yang tak dikirim, dan
   * draft kosong): pemanggil membawa pengguna kembali ke daftar. Bila ada yang gagal, halaman tetap terbuka.
   */
  onAllSaved?: (created: number) => void;
  /** Dipanggil saat ada/tidaknya baris draft berfoto bukti berubah (menentukan jenis penjaga keluar halaman). */
  onProofChange?: (hasProof: boolean) => void;
  /**
   * Diisi pegangan untuk menjalankan Simpan dari luar (dialog penjaga keluar). `save()` sama dengan tombol Simpan tetapi
   * TIDAK memanggil `onAllSaved` (pemanggil sendiri yang melanjutkan navigasi); hasilnya `true` bila semua baris
   * tersimpan.
   */
  handleRef?: { current: RecordPageHandle | null };
  /**
   * Draft milik pemanggil (mode terkontrol): tabel berasal dari `draft.rows`, setiap perubahan lewat `draft.replace`, dan
   * `RecordPage` tidak menyentuh `localStorage` sama sekali. Tanpa ini perilaku web (state sendiri + `localStorage`).
   */
  draft?: DraftControl;
  /** Sembunyikan judul "Catat Serial Number" (pemanggil sudah punya judul halaman). */
  hideTitle?: boolean;
}

export interface RecordPageHandle {
  save(): Promise<boolean>;
}

const NOTICE_CLASS: Record<NoticeTone, string> = {
  info: 'border-border bg-muted/40',
  warn: 'border-amber-500/50 bg-amber-500/10',
  error: 'border-destructive/50 bg-destructive/10 text-destructive',
};

const AUTOSAVE_DELAY_MS = 500;
/** Jeda mengumpulkan serial baru sebelum ditanyakan ke server (`serials.lookupMany`): scan beruntun jadi satu permintaan. */
const LOOKUP_DELAY_MS = 250;

function newClientId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  if (random) return random;
  return `row-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const nowIso = () => new Date().toISOString();

function clearOutcome(row: StagingRow): StagingRow {
  const { result: _result, message: _message, ...rest } = row;
  return rest;
}

/** Elemen field Default yang menerima fokus awal menurut label field kosong (`missingDefaults`). */
const DEFAULT_FIELD_ID: Record<string, string> = {
  Item: 'default-item',
  'Business Unit': 'default-bu',
  Lokasi: 'default-location',
  'Tanggal uji': 'default-date',
};

/** Pesan ringkas untuk satu penambahan (tempel, ketik, atau pindai). */
function describeAdd(report: ReturnType<typeof addSerials>['report']): {
  feedback: ScanFeedback;
  notice: Notice;
  /** Murni sukses (ada yang ditambahkan, tanpa duplikat, ditolak, atau batas): cukup toast singkat, bukan kotak inline. */
  quiet: boolean;
} {
  const parts: string[] = [];
  if (report.added > 0) parts.push(`${report.added} serial ditambahkan`);
  if (report.duplicates > 0) parts.push(`${report.duplicates} duplikat dilewati`);
  if (report.rejected.length > 0) {
    parts.push(`${report.rejected.length} ditolak (${report.rejected.slice(0, 3).join(', ')})`);
  }
  if (report.truncated) parts.push(`batas ${SERIAL_LIMITS.tableRows} baris draft tercapai`);
  // Tambahan sebagian (ada yang ditolak atau terpotong) tidak berbunyi nada sukses.
  const partial = report.rejected.length > 0 || report.truncated;
  const feedback: ScanFeedback = partial
    ? 'rejected'
    : report.added > 0
      ? 'added'
      : report.duplicates > 0
        ? 'duplicate'
        : 'rejected';
  const tone: NoticeTone = report.added > 0 && !partial ? 'info' : 'warn';
  return {
    feedback,
    notice: { tone, text: parts.join('; ') || 'Tidak ada serial yang dibaca' },
    quiet: report.added > 0 && report.duplicates === 0 && !partial,
  };
}

/** Id toast hasil tambah: scan berturut-turut mengganti toast yang sama, bukan menumpuk. */
const ADD_TOAST_ID = 'serial-add';

/** Halaman Catat Serial: bawaan rombongan, masukan pindai/tempel, tabel sementara, simpan per 200 baris. */
export function RecordPage({
  onDirtyChange,
  onAllSaved,
  onProofChange,
  handleRef,
  draft,
  hideTitle,
}: RecordPageProps) {
  const me = useMe();
  const queryClient = useQueryClient();
  const saveBatch = useSaveSerialBatch();
  const ownerKey = me.email;
  // Pengguna dapat meninggalkan halaman saat simpan berjalan: hasil simpan tidak boleh membajak navigasi.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Mode terkontrol (`draft`): tabel milik pemanggil dan `localStorage` tak disentuh; selain itu state sendiri.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [ownRows, setOwnRows] = useState<StagingRow[]>(() => (draft ? [] : loadDraft(ownerKey)));
  const rows = draft ? draft.rows : ownRows;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const setAllRows = useCallback((next: StagingRow[]) => {
    rowsRef.current = next;
    if (draftRef.current) draftRef.current.replace(next);
    else setOwnRows(next);
  }, []);

  // Serial yang sudah tercatat (keunikan se-sistem): serial baru di draft ditanyakan ke server per kelompok; yang sudah
  // ada menjadi baris Cek ulang. Satu rantai janji agar permintaan tidak tumpang tindih dan Simpan bisa menunggunya.
  const lookedUpRef = useRef(new Set<string>());
  const lookupChainRef = useRef<Promise<string | null>>(Promise.resolve(null));
  /** Menjalankan pencarian untuk baris yang belum ditanyakan; hasilnya `null` bila semua sukses, selain itu pesan galat. */
  const runLookup = useCallback((): Promise<string | null> => {
    const task = lookupChainRef.current.then(async (): Promise<string | null> => {
      let failure: string | null = null;
      // Pasangan (baris, serial) yang sudah tidak ada di draft dilupakan (tak menumpuk).
      const present = new Set(rowsRef.current.map(lookupKeyOf));
      for (const key of lookedUpRef.current) if (!present.has(key)) lookedUpRef.current.delete(key);
      const pendingRows = rowsToLookup(rowsRef.current, lookedUpRef.current);
      const pending = [...new Set(pendingRows.map((row) => normalizeSerial(row.serial)))];
      for (let at = 0; at < pending.length; at += SERIAL_LIMITS.batchRows) {
        const chunk = new Set(pending.slice(at, at + SERIAL_LIMITS.batchRows));
        try {
          const data = await queryClient.fetchQuery(serialLookupManyQueryOptions([...chunk]));
          for (const row of pendingRows) {
            if (chunk.has(normalizeSerial(row.serial))) lookedUpRef.current.add(lookupKeyOf(row));
          }
          const next = applyLookup(rowsRef.current, chunk, data.found);
          if (next !== rowsRef.current) setAllRows(next);
        } catch (caught) {
          // Gagal (jaringan/server): baris dibiarkan. Simpan menolak jalan terus (stiker bawaan akan salah dipotong
          // bila serialnya ternyata sudah ada), sedangkan pencarian latar belakang diam saja.
          failure = describeError(caught);
        }
      }
      return failure;
    });
    lookupChainRef.current = task;
    return task;
  }, [queryClient, setAllRows]);
  // Berubah hanya bila ada baris baru atau serial yang diganti (bukan tiap suntingan lain); itu yang memicu pencarian.
  const serialsKey = useMemo(() => rows.map(lookupKeyOf).join('|'), [rows]);
  useEffect(() => {
    if (serialsKey === '') {
      lookedUpRef.current.clear();
      return;
    }
    const timer = setTimeout(() => void runLookup(), LOOKUP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [serialsKey, runLookup]);

  // Item menurut id (verifikasi impor dan penyegaran draft): hanya item yang ada dan terlihat bagi pengguna.
  const findItemLookups = useCallback(
    async (itemIds: readonly string[]) => {
      const page = await queryClient.fetchQuery(serialItemsByIdQueryOptions(itemIds));
      return page.items.map((entry) => ({
        id: entry.id,
        label: entry.label,
        buOptions: entry.buOptions,
        proofMin: proofMinimumOf(entry),
      }));
    },
    [queryClient],
  );
  // Draft lama tidak membawa `proofMin` (dibuat sebelum item wajib foto): segarkan sekali saat halaman dibuka, satu
  // permintaan per kumpulan item unik. Gagal = baris tetap seperti semula; server tetap menegakkan aturan saat Simpan.
  useEffect(() => {
    const ids = uniqueItemIds(rowsRef.current);
    if (ids.length === 0) return;
    void fetchProofMins(ids, findItemLookups).then((mins) => {
      if (!mountedRef.current) return;
      const latest = rowsRef.current;
      const next = applyProofMins(latest, mins);
      if (next !== latest) setAllRows(next);
    });
  }, [findItemLookups, setAllRows]);

  const [item, setItem] = useState<ItemBuValue>(EMPTY_ITEM_BU);
  const [pickedLocation, setLocation] = useState({ id: '', label: '' });
  // Lokasi Default terkunci (terisi otomatis, tak dapat diubah di sini) bila lokasi aktif di header tepat satu atau hanya
  // ada satu pilihan lokasi (spek Catat wajib foto, butir N.2); mengganti lokasi = mengganti pilihan di header.
  const { locations: pickableLocations, isPending: locationsPending } = useSerialLocations();
  const activeSelection = useOptionalActiveLocations()?.selectedIds;
  const locked = useMemo(
    () => lockedLocationOf(pickableLocations, activeSelection ?? []),
    [pickableLocations, activeSelection],
  );
  const location = locked ? { id: locked.id, label: locked.label } : pickedLocation;
  const [testDate, setTestDate] = useState(() => todayWib());
  const [sample, setSample] = useState(false);
  const [note, setNote] = useState('');
  // Pilihan stiker bawaan: `null` = belum diubah (semua yang berlaku tercentang, baris baru `stickers: null`).
  const [stickerChoice, setStickerChoice] = useState<Map<string, number> | null>(null);
  const applicable = useApplicableStickers(item.itemId, item.buId);

  const [notice, setNotice] = useState<Notice | null>(null);
  const [summary, setSummary] = useState<SaveSummary | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [draftFailed, setDraftFailed] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const desktop = useIsDesktop();

  // Halaman dibuka: penulisan draf diizinkan lagi (dihentikan oleh `clearAllDrafts` saat keluar).
  useEffect(() => {
    if (!draftRef.current) resumeDraftWrites();
  }, []);
  // Draf otomatis (ditunda); saat halaman ditutup, isi terakhir langsung disimpan (kecuali sesudah keluar).
  useEffect(() => {
    if (draftRef.current) return;
    const timer = setTimeout(() => setDraftFailed(!saveDraft(ownerKey, rows)), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ownerKey, rows]);
  useEffect(
    () => () => {
      if (!draftRef.current) saveDraft(ownerKey, rowsRef.current);
    },
    [ownerKey],
  );
  useEffect(() => {
    onDirtyChange?.(rows.length > 0);
  }, [onDirtyChange, rows.length]);
  const withProof = hasProofPhotos(rows);
  useEffect(() => {
    onProofChange?.(withProof);
  }, [onProofChange, withProof]);

  const selectedCount = rows.filter((row) => row.selected).length;
  // Bar aksi pilihan tampil (di ponsel `fixed`): halaman diberi ruang di dasarnya, bukan di atas daftar.
  const barVisible = selectedCount > 0 && !saving;
  const selectedPhotoCount = rows.reduce(
    (total, row) => total + (row.selected ? row.proofPhotos.length : 0),
    0,
  );
  const detailRow = detailId === null ? undefined : rows.find((row) => row.clientId === detailId);

  // Gerbang Default: scan, kamera, dan tempel baru aktif setelah Item, BU, Lokasi, dan Tanggal uji terisi.
  const missing = missingDefaults({
    itemId: item.itemId,
    buId: item.buId,
    locationId: location.id,
    testDate,
  });
  const gated = missing.length > 0;
  // Fokus awal ke field Default pertama yang kosong (kolom scan terkunci selama Default belum lengkap), sekali, setelah
  // daftar lokasi diketahui supaya lokasi yang terkunci (terisi otomatis) tak menjadi sasaran fokus.
  const focusedRef = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: hanya sekali sesudah lokasi diketahui.
  useEffect(() => {
    if (focusedRef.current || locationsPending) return;
    focusedRef.current = true;
    const first = missing[0];
    if (first === undefined) return;
    document.getElementById(DEFAULT_FIELD_ID[first] ?? 'default-item')?.focus();
  }, [locationsPending]);

  const defaults = (): Defaults => ({
    itemId: item.itemId,
    itemLabel: item.itemLabel,
    buId: item.buId,
    buLabel: item.buLabel,
    proofMin: item.proofMin,
    testDate,
    locationId: location.id,
    locationLabel: location.label,
    sample,
    note: note.trim(),
    // Bawaan tak diubah: `null` (diselesaikan saat simpan); diubah: salinan pilihan eksplisit (nama + jumlah).
    stickers:
      stickerChoice === null
        ? null
        : applicable.options.flatMap((sticker) => {
            const qty = stickerChoice.get(sticker.id);
            return qty === undefined ? [] : [{ stickerId: sticker.id, name: sticker.name, qty }];
          }),
  });

  // Serial yang sudah ada di draft (bentuk ternormalisasi): pemindai kamera tidak menambahkannya ke tabel hasilnya.
  const knownSerials = useMemo(
    () => new Set(rows.map((row) => normalizeSerial(row.serial))),
    [rows],
  );
  const isKnownSerial = useCallback((serial: string) => knownSerials.has(serial), [knownSerials]);

  // Sisa baris draft yang masih boleh ditambah (dibaca tiap bacaan kamera): tabel hasil scan menolak yang melebihinya.
  const draftCapacity = useCallback(() => SERIAL_LIMITS.tableRows - rowsRef.current.length, []);

  // Hasil tambah yang murni sukses = toast (id tetap: diganti, tidak menumpuk) dan kotak inline lama dibuang; yang
  // bernada peringatan (duplikat, ditolak, batas draft) tetap inline karena bisa panjang dan perlu dibaca.
  function announceAdd({ notice: message, quiet }: ReturnType<typeof describeAdd>) {
    if (quiet) {
      toast.success(message.text, { id: ADD_TOAST_ID, duration: 2500 });
      setNotice(null);
    } else {
      // Peringatan inline: toast sukses sebelumnya jangan menempel di sampingnya.
      toast.dismiss(ADD_TOAST_ID);
      setNotice(message);
    }
  }

  // Setelah Simpan dialog kamera: `addText` sudah dipanggil per baris (notice-nya saling menimpa); ringkas SEMUA baris.
  function summarizeCameraSave(results: { serial: string; feedback: ScanFeedback }[]) {
    const described = describeAdd({
      added: results.filter((result) => result.feedback === 'added').length,
      duplicates: results.filter((result) => result.feedback === 'duplicate').length,
      // Tabel kamera sudah memvalidasi serial dan menjaga sisa kapasitas draft: yang masih 'rejected' saat Simpan hanya
      // bisa terbentur batas draft (bukan serial tak sah).
      rejected: [],
      truncated: results.some((result) => result.feedback === 'rejected'),
    });
    announceAdd(described);
  }

  // Item wajib foto: scan satu serial per kali lewat dialog dua langkah; baris masuk draft setelah Simpan di dialog.
  const addStrictRowRef = useRef<(result: { serial: string; photos: ProofPhotoRef[] }) => void>(
    () => undefined,
  );
  const confirmStrict = useCallback(
    (result: { serial: string; photos: ProofPhotoRef[] }) => addStrictRowRef.current(result),
    [],
  );
  const strict = useMemo<StrictScan | undefined>(
    () =>
      item.proofMin > 0
        ? {
            info: {
              itemLabel: item.itemLabel,
              buLabel: item.buLabel,
              locationLabel: location.label,
              testDate,
              proofMin: item.proofMin,
              stamp: {
                itemLabel: item.itemLabel,
                buLabel: item.buLabel,
                locationLabel: location.label,
                actorName: me.name,
                actorTeam: 'QC',
              },
            },
            isKnown: isKnownSerial,
            onConfirm: confirmStrict,
            capacity: draftCapacity,
          }
        : undefined,
    [
      item.proofMin,
      item.itemLabel,
      item.buLabel,
      location.label,
      testDate,
      me.name,
      isKnownSerial,
      confirmStrict,
      draftCapacity,
    ],
  );

  /** Menambah satu baris item wajib foto beserta fotonya; bila tak muat (batas draft/duplikat), foto dibuang. */
  function addStrictRow(result: { serial: string; photos: ProofPhotoRef[] }) {
    const { rows: next, report } = addSerials(
      rowsRef.current,
      result.serial,
      defaults(),
      newClientId,
      nowIso,
    );
    const added = report.added === 1 ? next[next.length - 1] : undefined;
    if (!added) {
      void discardProofPhotos(result.photos.map((photo) => photo.id));
      announceAdd(describeAdd(report));
      return;
    }
    next[next.length - 1] = { ...added, proofPhotos: result.photos };
    setAllRows(next);
    announceAdd(describeAdd(report));
    setSummary(null);
  }
  addStrictRowRef.current = addStrictRow;

  function addText(text: string): ScanFeedback {
    const { rows: next, report } = addSerials(
      rowsRef.current,
      text,
      defaults(),
      newClientId,
      nowIso,
    );
    const described = describeAdd(report);
    setAllRows(next);
    announceAdd(described);
    setSummary(null);
    return described.feedback;
  }

  // Handler baris stabil (hanya membaca `rowsRef`) agar `memo(RowView)` mencegah render ulang ribuan sel.
  const patchRow = useCallback(
    (clientId: string, change: (row: StagingRow) => StagingRow) =>
      setAllRows(rowsRef.current.map((row) => (row.clientId === clientId ? change(row) : row))),
    [setAllRows],
  );
  const select = useCallback(
    (clientId: string, selected: boolean) =>
      patchRow(clientId, (row) => (row.selected === selected ? row : { ...row, selected })),
    [patchRow],
  );
  const selectAll = useCallback(
    (selected: boolean) => setAllRows(rowsRef.current.map((row) => ({ ...row, selected }))),
    [setAllRows],
  );
  const edit = useCallback(
    (clientId: string, patch: Partial<StagingRow>) =>
      patchRow(clientId, (row) => ({ ...clearOutcome(row), ...patch })),
    [patchRow],
  );
  const commitSerial = useCallback(
    (clientId: string, serial: string): string | null => {
      if (rowsRef.current.some((row) => row.clientId !== clientId && row.serial === serial)) {
        return 'Serial sudah ada di tabel';
      }
      // Serial diganti: penanda Cek ulang milik serial lama dibuang; serial baru ditanyakan ulang ke server.
      patchRow(clientId, (row) => {
        const { existing: _old, ...rest } = clearOutcome(row);
        // Bukan lagi Cek ulang: stiker kembali ke bawaan (semua yang berlaku), seperti baris biasa.
        return { ...rest, serial, ...(row.existing ? { stickers: null } : {}) };
      });
      return null;
    },
    [patchRow],
  );
  // Membuang baris = foto draft barisnya ikut dibuang di server (upaya terbaik; sisanya disapu penjadwal).
  const dropRows = useCallback(
    (ids: ReadonlySet<string>) => {
      const dropped = rowsRef.current.filter((row) => ids.has(row.clientId));
      void discardProofPhotos(proofIdsOf(dropped));
      setAllRows(removeRows(rowsRef.current, ids));
    },
    [setAllRows],
  );
  const removeOne = useCallback((clientId: string) => dropRows(new Set([clientId])), [dropRows]);
  const openDetail = useCallback((clientId: string) => setDetailId(clientId), []);

  function selectedIds(): Set<string> {
    return new Set(rowsRef.current.filter((row) => row.selected).map((row) => row.clientId));
  }

  function clearSelectedOutcome(row: StagingRow): StagingRow {
    return row.selected ? clearOutcome(row) : row;
  }

  function applyBulkEdit(patch: BulkPatch) {
    setAllRows(applyBulk(rowsRef.current, selectedIds(), patch).map(clearSelectedOutcome));
    setNotice({ tone: 'info', text: `${selectedCount} baris diubah` });
    setBulkOpen(false);
  }

  function removeSelected() {
    dropRows(selectedIds());
    setRemoveOpen(false);
  }

  function applyDetail(result: RowEditResult) {
    if (detailId === null) return;
    patchRow(detailId, (row) => {
      const { unresolved: _unresolved, ...rest } = clearOutcome(row);
      return {
        ...rest,
        serial: result.serial,
        itemId: result.item.itemId,
        itemLabel: result.item.itemLabel,
        buId: result.item.buId,
        buLabel: result.item.buLabel,
        // Minimum foto hanya dibawa bila item/BU diganti di dialog: tanpa itu nilai baris (mungkin baru disegarkan dari
        // server selagi dialog terbuka) tidak boleh ditimpa nilai usang dari keadaan awal dialog.
        ...(result.item.itemId !== row.itemId || result.item.buId !== row.buId
          ? { proofMin: result.item.proofMin }
          : {}),
        locationId: result.location.id,
        locationLabel: result.location.label,
        testDate: result.testDate,
        sample: result.sample,
        note: result.note,
        stickers: result.stickers,
        proofPhotos: result.proofPhotos,
      };
    });
    setDetailId(null);
  }

  async function handleImported(result: QcsnImport, fileName: string) {
    setImporting(true);
    try {
      const loadLocations = async () => {
        try {
          const data = await queryClient.fetchQuery(serialLocationOptionsQueryOptions());
          return toLocationOptions(data.locations);
        } catch {
          return null;
        }
      };
      const loadBus = async () => {
        try {
          const data = await queryClient.fetchQuery(serialBuOptionsQueryOptions());
          return data.businessUnits.map((bu) => ({ id: bu.id, code: bu.code }));
        } catch {
          return null;
        }
      };
      const deps: VerifyDeps = {
        findItems: findItemLookups,
        stickersOf: async (itemId, buId) => {
          const data = await queryClient.fetchQuery(serialStickerOptionsQueryOptions(itemId, buId));
          return data.stickers.map((sticker) => ({ id: sticker.id, name: sticker.name }));
        },
        locations: await loadLocations(),
        buOptions: await loadBus(),
      };
      // Pindaian dan suntingan boleh terjadi selama verifikasi menunggu: hasilnya digabung ke tabel TERBARU.
      const snapshot = rowsRef.current;
      const first = fromQcsnRows(snapshot, result.rows);
      const verified = await verifyImported(first.rows.slice(snapshot.length), deps);
      const latest = rowsRef.current;
      const knownSerials = new Set(latest.map((row) => normalizeSerial(row.serial)));
      const knownIds = new Set(latest.map((row) => row.clientId));
      const additions: StagingRow[] = [];
      let skipped = first.skipped;
      let truncated = first.truncated;
      for (const row of verified.rows) {
        if (knownSerials.has(row.serial) || knownIds.has(row.clientId)) {
          skipped++;
        } else if (latest.length + additions.length >= SERIAL_LIMITS.tableRows) {
          skipped++;
          truncated = true;
        } else {
          additions.push(row);
        }
      }
      setAllRows([...latest, ...additions]);
      // Serial yang sudah tercatat diperiksa sekarang: barisnya menjadi Cek ulang atau ditandai bermasalah.
      await runLookup();
      const addedIds = new Set(additions.map((row) => row.clientId));
      const recheck = rowsRef.current.filter(
        (row) => addedIds.has(row.clientId) && row.existing !== undefined,
      );
      const parts = [
        `${fileName}: ${additions.length} baris baru`,
        `${skipped} dilewati (sudah ada)`,
      ];
      if (recheck.length > 0) parts.push(`${recheck.length} baris jadi Cek ulang`);
      const stuck = recheck.filter(isExistingBlocked).length;
      if (stuck > 0) parts.push(`${stuck} tidak bisa dicek ulang (laporan aktif atau rusak)`);
      if (result.problems.length > 0) {
        parts.push(
          `${result.problems.length} bermasalah (${result.problems
            .slice(0, 3)
            .map((problem) => (problem.row === null ? problem.message : `baris ${problem.row}`))
            .join(', ')})`,
        );
      }
      if (verified.unresolved > 0) {
        parts.push(`${verified.unresolved} baris perlu dipilih ulang item, lokasi, atau stiker`);
      }
      if (verified.unverified > 0) {
        parts.push(`${verified.unverified} baris belum bisa diverifikasi (jaringan atau server)`);
      }
      if (truncated) parts.push(`batas ${SERIAL_LIMITS.tableRows} baris draft tercapai`);
      if (result.warning) parts.push(result.warning);
      const warn =
        stuck > 0 ||
        result.problems.length > 0 ||
        verified.unresolved > 0 ||
        verified.unverified > 0 ||
        truncated ||
        result.warning !== null;
      setNotice({ tone: warn ? 'warn' : 'info', text: parts.join('; ') });
      setSummary(null);
    } finally {
      setImporting(false);
    }
  }

  // Penjaga klik ganda selama menunggu pencarian serial yang sudah ada (sebelum `saving` menyala).
  const preparingRef = useRef(false);
  /** `external` = dipicu penjaga keluar halaman: pemanggil yang melanjutkan navigasi, jadi `onAllSaved` tak dipanggil. */
  async function handleSave(external = false): Promise<boolean> {
    if (saving || importing || preparingRef.current || rowsRef.current.length === 0) return false;
    preparingRef.current = true;
    let lookupFailure: string | null;
    try {
      // Serial yang baru ditambahkan mungkin sudah tercatat: pastikan sudah ditanyakan (baris menjadi Cek ulang dengan
      // stiker kosong) sebelum dikirim, supaya bawaan "semua stiker" tidak memotong stok pada cek ulang.
      lookupFailure = await runLookup();
    } finally {
      preparingRef.current = false;
    }
    if (lookupFailure !== null) {
      setNotice({
        tone: 'error',
        text: `Pengecekan serial yang sudah tercatat gagal: ${lookupFailure}. Coba simpan lagi.`,
      });
      return false;
    }
    if (rowsRef.current.length === 0) return false;
    return saveRows(external);
  }

  async function saveRows(external: boolean): Promise<boolean> {
    const current = rowsRef.current;
    const blocked = current.filter(
      (row) =>
        (row.unresolved?.length ?? 0) > 0 ||
        row.itemId === '' ||
        row.buId === '' ||
        row.locationId === '' ||
        !isIsoDate(row.testDate) ||
        (row.proofMin ?? 0) > row.proofPhotos.length ||
        isExistingBlocked(row),
    );
    if (blocked.length > 0) {
      setNotice({
        tone: 'error',
        text: `${blocked.length} baris belum lengkap atau tidak bisa dicek ulang (item, lokasi, tanggal uji, foto bukti, atau status serial); lihat kolom Hasil.`,
      });
      return false;
    }
    setSaving(true);
    setNotice(null);
    setSummary(null);
    let allSaved = false;
    let savedCount = 0;
    let recheckedCount = 0;
    try {
      // Hanya baris yang ada saat Simpan ditekan yang dikirim; pindaian yang masuk sesudahnya menunggu simpan berikutnya.
      const sendIds = new Set(current.map((row) => row.clientId));
      // Baris yang pilihan stikernya belum dimuat memakai bawaan: semua stiker yang berlaku.
      const pending = new Map<string, { itemId: string; buId: string }>();
      for (const row of current) {
        if (row.stickers === null) {
          pending.set(`${row.itemId}|${row.buId}`, { itemId: row.itemId, buId: row.buId });
        }
      }
      const entries = [...pending];
      const settled = await Promise.allSettled(
        entries.map(([, pair]) =>
          queryClient.fetchQuery(serialStickerOptionsQueryOptions(pair.itemId, pair.buId)),
        ),
      );
      const defaultsByPair = new Map<string, { stickerId: string; name: string; qty: number }[]>();
      const badPairs = new Set<string>();
      for (const [index, outcome] of settled.entries()) {
        const key = entries[index]?.[0] ?? '';
        if (outcome.status === 'fulfilled') {
          defaultsByPair.set(
            key,
            outcome.value.stickers.map((sticker) => ({
              stickerId: sticker.id,
              name: sticker.name,
              qty: sticker.defaultQty,
            })),
          );
        } else if (isReferenceError(outcome.reason)) {
          badPairs.add(key);
        } else {
          // Gangguan jaringan atau server: tidak ada baris yang ditandai salah; seluruh simpan dihentikan.
          setNotice({
            tone: 'error',
            text: `Stiker yang berlaku gagal dimuat: ${describeError(outcome.reason)}`,
          });
          return false;
        }
      }
      let skipped = 0;
      setAllRows(
        rowsRef.current.map((row) => {
          if (!sendIds.has(row.clientId) || row.stickers !== null) return row;
          const key = `${row.itemId}|${row.buId}`;
          if (badPairs.has(key)) {
            sendIds.delete(row.clientId);
            skipped++;
            return {
              ...clearOutcome(row),
              unresolved: ['item'] as ('item' | 'location' | 'stickers')[],
            };
          }
          return { ...row, stickers: defaultsByPair.get(key) ?? [] };
        }),
      );

      const batches = toBatches(rowsRef.current.filter((row) => sendIds.has(row.clientId)));
      const tally: SaveSummary = { created: 0, rechecked: 0, duplicate: 0, failed: 0, skipped };
      for (const [index, batch] of batches.entries()) {
        try {
          const output = await saveBatch.mutateAsync({ rows: batch.map(toRowInput) });
          for (const result of output.results) {
            if (result.result === 'created') tally.created++;
            else if (result.result === 'rechecked') tally.rechecked++;
            else if (result.result === 'duplicate') tally.duplicate++;
            else tally.failed++;
          }
          setAllRows(applyResults(rowsRef.current, output.results));
        } catch (error) {
          const message = describeError(error);
          const remaining = new Set(
            batches.slice(index).flatMap((rest) => rest.map((row) => row.clientId)),
          );
          setAllRows(
            rowsRef.current.map((row) =>
              remaining.has(row.clientId) ? { ...row, result: 'error', message } : row,
            ),
          );
          tally.failed += remaining.size;
          setNotice({ tone: 'error', text: `Penyimpanan terhenti: ${message}` });
          break;
        }
      }
      setSummary(tally);
      // Baris `created` (termasuk simpan ulang `clientId` yang sama) sudah keluar dari draft; semuanya sukses bila tak ada
      // yang gagal, ganda, atau tak terkirim, dan tidak ada baris baru yang masuk selama menyimpan.
      savedCount = tally.created + tally.rechecked;
      recheckedCount = tally.rechecked;
      allSaved =
        tally.failed === 0 &&
        tally.duplicate === 0 &&
        tally.skipped === 0 &&
        rowsRef.current.length === 0;
    } finally {
      setSaving(false);
    }
    if (!mountedRef.current) {
      // Halaman sudah ditinggalkan: draf yang ditulis saat unlock masih memuat baris yang kini tersimpan; sinkronkan.
      if (!draftRef.current) saveDraft(ownerKey, rowsRef.current);
      return allSaved;
    }
    if (allSaved && (external || onAllSaved)) {
      if (!draftRef.current) clearDraft(ownerKey);
      toast.success(
        recheckedCount > 0
          ? `Serial Number berhasil disimpan (${savedCount - recheckedCount} dibuat, ${recheckedCount} dicek ulang)`
          : 'Serial Number berhasil disimpan',
      );
      if (!external) onAllSaved?.(savedCount);
    }
    return allSaved;
  }
  if (handleRef) handleRef.current = { save: () => handleSave(true) };

  const hasFailed = rows.some((row) => row.result === 'error');
  const blockedCount = rows.filter((row) => rowStatus(row).tone !== 'ok').length;

  return (
    <div
      className={cn('space-y-5', barVisible && SELECTION_BAR_SPACE_CLASS)}
      data-selection-space={barVisible ? 'on' : undefined}
    >
      {hideTitle ? null : <h1 className="text-xl font-semibold">Catat Serial Number</h1>}

      <section
        aria-label="Default"
        className="space-y-3 rounded-lg border p-4"
        data-tour="serial-defaults"
      >
        <h2 className="text-sm font-semibold">Default</h2>
        <p className="text-xs text-muted-foreground">
          Dipakai untuk serial yang ditambahkan setelah ini; baris yang sudah ada tidak berubah.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <SerialLocationField
              id="default-location"
              label="Lokasi"
              value={location.id}
              valueLabel={location.label}
              onChange={(id, label) => setLocation({ id, label })}
              disabled={locked !== null}
            />
            {locked ? (
              <p className="text-xs text-muted-foreground" data-testid="default-location-lock">
                {locked.source === 'active'
                  ? `Terkunci ke lokasi aktif: ${locked.label}. Ganti lewat pemilih lokasi di header.`
                  : `Hanya satu lokasi yang bisa dipilih: ${locked.label}.`}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="default-date">Tanggal uji</Label>
            <Input
              id="default-date"
              type="date"
              value={testDate}
              onChange={(event) => setTestDate(event.target.value)}
            />
          </div>
          <ItemBuField
            idPrefix="default"
            label="Item"
            buFieldLabel="Business Unit"
            value={item}
            onChange={(next) => {
              // Item/BU bawaan diganti: pilihan stiker lama tidak berlaku, kembali ke semua tercentang.
              if (next.itemId !== item.itemId || next.buId !== item.buId) setStickerChoice(null);
              setItem(next);
            }}
          />
          <div className="flex items-end gap-2 pb-1.5">
            <Checkbox
              id="default-sample"
              checked={sample}
              onCheckedChange={(on) => setSample(on === true)}
            />
            <Label htmlFor="default-sample">Sample</Label>
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <StickerChecklist
              idPrefix="default"
              state={applicable.state}
              options={applicable.options}
              chosen={stickerChoice ?? defaultStickerChoice(applicable.options)}
              onChange={setStickerChoice}
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <SerialNoteField id="default-note" label="Catatan" value={note} onChange={setNote} />
          </div>
        </div>
      </section>

      <div data-tour="serial-scan">
        <SerialScanInput
          id="serial-scan"
          label="Scan atau tempel serial (satu per baris)"
          onSubmit={addText}
          isKnown={isKnownSerial}
          onCameraSaved={summarizeCameraSave}
          cameraCapacity={draftCapacity}
          disabled={gated}
          strict={strict}
          autoFocus
        />
        {gated ? (
          <p role="status" className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            Isi Default dulu: {missing.join(', ')}.
          </p>
        ) : null}
      </div>

      {notice ? (
        <p
          role="status"
          className={`rounded-md border px-3 py-2 text-sm ${NOTICE_CLASS[notice.tone]}`}
        >
          {notice.text}
        </p>
      ) : null}
      {(draft ? draft.saveFailed === true : draftFailed) ? (
        <p
          role="alert"
          className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm"
        >
          Draft tidak tersimpan otomatis (penyimpanan perangkat penuh atau diblokir). Simpan atau
          ekspor berkas .qcsn supaya hasil scan tidak hilang.
        </p>
      ) : null}

      {!saving ? (
        <SelectionBar
          count={selectedCount}
          onEdit={() => setBulkOpen(true)}
          onRemove={() => setRemoveOpen(true)}
          onClear={() => selectAll(false)}
        />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Draft ({rows.length} baris)</h2>
        <ImportExportBar
          rows={rows}
          disabled={saving || importing}
          onImported={(result, name) => void handleImported(result, name)}
          onImportFailed={(message) =>
            setNotice({ tone: 'error', text: `Impor gagal: ${message}` })
          }
          onExported={({ exported, skipped }) =>
            setNotice({
              tone: skipped > 0 ? 'warn' : 'info',
              text:
                skipped > 0
                  ? `${exported} baris diekspor; ${skipped} baris belum lengkap tidak diekspor`
                  : `${exported} baris diekspor`,
            })
          }
        />
      </div>

      <div data-tour="serial-draft">
        {rows.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Belum ada serial. Scan, ketik lalu Enter, tempel, atau impor berkas .qcsn.
          </p>
        ) : desktop ? (
          <StagingTable
            rows={rows}
            disabled={saving}
            onSelect={select}
            onSelectAll={selectAll}
            onEdit={edit}
            onCommitSerial={commitSerial}
            onOpenDetail={openDetail}
            onRemove={removeOne}
            actorName={me.name}
          />
        ) : (
          <StagingCards
            rows={rows}
            disabled={saving}
            onSelect={select}
            onSelectAll={selectAll}
            onOpenDetail={openDetail}
          />
        )}
      </div>

      {summary ? (
        <p role="status" className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
          Dibuat {summary.created},{' '}
          {summary.rechecked > 0 ? `${summary.rechecked} dicek ulang, ` : ''}
          duplikat {summary.duplicate}, gagal {summary.failed}.
          {summary.skipped > 0
            ? ` ${summary.skipped} baris tidak dikirim: item atau Business Unit-nya sudah tidak berlaku.`
            : ''}
          {rows.length > 0 ? ' Baris yang tersisa masih ada di draft.' : ''}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3" data-tour="serial-save">
        <Button
          type="button"
          disabled={saving || importing || rows.length === 0}
          onClick={() => void handleSave()}
        >
          {saving ? (
            <BusyLabel>Menyimpan…</BusyLabel>
          ) : hasFailed ? (
            'Coba lagi'
          ) : (
            `Simpan ${rows.length} serial`
          )}
        </Button>
        {blockedCount > 0 ? (
          <span className="text-xs text-muted-foreground">
            {blockedCount} baris perlu dilengkapi atau diperbaiki.
          </span>
        ) : null}
        {rows.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={() => {
              void discardProofPhotos(proofIdsOf(rowsRef.current));
              setAllRows([]);
              if (!draftRef.current) clearDraft(ownerKey);
              setNotice(null);
              setSummary(null);
            }}
          >
            Kosongkan draft
          </Button>
        ) : null}
      </div>

      {detailRow && !saving ? (
        <RowEditDialog
          // Dibuka sebelum pencarian serial selesai lalu barisnya menjadi Cek ulang: dialog dipasang ulang dari baris baru.
          key={`${detailRow.clientId}|${detailRow.existing?.id ?? ''}`}
          row={detailRow}
          actorName={me.name}
          commitSerial={(serial) => commitSerial(detailRow.clientId, serial)}
          onClose={() => setDetailId(null)}
          onApply={applyDetail}
        />
      ) : null}
      {bulkOpen && selectedCount > 0 && !saving ? (
        <BulkEditDialog
          open
          count={selectedCount}
          recheckCount={rows.filter((row) => row.selected && row.existing !== undefined).length}
          onApply={applyBulkEdit}
          onClose={() => setBulkOpen(false)}
        />
      ) : null}
      <ConfirmRemoveDialog
        open={removeOpen && selectedCount > 0 && !saving}
        count={selectedCount}
        photoCount={selectedPhotoCount}
        onConfirm={removeSelected}
        onCancel={() => setRemoveOpen(false)}
      />
    </div>
  );
}
