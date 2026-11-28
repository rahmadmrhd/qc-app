import { formatBuLabel } from '@shared/business-units';
import type {
  WarehouseItemOptionDto,
  WarehouseSerialDto,
  WarehouseSkippedRowDto,
  WarehouseSubmitOutput,
} from '@shared/contract';
import { clipboardText } from '@shared/serial-warehouse';
import { normalizeSerial, splitSerialInput } from '@shared/serials';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { BulkBar } from '@/components/data-table/bulk-bar';
import type { LinkOption } from '@/components/link-field';
import { FormPage } from '@/components/page/form-page';
import { SelectModeProvider } from '@/components/page/select-mode';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import { useIsMobile } from '@/hooks/use-mobile';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { api } from '@/lib/api';
import { canReadWarehouse, warehouseBuIds } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { useOptionalActiveLocations } from '@/modules/location/active-locations-context';
import { useScanFeedback } from '@/modules/serial/lib/scan-feedback';
import { beginWarehouseSubmit } from '../lib/active-submission';
import { copyLines } from '../lib/clipboard';
import {
  addRow,
  type MissingField,
  makeExistingRow,
  makeNewRow,
  missingMessage,
  removeRows,
  rowKey,
} from '../lib/draft';
import {
  clearWarehouseDraft,
  EMPTY_FILTERS,
  enableWarehouseDraftWrites,
  readWarehouseDraft,
  type WarehouseDraft,
  type WarehouseDraftRow,
  type WarehouseDraftSubmission,
  warehouseDraftWritesBlocked,
  writeWarehouseDraft,
} from '../lib/draft-store';
import { classifyScan, scanMessage } from '../lib/scan';
import { freezeSubmission, runSubmission, type SubmitResult } from '../lib/submit';
import { countWarnings, createReferenceTracker, rowTestDate } from '../lib/warnings';
import {
  lookupWarehouseSerials,
  useSubmitWarehouseChunk,
  warehouseContextQueryOptions,
  warehouseItemOptionsQueryOptions,
  warehouseOptionsQueryOptions,
  warehouseSerialsQueryOptions,
} from '../queries';
import { ClipboardResultDialog } from './clipboard-result-dialog';
import { ConfirmDialog, type ConfirmValues } from './confirm-dialog';
import { type DispatchFilters, DispatchHeader } from './dispatch-header';
import { DispatchTable } from './dispatch-table';
import { ScanBar, type ScanLine } from './scan-bar';
import { SelectionSummary } from './selection-summary';
import { type ProgressState, SubmitProgressDialog } from './submit-progress-dialog';
import { type TypeDialogState, TypeMismatchDialog } from './type-mismatch-dialog';
import { WarningBanners } from './warning-banners';

export interface DispatchPageProps {
  /** Task Serah Terima asal (`?handover=`), bila form dibuka dari detail task. */
  handoverId?: string;
  onCancel: () => void;
}

const FILTER_DEBOUNCE_MS = 350;
const SAVE_DEBOUNCE_MS = 300;
const LOOKUP_CHUNK = 200;
const HIGHLIGHT_MS = 2500;

/** Gabung daftar dilewati tanpa ganda per SN (kiriman ulang potongan mengembalikan daftar yang sama). */
function mergeSkipped(
  current: readonly WarehouseSkippedRowDto[],
  more: readonly WarehouseSkippedRowDto[],
): WarehouseSkippedRowDto[] {
  const bySerial = new Map(current.map((entry) => [entry.serial, entry]));
  for (const entry of more) bySerial.set(entry.serial, entry);
  return [...bySerial.values()];
}

/** Pesan server bila nomor kardus awal bentrok dengan kardus yang sudah ada (potongan pertama ditolak). */
const BOX_TAKEN = /Nomor kardus sudah dipakai/;

