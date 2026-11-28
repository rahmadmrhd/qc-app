import type {
  WarehouseHandoverCandidateDto,
  WarehouseHandoverContextDto,
  WarehouseItemOptionDto,
} from '@shared/contract';
import { WAREHOUSE_BOX_LIMITS, WAREHOUSE_LIMITS } from '@shared/serial-warehouse';
import { isIsoDate } from '@shared/serials';
import { useRef, useState } from 'react';
import { LinkField, type LinkOption } from '@/components/link-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { HandoverStatusBadge } from '@/modules/handover/components/handover-status-badge';
import { WysiwygEditor } from '@/modules/markdown/wysiwyg-editor';
import { todayWib } from '@/modules/serial/lib/locations';
import {
  defaultBuId as pickDefaultBu,
  defaultLocationId as pickDefaultLocation,
} from '../lib/defaults';
import { summarizeRows } from '../lib/draft';
import type { WarehouseDraftRow } from '../lib/draft-store';
import { boxPlanSummary, parsePositiveInt } from '../lib/ready-box';
import { countWarnings } from '../lib/warnings';
import { CandidateNote, MarkLegend } from './candidate-note';
import { HandoverLinkPicker } from './handover-link-picker';
import { WarningBanners } from './warning-banners';

export interface ConfirmValues {
  /** Satu-satunya tujuan yang ditawarkan: catatan saja (tanpa SO dan customer). */
  mode: 'note';
  dispatchedOn: string;
  buId: string;
  /** Markdown. */
  note: string;
  handoverIds: string[];
  /**
   * Lokasi dialog: melengkapi serial baru yang belum berlokasi dan membatasi daftar task Serah Terima. Serial baru yang
   * belum punya tanggal uji memakai tanggal catat (diisi halaman; chip Tanggal uji menang bila terisi).
   */
  locationId: string;
  boxStart: number;
  boxSize: number;
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: readonly WarehouseDraftRow[];
  item: WarehouseItemOptionDto | null;
  /** BU form saat ini (chip BU). */
  formBuId: string;
  buOptions: readonly LinkOption[];
  locationOptions: readonly LinkOption[];
  /** Nilai awal dari chip Lokasi form (boleh kosong; bila terisi menang atas data serial dan lokasi aktif). */
  defaultLocationId: string;
  /** Lokasi aktif pengguna (cadangan Lokasi bila tepat satu). */
  activeLocationIds?: readonly string[];
  /** Konteks task asal (`?handover`). */
  handoverContext?: WarehouseHandoverContextDto | undefined;
  originHandoverId?: string | undefined;
  /** Dipanggil SINKRON dari klik "Simpan & salin" (gestur untuk clipboard). */
  onConfirm: (values: ConfirmValues) => void;
  /** Galat server pada nomor kardus awal dari kiriman sebelumnya. */
  boxStartError?: string | undefined;
}

