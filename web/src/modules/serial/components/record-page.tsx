import { isIsoDate, SERIAL_LIMITS } from '@shared/serials';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
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
  removeRows,
  type StagingRow,
  toBatches,
  toRowInput,
} from '../lib/draft';
import { clearDraft, loadDraft, saveDraft } from '../lib/draft-store';
import { todayWib } from '../lib/locations';
import type { QcsnImport } from '../lib/qcsn';
import { serialStickerOptionsQueryOptions, useSaveSerialBatch } from '../queries';
import { BulkEditBar } from './bulk-edit-bar';
import { ImportExportBar } from './import-export-bar';
import { EMPTY_ITEM_BU, ItemBuField, type ItemBuValue } from './item-bu-field';
import { RowDetailDialog, type RowDetailResult } from './row-detail-dialog';
import { SerialLocationField } from './serial-location-field';
import { type ScanFeedback, SerialScanInput } from './serial-scan-input';
import { rowStatus, StagingTable } from './staging-table';

type NoticeTone = 'info' | 'warn' | 'error';
interface Notice {
  tone: NoticeTone;
  text: string;
}

interface SaveSummary {
  created: number;
  duplicate: number;
  failed: number;
}

export interface RecordPageProps {
  /** Dipanggil saat tabel sementara berubah antara kosong dan berisi (untuk konfirmasi keluar halaman). */
  onDirtyChange?: (dirty: boolean) => void;
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

/** Pesan ringkas untuk satu penambahan (tempel, ketik, atau pindai). */
function describeAdd(report: ReturnType<typeof addSerials>['report']): {
  feedback: ScanFeedback;
  notice: Notice;
} {
  const parts: string[] = [];
  if (report.added > 0) parts.push(`${report.added} serial ditambahkan`);
  if (report.duplicates > 0) parts.push(`${report.duplicates} ganda dilewati`);
  if (report.rejected.length > 0) {
    parts.push(`${report.rejected.length} ditolak (${report.rejected.slice(0, 3).join(', ')})`);
  }
  if (report.truncated) parts.push(`batas ${SERIAL_LIMITS.tableRows} baris tabel tercapai`);
  const feedback: ScanFeedback =
    report.added > 0 ? 'added' : report.duplicates > 0 ? 'duplicate' : 'rejected';
  const tone: NoticeTone = report.added > 0 && !report.truncated ? 'info' : 'warn';
  return { feedback, notice: { tone, text: parts.join('; ') || 'Tidak ada serial yang dibaca' } };
}

/** Halaman Catat Serial: bawaan rombongan, masukan pindai/tempel, tabel sementara, simpan per 200 baris. */
export function RecordPage({ onDirtyChange }: RecordPageProps) {
  const me = useMe();
  const queryClient = useQueryClient();
  const saveBatch = useSaveSerialBatch();
  const ownerKey = me.email;

  const [rows, setRows] = useState<StagingRow[]>(() => loadDraft(ownerKey));
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const setAllRows = (next: StagingRow[]) => {
    rowsRef.current = next;
    setRows(next);
  };

  const [item, setItem] = useState<ItemBuValue>(EMPTY_ITEM_BU);
  const [location, setLocation] = useState({ id: '', label: '' });
  const [testDate, setTestDate] = useState(() => todayWib());
  const [sample, setSample] = useState(false);
  const [note, setNote] = useState('');

  const [notice, setNotice] = useState<Notice | null>(null);
  const [summary, setSummary] = useState<SaveSummary | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [draftFailed, setDraftFailed] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  // Draf otomatis (ditunda); saat halaman ditutup, isi terakhir langsung disimpan.
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

  const selectedCount = rows.filter((row) => row.selected).length;
  const detailRow = detailId === null ? undefined : rows.find((row) => row.clientId === detailId);

  const defaults = (): Defaults => ({
    itemId: item.itemId,
    itemLabel: item.itemLabel,
    buId: item.buId,
    buLabel: item.buLabel,
    testDate,
    locationId: location.id,
    locationLabel: location.label,
    sample,
    note: note.trim(),
  });

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

  function patchRow(clientId: string, change: (row: StagingRow) => StagingRow) {
    setAllRows(rowsRef.current.map((row) => (row.clientId === clientId ? change(row) : row)));
  }

  const select = (clientId: string, selected: boolean) =>
    patchRow(clientId, (row) => ({ ...row, selected }));
  const selectAll = (selected: boolean) =>
    setAllRows(rowsRef.current.map((row) => ({ ...row, selected })));
  const edit = (clientId: string, patch: Partial<StagingRow>) =>
    patchRow(clientId, (row) => ({ ...clearOutcome(row), ...patch }));

  function commitSerial(clientId: string, serial: string): string | null {
    if (rowsRef.current.some((row) => row.clientId !== clientId && row.serial === serial)) {
      return 'Serial sudah ada di tabel';
    }
    edit(clientId, { serial });
    return null;
  }

  function removeOne(clientId: string) {
    setAllRows(removeRows(rowsRef.current, new Set([clientId])));
  }

  function selectedIds(): Set<string> {
    return new Set(rowsRef.current.filter((row) => row.selected).map((row) => row.clientId));
  }

  function applyBulkEdit(patch: BulkPatch) {
    setAllRows(applyBulk(rowsRef.current, selectedIds(), patch).map(clearSelectedOutcome));
    setNotice({ tone: 'info', text: `${selectedCount} baris diubah` });
  }

  function clearSelectedOutcome(row: StagingRow): StagingRow {
    return row.selected ? clearOutcome(row) : row;
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
      const before = rowsRef.current;
      const merged = fromQcsnRows(before, result.rows);
      const fresh = merged.rows.slice(before.length);
      // Rujukan item/BU/stiker dari berkas diperiksa ke server; yang tak ditemukan wajib dipilih ulang.
      const pairs = new Map<string, { itemId: string; buId: string }>();
      for (const row of fresh) {
        if (row.itemId !== '' && row.buId !== '') {
          pairs.set(`${row.itemId}|${row.buId}`, { itemId: row.itemId, buId: row.buId });
        }
      }
      const known = new Map<string, Set<string> | null>();
      await Promise.all(
        [...pairs].map(async ([key, pair]) => {
          try {
            const data = await queryClient.fetchQuery(
              serialStickerOptionsQueryOptions(pair.itemId, pair.buId),
            );
            known.set(key, new Set(data.stickers.map((sticker) => sticker.id)));
          } catch {
            known.set(key, null);
          }
        }),
      );
      let unresolved = 0;
      const checked = fresh.map((row): StagingRow => {
        const stickerIds = known.get(`${row.itemId}|${row.buId}`);
        if (stickerIds === null) {
          unresolved++;
          return { ...row, stickers: null, unresolved: ['item'] };
        }
        if (stickerIds !== undefined && row.stickers !== null) {
          if (row.stickers.some((sticker) => !stickerIds.has(sticker.stickerId))) {
            unresolved++;
            return { ...row, stickers: null, unresolved: ['stickers'] };
          }
        }
        return row;
      });
      setAllRows([...before, ...checked]);
      const parts = [
        `${fileName}: ${merged.added} baris baru`,
        `${merged.skipped} dilewati (sudah ada)`,
      ];
      if (result.problems.length > 0) {
        parts.push(
          `${result.problems.length} bermasalah (${result.problems
            .slice(0, 3)
            .map((problem) => (problem.row === null ? problem.message : `baris ${problem.row}`))
            .join(', ')})`,
        );
      }
      if (unresolved > 0) parts.push(`${unresolved} baris perlu memilih ulang item atau stiker`);
      if (merged.truncated) parts.push(`batas ${SERIAL_LIMITS.tableRows} baris tabel tercapai`);
      setNotice({
        tone: result.problems.length > 0 || unresolved > 0 || merged.truncated ? 'warn' : 'info',
        text: parts.join('; '),
      });
      setSummary(null);
    } finally {
      setImporting(false);
    }
  }