/** Form Keluar Gudang (spek 5.3-5.6, 5.11, 5.12, 5.14 pemakaian 1). */
export function DispatchPage({ handoverId, onCancel }: DispatchPageProps) {
  const me = useMe();
  const email = me.email;
  const stack = useStackNavigation();
  const phone = useIsMobile();
  const desktop = useIsDesktop();
  const { announce, unlock } = useScanFeedback();
  const [allSelected, setAllSelected] = useState(false);
  const selectAllRef = useRef<(() => void) | null>(null);
  const { mutateAsync: sendChunk } = useSubmitWarehouseChunk();

  const allowedBuIds = useMemo(() => warehouseBuIds(me, 'edit'), [me]);
  const buOptions = useMemo<LinkOption[]>(
    () =>
      (me.businessUnits ?? [])
        .filter((bu) => !bu.deleted && allowedBuIds.includes(bu.id))
        .map((bu) => ({ id: bu.id, label: formatBuLabel(bu) })),
    [me, allowedBuIds],
  );
  const buCodes = useMemo(
    () => new Map((me.businessUnits ?? []).map((bu) => [bu.id, bu.code ?? bu.name ?? ''])),
    [me],
  );
  const buCodeOf = useCallback((id: string) => buCodes.get(id) ?? '', [buCodes]);

  // Lokasi aktif pengguna (cadangan Lokasi di dialog simpan); tanpa penyedia (mis. tes) = tidak ada.
  const activeLocations = useOptionalActiveLocations();
  const activeLocationIds = useMemo(() => activeLocations?.selectedIds ?? [], [activeLocations]);
  const options = useQuery(warehouseOptionsQueryOptions());
  const locationOptions = useMemo<LinkOption[]>(
    () => (options.data?.locations ?? []).map((l) => ({ id: l.id, label: l.name })),
    [options.data],
  );
  const locationNameOf = useCallback(
    (id: string) => options.data?.locations.find((l) => l.id === id)?.name ?? '',
    [options.data],
  );

  // --- Draf (state utama; ditulis ke localStorage dengan jeda) ---
  const [initial] = useState(() => {
    // Halaman dibuka (sesi aktif): penulisan draf diizinkan lagi.
    enableWarehouseDraftWrites();
    return readWarehouseDraft(email);
  });
  const [itemId, setItemId] = useState(initial?.itemId ?? '');
  const [filters, setFilters] = useState<DispatchFilters>(() => {
    const base = initial?.filters ?? EMPTY_FILTERS;
    const [only] = buOptions;
    return base.buId === '' && buOptions.length === 1 && only ? { ...base, buId: only.id } : base;
  });
  const [rows, setRows] = useState<readonly WarehouseDraftRow[]>(initial?.rows ?? []);
  const [submission, setSubmission] = useState<WarehouseDraftSubmission | undefined>(
    initial?.submission,
  );

  const [skipped, setSkipped] = useState<readonly WarehouseSkippedRowDto[]>(initial?.skipped ?? []);

  // Nilai terkini yang dibaca antrean scan (berjalan setelah render ulang) dan penulis draf.
  const live = useRef({ itemId, filters, rows, submission, skipped });
  live.current = { itemId, filters, rows, submission, skipped };
  const emailRef = useRef(email);
  emailRef.current = email;
  const writeFailedRef = useRef(false);

  const persistNow = useCallback(() => {
    // Sesudah keluar aplikasi draf tidak ditulis lagi (efek pembersih/kiriman yang selesai belakangan).
    if (warehouseDraftWritesBlocked()) return;
    const current = live.current;
    const draft: WarehouseDraft = {
      v: 1,
      itemId: current.itemId,
      filters: current.filters,
      rows: [...current.rows],
      ...(current.submission ? { submission: current.submission } : {}),
      ...(current.skipped.length > 0 ? { skipped: [...current.skipped] } : {}),
    };
    if (draft.rows.length === 0 && !draft.submission && draft.itemId === '') {
      clearWarehouseDraft(emailRef.current);
      return;
    }
    if (!writeWarehouseDraft(emailRef.current, draft) && !writeFailedRef.current) {
      // Kuota penyimpanan penuh atau diblokir: draf hanya di memori, hilang bila halaman dimuat ulang.
      writeFailedRef.current = true;
      toast.warning(
        'Draf tidak dapat disimpan di perangkat ini. Selesaikan catatan sebelum menutup halaman.',
      );
    }
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: efek menjadwalkan tulis tiap draf berubah
  useEffect(() => {
    const timer = setTimeout(persistNow, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [itemId, filters, rows, submission, skipped, persistNow]);
  useEffect(() => {
    const flush = () => persistNow();
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [persistNow]);

  const frozen = submission !== undefined;
  const commitRows = useCallback((next: readonly WarehouseDraftRow[]) => {
    live.current.rows = next;
    setRows(next);
  }, []);
  const commitSkipped = useCallback((next: readonly WarehouseSkippedRowDto[]) => {
    live.current.skipped = next;
    setSkipped(next);
  }, []);
  const commitItem = useCallback((next: string) => {
    live.current.itemId = next;
    setItemId(next);
  }, []);

  // --- Item ---
  const [itemTerm, setItemTerm] = useState('');
  const itemOptionsQuery = useInfiniteQuery(
    warehouseItemOptionsQueryOptions({
      ...(itemTerm.trim() !== '' ? { query: itemTerm.trim() } : {}),
      ...(filters.buId !== '' ? { buId: filters.buId } : {}),
    }),
  );
  const itemList = useMemo(
    () => itemOptionsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [itemOptionsQuery.data],
  );
  const knownItems = useRef(new Map<string, WarehouseItemOptionDto>());
  for (const entry of itemList) knownItems.current.set(entry.id, entry);
  const itemById = useQuery({
    queryKey: ['serialwh', 'item', itemId],
    queryFn: async () =>
      (await api('serialWarehouse.itemOptions', { ids: [itemId] })).items[0] ?? null,
    enabled: itemId !== '',
    staleTime: 5 * 60_000,
  });
  if (itemById.data) knownItems.current.set(itemById.data.id, itemById.data);
  const item = itemId === '' ? null : (knownItems.current.get(itemId) ?? null);
  const itemLinkOptions = useMemo<LinkOption[]>(
    () => itemList.map((entry) => ({ id: entry.id, label: entry.label })),
    [itemList],
  );

  // --- Daftar serial dari server (Item terisi) ---
  const [queryText, setQueryText] = useState('');
  const filterTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(filterTimer.current), []);
  const onFilterChange = useCallback((text: string) => {
    clearTimeout(filterTimer.current);
    filterTimer.current = setTimeout(() => setQueryText(text.trim()), FILTER_DEBOUNCE_MS);
  }, []);
  const serialsQuery = useInfiniteQuery(
    warehouseSerialsQueryOptions({
      itemId,
      ...(filters.buId !== '' ? { buIds: [filters.buId] } : {}),
      ...(filters.locationId !== '' ? { locationId: filters.locationId } : {}),
      ...(filters.testDate !== '' ? { testDate: filters.testDate } : {}),
      ...(queryText !== '' ? { query: queryText } : {}),
      ...(filters.hideRecorded && filters.buId !== '' ? { hideRecordedBuId: filters.buId } : {}),
      forMode: 'note' as const,
    }),
  );
  const candidates = useMemo(
    () => serialsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [serialsQuery.data],
  );

  // --- Konteks task asal (5.14 pemakaian 1) ---
  const contextQuery = useQuery(warehouseContextQueryOptions(handoverId ?? ''));
  const handoverContext = handoverId ? contextQuery.data : undefined;
  const [autoFilled, setAutoFilled] = useState<{
    itemId: string;
    label: string;
    lines: number;
  } | null>(null);
  const autoRan = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: hanya sekali saat konteks tiba
  useEffect(() => {
    if (autoRan.current || !handoverContext) return;
    autoRan.current = true;
    const [only] = handoverContext.detected;
    if (handoverContext.detected.length === 1 && only && live.current.itemId === '') {
      commitItem(only.itemId);
      setAutoFilled({ itemId: only.itemId, label: only.label, lines: only.lines });
    }
  }, [handoverContext]);

  // --- Dialog dan umpan balik ---
  const [line, setLine] = useState<ScanLine | null>(null);
  const [typeDialog, setTypeDialog] = useState<TypeDialogState | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Galat nomor kardus dari server: dialog simpan dibuka lagi dengan pesan pada field nomor kardus awal.
  const [boxStartError, setBoxStartError] = useState<string | undefined>(undefined);
  const [clearOpen, setClearOpen] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [result, setResult] = useState<{
    text: string;
    count: number;
    skipped: readonly WarehouseSkippedRowDto[];
    dispatchId: string;
    /** Tiada pada pencatatan ready (tanpa SO). */
    orderId?: string;
    copied: boolean;
  } | null>(null);
  const [failedSerial, setFailedSerial] = useState<{ serial: string; message: string } | null>(
    null,
  );
  const [flash, setFlash] = useState<'rejected' | null>(null);
  const [missing, setMissing] = useState<readonly MissingField[]>([]);
  // Baris hasil scan terakhir (termasuk yang sudah ada di pilihan) disorot sebentar (spek 5.12).
  const [highlighted, setHighlighted] = useState<ReadonlySet<string>>(() => new Set());
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(highlightTimer.current), []);
  const highlightKeys = useCallback((keys: readonly string[]) => {
    clearTimeout(highlightTimer.current);
    setHighlighted(new Set(keys));
    highlightTimer.current = setTimeout(() => setHighlighted(new Set()), HIGHLIGHT_MS);
  }, []);

  const selectedCount = rows.length;
  const newCount = rows.filter((row) => row.kind === 'new').length;

  // --- Scan (antrean berurutan: pemindai fisik lebih cepat dari lookup) ---
  const queue = useRef<Promise<void>>(Promise.resolve());
  const processScans = useCallback(
    async (text: string, silent = false) => {
      // `silent`: hasil dari dialog kamera, yang sudah membunyikan nada saat membaca; tanpa ini tiap baris yang
      // disimpan membunyikan nada lagi (50 serial = 50 bunyi).
      const ring = (tone: ScanLine['tone']) => {
        if (!silent) announce(tone);
      };
      const split = splitSerialInput(text);
      const wanted = split.serials;
      if (wanted.length === 0) {
        ring('rejected');
        setLine({ tone: 'rejected', text: 'Serial Number tidak sah' });
        return;
      }
      // Duplikat sesi dicek SEBELUM jaringan: dua scan cepat satu SN tidak menjadi dua draf baru.
      const present = new Set(live.current.rows.map((row) => row.serial));
      const fresh = wanted.filter((serial) => !present.has(serial));
      const found = new Map<string, WarehouseSerialDto>();
      try {
        for (let start = 0; start < fresh.length; start += LOOKUP_CHUNK) {
          const output = await lookupWarehouseSerials({
            serials: fresh.slice(start, start + LOOKUP_CHUNK),
          });
          for (const dto of output.found) found.set(normalizeSerial(dto.serial), dto);
        }
      } catch {
        ring('rejected');
        setLine({ tone: 'rejected', text: 'Tidak bisa mencari ke server. Coba lagi.' });
        return;
      }
      // Pilihan/isian bisa berubah selama menunggu server: baca ulang nilai terkini. Struktur bantu dibangun SEKALI
      // dan diperbarui bertahap, jadi tempelan ribuan baris ke draf ribuan baris tetap linear.
      let curItemId = live.current.itemId;
      const baseRows = live.current.rows;
      const acc: WarehouseDraftRow[] = [...baseRows];
      const bySerial = new Map<string, WarehouseDraftRow>(acc.map((row) => [row.serial, row]));
      const tracker = createReferenceTracker(acc.map(rowTestDate));
      const touched: string[] = [];
      const missingNow = new Set<MissingField>();
      const addAcc = (row: WarehouseDraftRow) => {
        acc.push(row);
        bySerial.set(row.serial, row);
        tracker.add(rowTestDate(row));
        touched.push(rowKey(row));
      };
      const stats = { added: 0, fresh: 0, skipped: 0, duplicate: 0 };
      let last: { text: string; tone: ScanLine['tone'] } | null = null;
      let dialog: TypeDialogState | null = null;
      for (const serial of wanted) {
        const dto = found.get(serial) ?? null;
        const outcome = classifyScan(
          {
            itemId: curItemId,
            draftSerials: bySerial,
            draftCount: acc.length,
            filters: live.current.filters,
            formBuId: live.current.filters.buId,
            referenceTestDate: tracker.best(),
          },
          dto,
          serial,
        );
        const message = scanMessage(outcome, dto, serial);
        switch (outcome.kind) {
          case 'select': {
            if (!dto) break;
            if (curItemId === '') {
              curItemId = dto.itemId;
              knownItems.current.set(dto.itemId, {
                id: dto.itemId,
                label: dto.itemLabel,
                brandName: '',
                model: '',
                buIds: [],
                proofRequired: false,
                proofMin: 0,
                boxSize: 0,
              });
            }
            addAcc(makeExistingRow(dto));
            stats.added += 1;
            last = { text: message, tone: 'added' };
            break;
          }
          case 'new_draft': {
            const filtersNow = live.current.filters;
            addAcc(
              makeNewRow({
                serial,
                itemId: curItemId,
                buId: filtersNow.buId,
                locationId: filtersNow.locationId,
                testDate: filtersNow.testDate,
              }),
            );
            stats.fresh += 1;
            last = { text: message, tone: 'added' };
            break;
          }
          case 'duplicate_in_session': {
            const existing = bySerial.get(serial);
            if (existing) touched.push(rowKey(existing));
            stats.duplicate += 1;
            last = { text: message, tone: 'duplicate' };
            break;
          }
          case 'missing_defaults':
            stats.skipped += 1;
            for (const field of outcome.missing ?? []) missingNow.add(field);
            last = {
              text: `${missingMessage(outcome.missing ?? [])}`,
              tone: 'rejected',
            };
            break;
          case 'confirm_switch_item':
            stats.skipped += 1;
            if (dto && dialog === null) dialog = { kind: 'switch', serial: dto };
            last = { text: message, tone: 'rejected' };
            break;
          case 'error_type':
            stats.skipped += 1;
            if (dto && dialog === null) {
              dialog = {
                kind: 'error',
                serial: dto,
                itemLabel: knownItems.current.get(curItemId)?.label ?? 'Item terpilih',
              };
            }
            last = { text: message, tone: 'rejected' };
            break;
          case 'not_eligible':
            stats.skipped += 1;
            last = { text: message, tone: 'rejected' };
            break;
        }
      }
      if (curItemId !== live.current.itemId) commitItem(curItemId);
      if (acc.length !== baseRows.length) commitRows(acc);
      if (touched.length > 0) highlightKeys(touched);
      setMissing([...missingNow]);
      const total = wanted.length;
      const summary =
        total === 1 && last
          ? last
          : {
              tone: (stats.skipped > 0 ? 'rejected' : 'added') as ScanLine['tone'],
              text: `${stats.added + stats.fresh} dipilih${stats.fresh > 0 ? ` (${stats.fresh} baru)` : ''}${
                stats.duplicate > 0 ? `, ${stats.duplicate} sudah ada` : ''
              }${stats.skipped > 0 ? `, ${stats.skipped} ditahan` : ''}`,
            };
      setLine(summary);
      ring(summary.tone);
      setFlash(summary.tone === 'rejected' ? 'rejected' : null);
      if (dialog) setTypeDialog(dialog);
    },
    [announce, commitItem, commitRows, highlightKeys],
  );
  const handleScan = useCallback(
    (text: string, options?: { silent?: boolean }) => {
      unlock();
      queue.current = queue.current
        .then(() => processScans(text, options?.silent === true))
        .catch(() => undefined);
    },
    [processScans, unlock],
  );
  const isKnown = useCallback(
    (serial: string) => live.current.rows.some((row) => row.serial === serial),
    [],
  );

  // --- Mengubah pilihan ---
  const addDtos = useCallback(
    (dtos: readonly WarehouseSerialDto[]) => {
      let next = live.current.rows;
      for (const dto of dtos) next = addRow(next, makeExistingRow(dto));
      commitRows(next);
    },
    [commitRows],
  );
  const removeKeys = useCallback(
    (keys: readonly string[]) => {
      commitRows(removeRows(live.current.rows, new Set(keys)));
    },
    [commitRows],
  );
  function clearSelection() {
    commitRows([]);
    setFailedSerial(null);
    setLine(null);
  }
  function requestClear() {
    if (live.current.rows.length === 0) return;
    if (live.current.rows.some((row) => row.kind === 'new')) setClearOpen(true);
    else clearSelection();
  }

  // --- Kirim ---
  const runDispatch = useCallback(
    (sub: WarehouseDraftSubmission) => {
      // Clipboard dimulai SEKARANG, sinkron di dalam gestur klik; teksnya menyusul saat server selesai.
      let resolveText: (text: string) => void = () => undefined;
      let rejectText: (error: unknown) => void = () => undefined;
      const textPromise = new Promise<string>((resolve, reject) => {
        resolveText = resolve;
        rejectText = reject;
      });
      textPromise.catch(() => undefined);
      const copied = copyLines(textPromise);
      const chunkCount = Math.ceil(sub.header.total / sub.chunkSize);
      setProgress({ phase: 'sending', sent: sub.sentChunks, chunkCount });
      // Alur keluar aplikasi memperingatkan selama kiriman berjalan (draf dibuang saat keluar).
      const endSubmitting = beginWarehouseSubmit();
      const rowsAtStart = live.current.rows;
      void runSubmission({
        submission: sub,
        rows: rowsAtStart,
        send: (input) => sendChunk(input),
        onChunk: ({ sentChunks, output }) => {
          const next = {
            ...(live.current.submission ?? sub),
            sentChunks,
            ...(output.orderId ? { orderId: output.orderId } : {}),
            dispatchId: output.dispatchId,
          };
          live.current.submission = next;
          setSubmission(next);
          // Baris yang dilewati server tetap di draf dan ditandai; kiriman ulang potongan memberi daftar yang sama.
          if (output.skipped.length > 0) {
            commitSkipped(mergeSkipped(live.current.skipped, output.skipped));
          }
          persistNow();
          setProgress({ phase: 'sending', sent: sentChunks, chunkCount });
        },
      })
        .then(async (outcome: SubmitResult) => {
          if (outcome.status === 'done') {
            const output: WarehouseSubmitOutput = outcome.output;
            const allSkipped = mergeSkipped(live.current.skipped, output.skippedTotal ?? []);
            const skippedSerials = new Set(allSkipped.map((entry) => entry.serial));
            // Clipboard hanya berisi SN yang BERHASIL masuk.
            const okSerials =
              output.serials ??
              rowsAtStart.map((row) => row.serial).filter((serial) => !skippedSerials.has(serial));
            const text = clipboardText(okSerials);
            resolveText(text);
            const ok = await copied;
            live.current.submission = undefined;
            setSubmission(undefined);
            // Baris yang berhasil keluar dari draf; baris yang dilewati TETAP (ditandai) agar dapat diperbaiki.
            const remaining = live.current.rows.filter((row) => skippedSerials.has(row.serial));
            commitRows(remaining);
            commitSkipped(
              allSkipped.filter((entry) => remaining.some((row) => row.serial === entry.serial)),
            );
            if (remaining.length === 0) commitItem('');
            setProgress(null);
            setFailedSerial(null);
            setLine(null);
            if (remaining.length === 0) clearWarehouseDraft(emailRef.current);
            else persistNow();
            setResult({
              text,
              skipped: allSkipped,
              count: okSerials.length,
              dispatchId: output.dispatchId,
              ...(output.orderId ? { orderId: output.orderId } : {}),
              copied: ok,
            });
            return;
          }
          rejectText(new Error('Catatan belum selesai'));
          if (outcome.status === 'paused') {
            setProgress({ phase: 'paused', sent: outcome.sentChunks, chunkCount });
            return;
          }
          if (outcome.chunkIndex === 0) {
            // Potongan pertama atomik: tidak ada yang tersimpan, jadi kiriman dibuka lagi dan baris bisa diperbaiki.
            live.current.submission = undefined;
            setSubmission(undefined);
            if (BOX_TAKEN.test(outcome.message)) {
              setBoxStartError(outcome.message);
              setProgress(null);
              setConfirmOpen(true);
              return;
            }
          }
          if (outcome.serial) setFailedSerial({ serial: outcome.serial, message: outcome.message });
          setProgress({
            phase: 'failed',
            sent: outcome.sentChunks,
            chunkCount,
            chunkIndex: outcome.chunkIndex,
            message: outcome.message,
            serial: outcome.serial,
          });
        })
        .finally(endSubmitting);
    },
    [commitItem, commitRows, commitSkipped, persistNow, sendChunk],
  );

  /** Dipanggil SINKRON dari klik "Simpan & salin" di dialog konfirmasi. */
  function startSubmit(values: ConfirmValues) {
    // Kiriman baru: tanda "dilewati" dari kiriman sebelumnya tidak berlaku lagi.
    commitSkipped([]);
    setBoxStartError(undefined);
    // Lokasi dialog menjadi lokasi SEMUA serial baru (menimpa lokasi chip saat scan); tanggal uji hanya mengisi yang
    // kosong: chip Tanggal uji bila terisi, selain itu tanggal keluar. Urutan baris TIDAK diubah (= urutan masuk ke
    // pilihan = urutan `seq` dan penomoran kardus).
    if (live.current.rows.some((row) => row.kind === 'new')) {
      const chipTestDate = live.current.filters.testDate;
      commitRows(
        live.current.rows.map((row) =>
          row.kind === 'new'
            ? {
                ...row,
                buId: row.buId === '' ? values.buId : row.buId,
                locationId: values.locationId,
                testDate:
                  row.testDate === ''
                    ? chipTestDate !== ''
                      ? chipTestDate
                      : values.dispatchedOn
                    : row.testDate,
              }
            : row,
        ),
      );
    }
    const sub = freezeSubmission(live.current.rows, {
      mode: 'note' as const,
      boxStart: values.boxStart,
      boxSize: values.boxSize,
      dispatchedOn: values.dispatchedOn,
      orderNumber: '',
      buId: values.buId,
      customerName: '',
      itemId: live.current.itemId,
      note: values.note,
      handoverIds: values.handoverIds,
    });
    live.current.submission = sub;
    setSubmission(sub);
    // BU SO yang dicocokkan di dialog baru berlaku saat disimpan (membatalkan dialog tidak mengubah chip BU form).
    if (values.buId !== live.current.filters.buId) {
      const nextFilters = { ...live.current.filters, buId: values.buId };
      live.current.filters = nextFilters;
      setFilters(nextFilters);
    }
    persistNow();
    setConfirmOpen(false);
    runDispatch(sub);
  }

  function resume() {
    const sub = live.current.submission;
    if (sub) runDispatch(sub);
  }

  function discardSubmission() {
    live.current.submission = undefined;
    setSubmission(undefined);
    setProgress(null);
    toast.message(
      'Kiriman dibatalkan. Bagian yang sudah tersimpan dibatalkan otomatis dalam 7 hari bila tidak dilanjutkan.',
    );
  }

  // Tanda "dilewati" hanya untuk baris yang masih ada di draf.
  const skippedReasons = useMemo(() => {
    const present = new Set(rows.map((row) => row.serial));
    return new Map(
      skipped
        .filter((entry) => present.has(entry.serial))
        .map((entry) => [entry.serial, entry.reason]),
    );
  }, [skipped, rows]);
  const formBuId = filters.buId;
  const { counts, serials: warningSerials } = useMemo(
    () => countWarnings(rows, formBuId),
    [rows, formBuId],
  );

  const detected = handoverContext?.detected ?? [];
  const itemExtra = (
    <>
      {autoFilled && itemId === autoFilled.itemId ? (
        <p className="text-xs text-muted-foreground">
          Terisi dari catatan task ({autoFilled.lines} baris menyebut {autoFilled.label}). Ubah bila
          bukan ini.
        </p>
      ) : null}
      {itemId === '' && detected.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">Terdeteksi di catatan:</span>
          {detected.map((entry) => (
            <Button
              key={entry.itemId}
              type="button"
              size="sm"
              variant="outline"
              color="primary"
              onClick={() => commitItem(entry.itemId)}
            >
              {entry.label} ({entry.lines} baris)
            </Button>
          ))}
        </div>
      ) : null}
    </>
  );

  const resolvedBuCode = buCodeOf;
  return (
    <>
      <FormPage
        formId="warehouse-dispatch-form"
        title="Catat Serial WH"
        onCancel={onCancel}
        submitLabel={`Salin ke clipboard (${selectedCount})`}
        submitDisabled={selectedCount === 0 || frozen}
        {...(phone && selectedCount > 0
          ? {
              selectionBar: (
                <SelectionSummary
                  count={selectedCount}
                  allSelected={allSelected}
                  disabled={frozen}
                  onClear={requestClear}
                  onToggleAll={() => (allSelected ? requestClear() : selectAllRef.current?.())}
                />
              ),
            }
          : {})}
      >
        <form
          id="warehouse-dispatch-form"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (selectedCount > 0 && !frozen) setConfirmOpen(true);
          }}
        >
          <DispatchHeader
            itemId={itemId}
            itemOptions={itemLinkOptions}
            itemLoading={itemOptionsQuery.isFetching && itemOptionsQuery.data === undefined}
            hasMoreItems={itemOptionsQuery.hasNextPage}
            onItemSearch={setItemTerm}
            onItemChange={(id) => commitItem(id ?? '')}
            itemLabelOf={(id) => knownItems.current.get(id)?.label}
            selectedCount={selectedCount}
            onClearSelection={requestClear}
            filters={filters}
            onFiltersChange={(patch) => setFilters((current) => ({ ...current, ...patch }))}
            buOptions={buOptions}
            locationOptions={locationOptions}
            frozen={frozen}
            itemExtra={itemExtra}
            phone={phone}
            missing={missing}
            scan={
              <ScanBar
                onFilterChange={onFilterChange}
                onScan={handleScan}
                isKnown={isKnown}
                disabled={frozen || itemId === ''}
                lockedPlaceholder={frozen ? undefined : 'Pilih Item dulu'}
                line={line}
                flash={flash}
                sticky={phone}
              />
            }
          />

          {frozen && submission ? (
            <Alert color="info">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  Catatan belum selesai dikirim ({submission.sentChunks} dari{' '}
                  {Math.ceil(submission.header.total / submission.chunkSize)} potongan). Pilihan
                  dikunci sampai selesai.
                </span>
                <span className="flex gap-2">
                  <Button type="button" size="sm" onClick={resume}>
                    Lanjutkan
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    color="destructive"
                    onClick={discardSubmission}
                  >
                    Batalkan kiriman
                  </Button>
                </span>
              </AlertDescription>
            </Alert>
          ) : null}

          {failedSerial && !frozen ? (
            <Alert color="destructive">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {failedSerial.serial}: {failedSerial.message}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  color="destructive"
                  onClick={() => {
                    const target = live.current.rows.find(
                      (row) => row.serial === failedSerial.serial,
                    );
                    if (target) removeKeys([rowKey(target)]);
                    setFailedSerial(null);
                  }}
                >
                  Keluarkan dari pilihan
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          {skippedReasons.size > 0 && !frozen ? (
            <Alert color="warning">
              <AlertDescription>
                {skippedReasons.size} serial dilewati server dan masih ada di pilihan (ditandai di
                tabel). Perbaiki atau keluarkan, lalu kirim lagi.
              </AlertDescription>
            </Alert>
          ) : null}

          {newCount > 0 ? (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {newCount} draf baru
            </p>
          ) : null}
          <WarningBanners counts={counts} serials={warningSerials} />

          {/* Desktop: aksi pilihan langsung di atas tabel (Batalkan pilihan + jumlah). Ponsel: bar bawah form. */}
          {desktop && selectedCount > 0 ? (
            <BulkBar count={selectedCount} onClear={requestClear} busy={frozen}>
              {null}
            </BulkBar>
          ) : null}
          <SelectModeProvider>
            <DispatchTable
              onAllSelectedChange={setAllSelected}
              selectAllRef={selectAllRef}
              draftRows={rows}
              candidates={itemId === '' ? [] : candidates}
              item={item}
              formBuId={formBuId}
              buCodeOf={resolvedBuCode}
              locationNameOf={locationNameOf}
              frozen={frozen}
              skippedReasons={skippedReasons}
              highlighted={highlighted}
              onAdd={addDtos}
              onRemove={removeKeys}
              isLoading={itemId !== '' && serialsQuery.isPending}
              isError={serialsQuery.isLoadingError}
              onRetry={() => void serialsQuery.refetch()}
              hasMore={serialsQuery.hasNextPage}
              loadingMore={serialsQuery.isFetchingNextPage}
              onLoadMore={() => void serialsQuery.fetchNextPage()}
              empty={
                itemId === ''
                  ? 'Pilih Item atau scan serial untuk mulai'
                  : 'Tidak ada serial yang cocok'
              }
              filtered={
                itemId !== '' &&
                (queryText !== '' ||
                  filters.buId !== '' ||
                  filters.locationId !== '' ||
                  filters.testDate !== '')
              }
            />
          </SelectModeProvider>
        </form>
      </FormPage>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        rows={rows}
        item={item}
        formBuId={formBuId}
        buOptions={buOptions}
        locationOptions={locationOptions}
        defaultLocationId={filters.locationId}
        activeLocationIds={activeLocationIds}
        handoverContext={handoverContext}
        originHandoverId={handoverId}
        onConfirm={startSubmit}
        boxStartError={boxStartError}
      />
      <TypeMismatchDialog
        state={typeDialog}
        onClose={() => setTypeDialog(null)}
        onClearSelection={requestClear}
        onSwitch={(dto) => {
          commitItem(dto.itemId);
          knownItems.current.set(dto.itemId, {
            id: dto.itemId,
            label: dto.itemLabel,
            brandName: '',
            model: '',
            buIds: [],
            proofRequired: false,
            proofMin: 0,
            boxSize: 0,
          });
          commitRows(addRow(live.current.rows, makeExistingRow(dto)) as WarehouseDraftRow[]);
          setTypeDialog(null);
        }}
      />
      <SubmitProgressDialog
        state={progress}
        onResume={resume}
        onClose={() => setProgress(null)}
        onDiscard={discardSubmission}
      />
      <ClipboardResultDialog
        open={result !== null}
        onOpenChange={(open) => {
          if (!open) setResult(null);
        }}
        text={result?.text ?? ''}
        count={result?.count ?? 0}
        skipped={result?.skipped ?? []}
        copied={result?.copied === true}
        onOpenHistory={
          result && canReadWarehouse(me)
            ? () => {
                const { dispatchId } = result;
                setResult(null);
                stack.push({ to: '/serial/gudang/riwayat/$dispatchId', params: { dispatchId } });
              }
            : undefined
        }
      />
      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Batalkan pilihan?</AlertDialogTitle>
            <AlertDialogDescription>
              {newCount} serial draf baru akan terbuang. Serial yang sudah ada tidak berubah.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Kembali</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                clearSelection();
                setClearOpen(false);
              }}
            >
              Batalkan pilihan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
