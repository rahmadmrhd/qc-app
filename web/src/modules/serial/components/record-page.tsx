import { isIsoDate, normalizeSerial, proofMinimumOf, SERIAL_LIMITS } from '@shared/serials';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { BusyLabel } from '@/components/spinner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { describeError } from '@/lib/api/describe-error';
import { useMe } from '@/modules/auth/use-me';
import {
  addSerials,
  applyBulk,
  applyResults,
  type BulkPatch,
  type Defaults,
  fromQcsnRows,
  missingDefaults,
  proofIdsOf,
  removeRows,
  type StagingRow,
  toBatches,
  toRowInput,
} from '../lib/draft';
import { clearDraft, loadDraft, resumeDraftWrites, saveDraft } from '../lib/draft-store';
import { isReferenceError, type VerifyDeps, verifyImported } from '../lib/import-verify';
import { hasProofPhotos } from '../lib/leave-guard';
import { todayWib, toLocationOptions } from '../lib/locations';
import type { ProofPhotoRef } from '../lib/proof-source';
import type { QcsnImport } from '../lib/qcsn';
import { useSerialLocations } from '../lib/use-serial-locations';
import {
  discardProofPhotos,
  serialItemsByIdQueryOptions,
  serialLocationOptionsQueryOptions,
  serialStickerOptionsQueryOptions,
  useSaveSerialBatch,
} from '../queries';
import { BulkEditBar } from './bulk-edit-bar';
import type { StrictScan } from './camera-scan-button';
import { ImportExportBar } from './import-export-bar';
import { EMPTY_ITEM_BU, ItemBuField, type ItemBuValue } from './item-bu-field';
import { RowDetailDialog, type RowDetailResult } from './row-detail-dialog';
import { SerialLocationField } from './serial-location-field';
import { type ScanFeedback, SerialScanInput } from './serial-scan-input';
import { rowStatus, StagingTable } from './staging-table';
import { defaultStickerChoice, StickerChecklist, useApplicableStickers } from './sticker-checklist';

type NoticeTone = 'info' | 'warn' | 'error';
interface Notice {
  tone: NoticeTone;
  text: string;
}

interface SaveSummary {
  created: number;
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
  return { feedback, notice: { tone, text: parts.join('; ') || 'Tidak ada serial yang dibaca' } };
}