  async function handleSave() {
    if (saving || importing || rowsRef.current.length === 0) return;
    const current = rowsRef.current;
    const blocked = current.filter(
      (row) =>
        (row.unresolved?.length ?? 0) > 0 ||
        row.itemId === '' ||
        row.buId === '' ||
        row.locationId === '' ||
        !isIsoDate(row.testDate),
    );
    if (blocked.length > 0) {
      setNotice({
        tone: 'error',
        text: `${blocked.length} baris belum lengkap (item, lokasi, atau tanggal uji); lihat kolom Hasil.`,
      });
      return;
    }
    setSaving(true);
    setNotice(null);
    setSummary(null);
    try {
      // Baris yang pilihan stikernya belum dimuat memakai bawaan: semua stiker yang berlaku.
      const pending = new Map<string, { itemId: string; buId: string }>();
      for (const row of current) {
        if (row.stickers === null) {
          pending.set(`${row.itemId}|${row.buId}`, { itemId: row.itemId, buId: row.buId });
        }
      }
      const defaultsByPair = new Map<string, { stickerId: string; name: string; qty: number }[]>();
      try {
        await Promise.all(
          [...pending].map(async ([key, pair]) => {
            const data = await queryClient.fetchQuery(
              serialStickerOptionsQueryOptions(pair.itemId, pair.buId),
            );
            defaultsByPair.set(
              key,
              data.stickers.map((sticker) => ({
                stickerId: sticker.id,
                name: sticker.name,
                qty: sticker.defaultQty,
              })),
            );
          }),
        );
      } catch (error) {
        setNotice({
          tone: 'error',
          text: `Stiker yang berlaku gagal dimuat: ${describeError(error)}`,
        });
        return;
      }
      setAllRows(
        rowsRef.current.map((row) =>
          row.stickers === null
            ? { ...row, stickers: defaultsByPair.get(`${row.itemId}|${row.buId}`) ?? [] }
            : row,
        ),
      );

      const batches = toBatches(rowsRef.current);
      const tally: SaveSummary = { created: 0, duplicate: 0, failed: 0 };
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
    } finally {
      setSaving(false);
    }
  }