/** Dialog simpan Catat Serial WH (hanya catatan): state direset tiap dibuka (isi hanya dipasang saat terbuka). */
export function ConfirmDialog(props: ConfirmDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="full-on-phone" className="sm:max-w-xl">
        {props.open ? <ConfirmBody {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ConfirmBody({
  onOpenChange,
  rows,
  item,
  formBuId,
  buOptions,
  locationOptions,
  defaultLocationId,
  activeLocationIds = [],
  handoverContext,
  originHandoverId,
  onConfirm,
  boxStartError,
}: ConfirmDialogProps) {
  const today = todayWib();
  const [dispatchedOn, setDispatchedOn] = useState(today);
  const [note, setNote] = useState('');
  const [handoverIds, setHandoverIds] = useState<string[]>(
    originHandoverId ? [originHandoverId] : [],
  );
  const [touched, setTouched] = useState(false);
  // BU dan Lokasi awal: chip form, lalu data serial yang sudah ada, lalu cadangan (satu BU Item, lokasi aktif tunggal).
  // Keduanya tetap dapat diubah; BU baru menggantikan chip BU form saat disimpan (batal tidak mengubah apa pun).
  const [pickedBuId, setPickedBuId] = useState(() =>
    pickDefaultBu({
      rows,
      chipBuId: formBuId,
      itemBuIds: item?.buIds ?? [],
      buOptionIds: buOptions.map((option) => option.id),
    }),
  );
  const [pickedLocationId, setPickedLocationId] = useState(() =>
    pickDefaultLocation({
      rows,
      chipLocationId: defaultLocationId,
      activeLocationIds,
      locationOptionIds: locationOptions.map((option) => option.id),
    }),
  );
  const buId = pickedBuId;
  // Lokasi dialog ini menjadi lokasi SEMUA serial baru (juga yang sudah berlokasi dari chip saat scan).
  const fillLocation = rows.some((row) => row.kind === 'new');
  // Task tertaut yang pernah dimuat pemilih (untuk konfirmasi kecocokan sebelum simpan).
  const candidateRegistry = useRef(new Map<string, WarehouseHandoverCandidateDto>());
  const [mismatch, setMismatch] = useState<WarehouseHandoverCandidateDto[] | null>(null);
  // Pemilih memberi tahu bila `candidateRegistry` terisi, supaya tanda "belum diperiksa" ikut menyegar.
  const [, bumpRegistry] = useState(0);

  const summary = summarizeRows(rows);
  const { counts } = countWarnings(rows, buId);
  const needsPhotoBanner = rows.some((row) => row.kind === 'new') && item?.proofRequired === true;

  const [boxStartText, setBoxStartText] = useState<string | null>(null);
  const [boxSizeText, setBoxSizeText] = useState<string | null>(null);
  const boxStartShown = boxStartText ?? '1';
  const boxSizeShown = boxSizeText ?? (item && item.boxSize > 0 ? String(item.boxSize) : '');
  const boxStart = parsePositiveInt(boxStartShown);
  const boxSize = parsePositiveInt(boxSizeShown);
  const boxSummary =
    boxStart !== null && boxSize !== null
      ? boxPlanSummary({ startNumber: boxStart, size: boxSize, count: rows.length })
      : null;

  const needsItemBu = rows.some((row) => row.kind === 'new');
  const errors = {
    date:
      !isIsoDate(dispatchedOn) || dispatchedOn > today
        ? 'Tanggal catat tidak boleh setelah hari ini'
        : undefined,
    bu:
      buId === ''
        ? 'BU wajib dipilih'
        : needsItemBu && item && item.buIds.length > 0 && !item.buIds.includes(buId)
          ? 'Item ini bukan milik BU tersebut; serial baru tidak dapat dibuat'
          : undefined,
    location: fillLocation && pickedLocationId === '' ? 'Lokasi wajib dipilih' : undefined,
    boxStart:
      boxStart === null || boxStart > WAREHOUSE_BOX_LIMITS.numberMax
        ? `Nomor kardus awal harus 1 sampai ${WAREHOUSE_BOX_LIMITS.numberMax}`
        : undefined,
    boxSize:
      boxSize === null || boxSize > WAREHOUSE_BOX_LIMITS.sizeMax
        ? boxSize === null
          ? 'Isi per kardus harus lebih dari 0'
          : `Isi per kardus maksimal ${WAREHOUSE_BOX_LIMITS.sizeMax}`
        : undefined,
    note: [...note].length > WAREHOUSE_LIMITS.noteMax ? 'Catatan terlalu panjang' : undefined,
  };
  const blocked = Object.values(errors).some((message) => message !== undefined);

  function submit() {
    setTouched(true);
    if (blocked) return;
    // Konfirmasi kecocokan hanya bila TIDAK ada satu pun task tertaut yang menyebut Item ini (tanpa baris hijau):
    // cukup satu task yang cocok untuk dianggap permintaan sudah sesuai (keputusan pemilik 2026-11-28).
    if (item) {
      const linked = handoverIds.flatMap((id) => {
        const candidate = candidateRegistry.current.get(id);
        return candidate ? [candidate] : [];
      });
      if (linked.length > 0 && !linked.some((candidate) => candidate.mentionsItem)) {
        setMismatch(linked);
        return;
      }
    }
    proceed();
  }

  // Task tertaut (mis. task asal di lokasi lain dari Lokasi dialog) yang tak pernah dimuat pemilih: kecocokannya belum
  // diperiksa. Hanya tanda; tidak memblokir simpan.
  const uncheckedIds = item ? handoverIds.filter((id) => !candidateRegistry.current.has(id)) : [];

  /** Memanggil `onConfirm` SINKRON dari klik (tombol Simpan, atau tombol konfirmasi kecocokan). */
  function proceed() {
    if (boxStart === null || boxSize === null) return;
    onConfirm({
      mode: 'note',
      dispatchedOn,
      buId,
      note: note.trim(),
      handoverIds,
      boxStart,
      boxSize,
      locationId: pickedLocationId,
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Simpan Catat Serial WH</DialogTitle>
        <DialogDescription>
          {summary.total} Serial Number
          {summary.newCount > 0 ? `, ${summary.newCount} baru` : ''}
          {item ? ` · ${item.label}` : ''}
          {summary.testDateFrom !== ''
            ? ` · uji ${summary.testDateFrom}${
                summary.testDateTo !== summary.testDateFrom ? ` s.d. ${summary.testDateTo}` : ''
              }`
            : ''}
        </DialogDescription>
      </DialogHeader>
      <form
        id="warehouse-confirm-form"
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="wh-dispatched-on" required>
            Tanggal catat
          </Label>
          <Input
            id="wh-dispatched-on"
            type="date"
            max={today}
            aria-required="true"
            value={dispatchedOn}
            onChange={(event) => setDispatchedOn(event.target.value)}
          />
          {touched && errors.date ? (
            <p role="alert" className="text-xs text-destructive-text">
              {errors.date}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <LinkField
            id="wh-bu"
            label="BU"
            required
            value={buId === '' ? null : buId}
            onChange={(next) => setPickedBuId(next ?? '')}
            options={buOptions}
            localFilter
            highlight
            keyboardless
            placeholder="Pilih BU"
            {...(touched && errors.bu ? { error: errors.bu } : {})}
          />
        </div>

        <div className="space-y-1.5">
          <LinkField
            id="wh-location"
            label="Lokasi"
            required={fillLocation}
            value={pickedLocationId === '' ? null : pickedLocationId}
            onChange={(next) => setPickedLocationId(next ?? '')}
            options={locationOptions}
            localFilter
            highlight
            keyboardless
            placeholder="Pilih lokasi"
            {...(touched && errors.location ? { error: errors.location } : {})}
          />
          {fillLocation ? (
            <p className="text-xs text-muted-foreground">Dipakai juga untuk serial baru.</p>
          ) : null}
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="wh-box-start" required>
                Nomor kardus awal
              </Label>
              <Input
                id="wh-box-start"
                type="number"
                inputMode="numeric"
                min={1}
                max={WAREHOUSE_BOX_LIMITS.numberMax}
                aria-required="true"
                value={boxStartShown}
                onChange={(event) => setBoxStartText(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wh-box-size" required>
                Isi per kardus
              </Label>
              <Input
                id="wh-box-size"
                type="number"
                inputMode="numeric"
                min={1}
                max={WAREHOUSE_BOX_LIMITS.sizeMax}
                aria-required="true"
                value={boxSizeShown}
                onChange={(event) => setBoxSizeText(event.target.value)}
              />
            </div>
          </div>
          {boxStartError && boxStartText === null ? (
            <p role="alert" className="text-xs text-destructive-text">
              {boxStartError}
            </p>
          ) : null}
          {touched && errors.boxStart ? (
            <p role="alert" className="text-xs text-destructive-text">
              {errors.boxStart}
            </p>
          ) : null}
          {touched && errors.boxSize ? (
            <p role="alert" className="text-xs text-destructive-text">
              {errors.boxSize}
            </p>
          ) : null}
          {boxSummary ? (
            <p className="text-xs text-muted-foreground" role="status">
              {boxSummary}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label id="wh-note-label">Catatan</Label>
          <WysiwygEditor
            id="wh-note"
            mode="note"
            value={note}
            onChange={setNote}
            labelledBy="wh-note-label"
            maxLength={WAREHOUSE_LIMITS.noteMax}
          />
          {touched && errors.note ? (
            <p role="alert" className="text-xs text-destructive-text">
              {errors.note}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label>Link Serah Terima (opsional)</Label>
          <HandoverLinkPicker
            locationId={pickedLocationId}
            registry={candidateRegistry}
            onRegistryChange={() => bumpRegistry((n) => n + 1)}
            {...(item ? { itemId: item.id } : {})}
            value={handoverIds}
            onChange={setHandoverIds}
            {...(originHandoverId ? { lockedIds: [originHandoverId] } : {})}
          />
          {uncheckedIds.length > 0 ? (
            <p className="text-xs text-warning-text" role="status">
              Task asal belum diperiksa kecocokannya dengan Item (daftar belum memuat task ini).
            </p>
          ) : null}
          {originHandoverId && handoverContext ? (
            <p className="text-xs text-muted-foreground">
              Catatan ini akan ditautkan ke task {handoverContext.handover.number}.
            </p>
          ) : null}
        </div>

        {needsPhotoBanner ? (
          <Alert color="warning">
            <AlertDescription>
              Serial baru untuk item wajib foto dicatat tanpa foto bukti. Ingatkan tim QC untuk
              melampirkan foto bukti QC.
            </AlertDescription>
          </Alert>
        ) : null}
        <WarningBanners counts={counts} />
        {summary.newCount > 0 ? (
          <p className="text-xs text-muted-foreground">
            <Badge color="info" variant="soft">
              {summary.newCount} baru
            </Badge>{' '}
            Serial baru dibuat saat disimpan dan stok stiker bawaannya terpotong sekali.
          </p>
        ) : null}
      </form>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          color="secondary"
          onClick={() => onOpenChange(false)}
        >
          Batal
        </Button>
        <Button type="button" onClick={submit} disabled={touched && blocked}>
          Simpan & salin
        </Button>
      </DialogFooter>
      <Dialog
        open={mismatch !== null}
        onOpenChange={(next) => {
          if (!next) setMismatch(null);
        }}
      >
        <DialogContent size="full-on-phone" className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Apakah daftar permintaan item ini sudah sesuai?</DialogTitle>
            <DialogDescription>
              {item ? `Item: ${item.label}. ` : ''}Periksa task di bawah sebelum disimpan.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <MarkLegend />
            <ul className="space-y-3" aria-label="Task yang perlu diperiksa">
              {(mismatch ?? []).map((candidate) => (
                <li key={candidate.id} className="space-y-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{candidate.number}</span>
                    <HandoverStatusBadge status={candidate.status} />
                  </div>
                  {candidate.mentionsItem ? null : (
                    <p className="text-sm text-warning-text">
                      Catatan task ini tidak menyebut Item ini.
                    </p>
                  )}
                  {candidate.mismatchLines.length > 0 ? (
                    <p className="text-sm text-warning-text">
                      Ada baris yang mungkin tidak cocok (menyebut Item lain).
                    </p>
                  ) : null}
                  <CandidateNote candidate={candidate} className="max-h-60" />
                </li>
              ))}
            </ul>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              color="secondary"
              onClick={() => setMismatch(null)}
            >
              Kembali
            </Button>
            <Button
              type="button"
              onClick={() => {
                setMismatch(null);
                // Keadaan dapat berubah selama dialog kecocokan terbuka (mis. pemeriksaan SO selesai): periksa ulang.
                if (blocked) {
                  setTouched(true);
                  return;
                }
                proceed();
              }}
            >
              Sesuai, lanjut simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