/** Halaman Catat Serial: bawaan rombongan, masukan pindai/tempel, tabel sementara, simpan per 200 baris. */
export function RecordPage({
  onDirtyChange,
  onAllSaved,
  onProofChange,
  handleRef,
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

  const [rows, setRows] = useState<StagingRow[]>(() => loadDraft(ownerKey));
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const setAllRows = useCallback((next: StagingRow[]) => {
    rowsRef.current = next;
    setRows(next);
  }, []);

  const [item, setItem] = useState<ItemBuValue>(EMPTY_ITEM_BU);
  const [location, setLocation] = useState({ id: '', label: '' });
  // Hanya satu lokasi yang dapat dipilih: jadi bawaan, sekali saja (pengguna yang mengosongkannya tak diisi lagi).
  const { locations: pickableLocations } = useSerialLocations();
  const defaultLocationDecided = useRef(false);
  useEffect(() => {
    if (defaultLocationDecided.current || pickableLocations.length === 0) return;
    defaultLocationDecided.current = true;
    const [only] = toLocationOptions(pickableLocations);
    if (only && pickableLocations.length === 1) {
      setLocation((current) => (current.id === '' ? { id: only.id, label: only.label } : current));
    }
  }, [pickableLocations]);
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

  // Halaman dibuka: penulisan draf diizinkan lagi (dihentikan oleh `clearAllDrafts` saat keluar).
  useEffect(() => {
    resumeDraftWrites();
  }, []);
  // Draf otomatis (ditunda); saat halaman ditutup, isi terakhir langsung disimpan (kecuali sesudah keluar).
  useEffect(() => {
    const timer = setTimeout(() => setDraftFailed(!saveDraft(ownerKey, rows)), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ownerKey, rows]);
  useEffect(
    () => () => {
      saveDraft(ownerKey, rowsRef.current);
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
  const detailRow = detailId === null ? undefined : rows.find((row) => row.clientId === detailId);

  // Gerbang Default: scan, kamera, dan tempel baru aktif setelah Item, BU, Lokasi, dan Tanggal uji terisi.
  const missing = missingDefaults({
    itemId: item.itemId,
    buId: item.buId,
    locationId: location.id,
    testDate,
  });
  const gated = missing.length > 0;
  // Fokus awal ke field Default pertama yang kosong (kolom scan terkunci selama Default belum lengkap).
  // biome-ignore lint/correctness/useExhaustiveDependencies: hanya saat halaman dibuka.
  useEffect(() => {
    const first = missing[0];
    if (first === undefined) return;
    document.getElementById(DEFAULT_FIELD_ID[first] ?? 'default-item')?.focus();
  }, []);

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

  // Setelah Simpan dialog kamera: `addText` sudah dipanggil per baris (notice-nya saling menimpa); ringkas SEMUA baris.
  function summarizeCameraSave(results: { serial: string; feedback: ScanFeedback }[]) {
    const { notice: message } = describeAdd({
      added: results.filter((result) => result.feedback === 'added').length,
      duplicates: results.filter((result) => result.feedback === 'duplicate').length,
      // Tabel kamera sudah memvalidasi serial dan menjaga sisa kapasitas draft: yang masih 'rejected' saat Simpan hanya
      // bisa terbentur batas draft (bukan serial tak sah).
      rejected: [],
      truncated: results.some((result) => result.feedback === 'rejected'),
    });
    setNotice(message);
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
      setNotice(describeAdd(report).notice);
      return;
    }
    next[next.length - 1] = { ...added, proofPhotos: result.photos };
    setAllRows(next);
    setNotice(describeAdd(report).notice);
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
    const { feedback, notice: message } = describeAdd(report);
    setAllRows(next);
    setNotice(message);
    setSummary(null);
    return feedback;
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
      edit(clientId, { serial });
      return null;
    },
    [edit],
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
  }

  function applyDetail(result: RowDetailResult) {
    if (detailId === null) return;
    patchRow(detailId, (row) => {
      const { unresolved: _unresolved, ...rest } = clearOutcome(row);
      return {
        ...rest,
        itemId: result.item.itemId,
        itemLabel: result.item.itemLabel,
        buId: result.item.buId,
        buLabel: result.item.buLabel,
        proofMin: result.item.proofMin,
        locationId: result.location.id,
        locationLabel: result.location.label,
        stickers: result.stickers,
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
      const deps: VerifyDeps = {
        findItems: async (itemIds) => {
          const page = await queryClient.fetchQuery(serialItemsByIdQueryOptions(itemIds));
          return page.items.map((item) => ({
            id: item.id,
            label: item.label,
            buOptions: item.buOptions,
            proofMin: proofMinimumOf(item),
          }));
        },
        stickersOf: async (itemId, buId) => {
          const data = await queryClient.fetchQuery(serialStickerOptionsQueryOptions(itemId, buId));
          return data.stickers.map((sticker) => ({ id: sticker.id, name: sticker.name }));
        },
        locations: await loadLocations(),
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
      const parts = [
        `${fileName}: ${additions.length} baris baru`,
        `${skipped} dilewati (sudah ada)`,
      ];
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

  /** `external` = dipicu penjaga keluar halaman: pemanggil yang melanjutkan navigasi, jadi `onAllSaved` tak dipanggil. */
  async function handleSave(external = false): Promise<boolean> {
    if (saving || importing || rowsRef.current.length === 0) return false;
    const current = rowsRef.current;
    const blocked = current.filter(
      (row) =>
        (row.unresolved?.length ?? 0) > 0 ||
        row.itemId === '' ||
        row.buId === '' ||
        row.locationId === '' ||
        !isIsoDate(row.testDate) ||
        (row.proofMin ?? 0) > row.proofPhotos.length,
    );
    if (blocked.length > 0) {
      setNotice({
        tone: 'error',
        text: `${blocked.length} baris belum lengkap (item, lokasi, tanggal uji, atau foto bukti); lihat kolom Hasil.`,
      });
      return false;
    }
    setSaving(true);
    setNotice(null);
    setSummary(null);
    let allSaved = false;
    let savedCount = 0;
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
      const tally: SaveSummary = { created: 0, duplicate: 0, failed: 0, skipped };
      for (const [index, batch] of batches.entries()) {
        try {
          const output = await saveBatch.mutateAsync({ rows: batch.map(toRowInput) });
          for (const result of output.results) {
            if (result.result === 'created') tally.created++;
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
      savedCount = tally.created;
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
      saveDraft(ownerKey, rowsRef.current);
      return allSaved;
    }
    if (allSaved && (external || onAllSaved)) {
      clearDraft(ownerKey);
      toast.success('Serial Number berhasil disimpan');
      if (!external) onAllSaved?.(savedCount);
    }
    return allSaved;
  }
  if (handleRef) handleRef.current = { save: () => handleSave(true) };

  const hasFailed = rows.some((row) => row.result === 'error');
  const blockedCount = rows.filter((row) => rowStatus(row).tone !== 'ok').length;

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Catat Serial Number</h1>

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
          <SerialLocationField
            id="default-location"
            label="Lokasi"
            value={location.id}
            valueLabel={location.label}
            onChange={(id, label) => setLocation({ id, label })}
          />
          <div className="space-y-1.5">
            <Label htmlFor="default-date">Tanggal uji</Label>
            <Input
              id="default-date"
              type="date"
              value={testDate}
              onChange={(event) => setTestDate(event.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="default-note">Catatan</Label>
            <Input
              id="default-note"
              value={note}
              maxLength={SERIAL_LIMITS.noteMax}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
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
      {draftFailed ? (
        <p
          role="alert"
          className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm"
        >
          Draft tidak tersimpan otomatis (penyimpanan perangkat penuh atau diblokir). Simpan atau
          ekspor berkas .qcsn supaya hasil scan tidak hilang.
        </p>
      ) : null}

      {selectedCount > 0 && !saving ? (
        <BulkEditBar
          count={selectedCount}
          onApply={applyBulkEdit}
          onRemove={() => dropRows(selectedIds())}
          onClearSelection={() => selectAll(false)}
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
        ) : (
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
        )}
      </div>

      {summary ? (
        <p role="status" className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
          Dibuat {summary.created}, duplikat {summary.duplicate}, gagal {summary.failed}.
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
              clearDraft(ownerKey);
              setNotice(null);
              setSummary(null);
            }}
          >
            Kosongkan draft
          </Button>
        ) : null}
      </div>

      {detailRow && !saving ? (
        <RowDetailDialog
          key={detailRow.clientId}
          row={detailRow}
          onClose={() => setDetailId(null)}
          onApply={applyDetail}
        />
      ) : null}
    </div>
  );
}