  const hasFailed = rows.some((row) => row.result === 'error');
  const blockedCount = rows.filter((row) => rowStatus(row).tone !== 'ok').length;

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Catat Serial</h1>

      <section aria-label="Bawaan rombongan" className="space-y-3 rounded-lg border p-4">
        <h2 className="text-sm font-semibold">Bawaan rombongan</h2>
        <p className="text-xs text-muted-foreground">
          Berlaku untuk serial yang ditambahkan sesudahnya; baris yang sudah ada tidak berubah.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ItemBuField
            idPrefix="default"
            label="Item"
            buFieldLabel="Business Unit"
            value={item}
            onChange={setItem}
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
        </div>
      </section>

      <SerialScanInput
        id="serial-scan"
        label="Pindai atau tempel serial (satu per baris)"
        onSubmit={addText}
        disabled={saving}
        autoFocus
      />

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
          Draf tidak tersimpan otomatis (penyimpanan perangkat penuh atau diblokir). Simpan atau
          ekspor berkas .qcsn agar hasil pindai tidak hilang.
        </p>
      ) : null}

      {selectedCount > 0 ? (
        <BulkEditBar
          count={selectedCount}
          onApply={applyBulkEdit}
          onRemove={() => setAllRows(removeRows(rowsRef.current, selectedIds()))}
          onClearSelection={() => selectAll(false)}
        />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Tabel sementara ({rows.length} baris)</h2>
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

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Belum ada serial. Pindai, ketik lalu Enter, tempel, atau impor berkas .qcsn.
        </p>
      ) : (
        <StagingTable
          rows={rows}
          onSelect={select}
          onSelectAll={selectAll}
          onEdit={edit}
          onCommitSerial={commitSerial}
          onOpenDetail={setDetailId}
          onRemove={removeOne}
        />
      )}

      {summary ? (
        <p role="status" className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
          Dibuat {summary.created}, duplikat {summary.duplicate}, gagal {summary.failed}.
          {rows.length > 0 ? ' Baris yang tersisa masih ada di tabel.' : ''}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
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
              setAllRows([]);
              clearDraft(ownerKey);
              setNotice(null);
              setSummary(null);
            }}
          >
            Kosongkan tabel
          </Button>
        ) : null}
      </div>

      {detailRow ? (
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
