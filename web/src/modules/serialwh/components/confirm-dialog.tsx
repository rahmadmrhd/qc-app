import type {
  WarehouseHandoverCandidateDto,
  WarehouseHandoverContextDto,
  WarehouseItemOptionDto,
  WarehouseOptionsDto,
} from '@shared/contract';
import { customerKey } from '@shared/handover';
import {
  normalizeOrderNumber,
  orderNumberProblem,
  WAREHOUSE_BOX_LIMITS,
  WAREHOUSE_LIMITS,
} from '@shared/serial-warehouse';
import { isIsoDate } from '@shared/serials';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { LinkField, type LinkOption } from '@/components/link-field';
import { Select } from '@/components/select';
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
import { Textarea } from '@/components/ui/textarea';
import { CustomerCombobox } from '@/modules/handover/components/customer-combobox';
import { HandoverStatusBadge } from '@/modules/handover/components/handover-status-badge';
import { todayWib } from '@/modules/serial/lib/locations';
import {
  defaultBuId as pickDefaultBu,
  defaultLocationId as pickDefaultLocation,
} from '../lib/defaults';
import { summarizeRows } from '../lib/draft';
import type { WarehouseDraftRow } from '../lib/draft-store';
import { boxPlanSummary, parsePositiveInt } from '../lib/ready-box';
import { countWarnings } from '../lib/warnings';
import {
  lookupWarehouseSerials,
  readyMaxBoxQueryOptions,
  warehouseOrderOptionsQueryOptions,
} from '../queries';
import { CandidateNote, MarkLegend } from './candidate-note';
import { HandoverLinkPicker } from './handover-link-picker';
import { findMatchingOrder, OrderNumberCombobox } from './order-number-combobox';
import { TaskSalesList } from './task-sales-list';
import { WarningBanners } from './warning-banners';

export type WarehousePurpose = 'order' | 'ready';

export interface ConfirmValues {
  /** `ready` = catat ready tanpa SO: `orderNumber`/`customerName` kosong dan `handoverIds` kosong. */
  mode: WarehousePurpose;
  dispatchedOn: string;
  orderNumber: string;
  /** Id SO bila memilih SO yang sudah ada. */
  orderId?: string;
  buId: string;
  customerName: string;
  note: string;
  handoverIds: string[];
  /**
   * Lokasi dialog: melengkapi serial baru yang belum berlokasi dan membatasi daftar task Serah Terima. Serial baru yang
   * belum punya tanggal uji memakai tanggal catat/keluar (diisi halaman; chip Tanggal uji menang bila terisi).
   */
  locationId: string;
  /** Hanya mode `ready`: nomor kardus pertama dan pcs per kardus. */
  boxStart?: number;
  boxSize?: number;
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
  options: WarehouseOptionsDto | undefined;
  /** Konteks task asal (`?handover`). */
  handoverContext?: WarehouseHandoverContextDto | undefined;
  /** Nomor riwayat Penjualan tanpa No SO menaut ke detailnya (pengguna boleh membaca Riwayat Gudang, bukan aplikasi desktop). */
  historyLinkable?: boolean;
  originHandoverId?: string | undefined;
  /** Tujuan pengeluaran; dipegang halaman karena ikut menentukan arti filter "Sembunyikan yang sudah tercatat". */
  purpose: WarehousePurpose;
  onPurposeChange: (purpose: WarehousePurpose) => void;
  /** Mengeluarkan baris dari pilihan (serial yang sudah ada di SO ini). */
  onRemoveRows: (serialIds: readonly string[]) => void;
  /** Dipanggil SINKRON dari klik "Simpan & salin" (gestur untuk clipboard). */
  onConfirm: (values: ConfirmValues) => void;
  /** Galat server pada nomor kardus awal (mis. "Nomor kardus sudah dipakai") dari kiriman sebelumnya. */
  boxStartError?: string | undefined;
}

const CHUNK = WAREHOUSE_LIMITS.lookupMax;

const PURPOSE_OPTIONS = [
  { value: 'order', label: 'Penjualan' },
  { value: 'ready', label: 'Ready Stock' },
];

/** Dialog konfirmasi kirim (spek 5.5). State direset tiap dibuka (isi hanya dipasang saat terbuka). */
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
  options,
  handoverContext,
  historyLinkable = false,
  originHandoverId,
  purpose,
  onPurposeChange,
  onRemoveRows,
  onConfirm,
  boxStartError,
}: ConfirmDialogProps) {
  const isReady = purpose === 'ready';
  const today = todayWib();
  const [dispatchedOn, setDispatchedOn] = useState(today);
  const [orderNumber, setOrderNumber] = useState('');
  const [customerName, setCustomerName] = useState(handoverContext?.handover.customerName ?? '');
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
  // Lokasi dialog ini menjadi lokasi SEMUA serial baru (juga yang sudah berlokasi dari chip saat scan).
  const fillLocation = rows.some((row) => row.kind === 'new');
  // Task tertaut yang pernah dimuat pemilih (untuk konfirmasi kecocokan sebelum simpan).
  const candidateRegistry = useRef(new Map<string, WarehouseHandoverCandidateDto>());
  const [mismatch, setMismatch] = useState<WarehouseHandoverCandidateDto[] | null>(null);
  // Pemilih memberi tahu bila `candidateRegistry` terisi, supaya tanda "belum diperiksa" ikut menyegar.
  const [, bumpRegistry] = useState(0);

  const typed = normalizeOrderNumber(orderNumber);
  const orderQuery = useInfiniteQuery({
    ...warehouseOrderOptionsQueryOptions({
      ...(typed !== '' ? { query: typed } : {}),
      ...(pickedBuId !== '' ? { buId: pickedBuId } : {}),
    }),
    enabled: !isReady,
  });
  const orders = useMemo(
    () => orderQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [orderQuery.data],
  );
  // SO tertaut task asal disarankan lebih dulu; juga dipakai untuk mencocokkan.
  const matched = isReady ? null : findMatchingOrder(orderNumber, orders);
  const suggestions = useMemo(() => {
    const linked = handoverContext?.orders ?? [];
    const ids = new Set(linked.map((order) => order.id));
    return [...linked, ...orders.filter((order) => !ids.has(order.id))];
  }, [orders, handoverContext]);

  // SO yang ada mengunci BU ke BU SO-nya (satu SO satu BU).
  const buId = matched ? matched.buId : pickedBuId;
  // SO yang ada mengisi Lokasi dari lokasi task tertautnya (satu SO satu lokasi); setelah itu Lokasi tetap dapat diubah.
  const matchedKey = matched?.id ?? '';
  const matchedLocation = matched?.locationId ?? '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: hanya saat SO yang cocok berganti
  useEffect(() => {
    if (matchedKey === '' || matchedLocation === '') return;
    if (locationOptions.some((option) => option.id === matchedLocation)) {
      setPickedLocationId(matchedLocation);
    }
  }, [matchedKey, matchedLocation]);
  // Customer SO yang ada menang.
  const effectiveCustomer = matched ? matched.customerName : customerName;
  const customerId =
    matched?.customerId ||
    options?.customers.find((c) => customerKey(c.name) === customerKey(effectiveCustomer))?.id ||
    '';

  // Serial pilihan yang sudah ada di SO ini (lookup ber-orderId, per 200 id, di latar).
  const existingIds = useMemo(
    () => rows.flatMap((row) => (row.kind === 'existing' ? [row.id] : [])),
    [rows],
  );
  const [inOrder, setInOrder] = useState<{ order: string; ids: string[]; done: boolean }>({
    order: '',
    ids: [],
    done: true,
  });
  const matchedId = matched?.id ?? '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: `existingIds` menurun lewat `rows`
  useEffect(() => {
    if (matchedId === '') {
      setInOrder({ order: '', ids: [], done: true });
      return;
    }
    let cancelled = false;
    setInOrder({ order: matchedId, ids: [], done: false });
    (async () => {
      const found: string[] = [];
      for (let start = 0; start < existingIds.length; start += CHUNK) {
        const output = await lookupWarehouseSerials({
          ids: existingIds.slice(start, start + CHUNK),
          orderId: matchedId,
        });
        for (const serial of output.found) if (serial.inOrder) found.push(serial.id);
        if (cancelled) return;
      }
      if (!cancelled) setInOrder({ order: matchedId, ids: found, done: true });
    })().catch(() => {
      // Pemeriksaan gagal: server tetap menolak serial ganda saat simpan (pesan menyebut SN-nya).
      if (!cancelled) setInOrder({ order: matchedId, ids: [], done: true });
    });
    return () => {
      cancelled = true;
    };
  }, [matchedId, existingIds.join(',')]);
  const conflictIds = inOrder.order === matchedId ? inOrder.ids : [];
  const checking = matchedId !== '' && !(inOrder.order === matchedId && inOrder.done);

  const summary = summarizeRows(rows);
  const { counts } = countWarnings(rows, buId);
  const needsPhotoBanner = rows.some((row) => row.kind === 'new') && item?.proofRequired === true;

  // Kardus (hanya Ready Stock): nomor awal bawaan = kardus tertinggi BU + Tipe ini + 1 (1 bila belum diketahui).
  const maxBoxQuery = useQuery({
    ...readyMaxBoxQueryOptions(isReady ? buId : '', item?.id ?? ''),
    enabled: isReady && buId !== '' && item !== null,
  });
  const defaultBoxStart = String((maxBoxQuery.data?.totals?.maxBoxNumber ?? 0) + 1);
  const [boxStartText, setBoxStartText] = useState<string | null>(null);
  const [boxSizeText, setBoxSizeText] = useState<string | null>(null);
  const boxStartShown = boxStartText ?? defaultBoxStart;
  const boxSizeShown = boxSizeText ?? (item && item.boxSize > 0 ? String(item.boxSize) : '');
  const boxStart = parsePositiveInt(boxStartShown);
  const boxSize = parsePositiveInt(boxSizeShown);
  const boxSummary =
    isReady && boxStart !== null && boxSize !== null
      ? boxPlanSummary({ startNumber: boxStart, size: boxSize, count: rows.length })
      : null;

  const needsItemBu = rows.some((row) => row.kind === 'new');
  // No SO opsional: kosong = Penjualan tanpa SO; terisi tetap divalidasi.
  const orderProblem = typed === '' ? null : orderNumberProblem(typed);
  const errors = {
    order: isReady
      ? undefined
      : orderProblem === 'empty'
        ? undefined
        : orderProblem === 'too_long'
          ? `No SO maksimal ${WAREHOUSE_LIMITS.orderNumberMax} karakter`
          : orderProblem === 'control_chars'
            ? 'No SO memuat karakter yang tidak boleh'
            : undefined,
    // Customer wajib hanya untuk SO baru; tanpa No SO ia hanya membantu menyaring task.
    customer:
      isReady || typed === '' || matched !== null || effectiveCustomer.trim() !== ''
        ? undefined
        : 'Customer wajib diisi',
    bu:
      buId === ''
        ? 'BU wajib dipilih'
        : needsItemBu && item && item.buIds.length > 0 && !item.buIds.includes(buId)
          ? 'Item ini bukan milik BU tersebut; serial baru tidak dapat dibuat'
          : undefined,
    date:
      !isIsoDate(dispatchedOn) || dispatchedOn > today
        ? `${isReady ? 'Tanggal catat' : 'Tanggal keluar'} tidak boleh setelah hari ini`
        : undefined,
    location: fillLocation && pickedLocationId === '' ? 'Lokasi wajib dipilih' : undefined,
    boxStart:
      isReady && (boxStart === null || boxStart > WAREHOUSE_BOX_LIMITS.numberMax)
        ? `Nomor kardus awal harus 1 sampai ${WAREHOUSE_BOX_LIMITS.numberMax}`
        : undefined,
    boxSize:
      isReady && (boxSize === null || boxSize > WAREHOUSE_BOX_LIMITS.sizeMax)
        ? boxSize === null
          ? 'Isi per kardus harus lebih dari 0'
          : `Isi per kardus maksimal ${WAREHOUSE_BOX_LIMITS.sizeMax}`
        : undefined,
    note: [...note].length > WAREHOUSE_LIMITS.noteMax ? 'Catatan terlalu panjang' : undefined,
  };
  const blocked =
    Object.values(errors).some((message) => message !== undefined) ||
    conflictIds.length > 0 ||
    checking;

  const originalLinked =
    matched !== null &&
    originHandoverId !== undefined &&
    !(handoverContext?.orders ?? []).some((order) => order.id === matched.id);

  function submit() {
    setTouched(true);
    if (blocked) return;
    // Konfirmasi kecocokan: task tertaut yang tak menyebut Item, atau memuat baris yang menyebut Item lain.
    if (!isReady && item) {
      const doubtful = handoverIds.flatMap((id) => {
        const candidate = candidateRegistry.current.get(id);
        return candidate && (!candidate.mentionsItem || candidate.mismatchLines.length > 0)
          ? [candidate]
          : [];
      });
      if (doubtful.length > 0) {
        setMismatch(doubtful);
        return;
      }
    }
    proceed();
  }

  // Task tertaut (mis. task asal di lokasi lain dari Lokasi dialog) yang tak pernah dimuat pemilih: kecocokannya belum
  // diperiksa. Hanya tanda; tidak memblokir simpan.
  const uncheckedIds =
    !isReady && item ? handoverIds.filter((id) => !candidateRegistry.current.has(id)) : [];

  /** Memanggil `onConfirm` SINKRON dari klik (tombol Simpan, atau tombol konfirmasi kecocokan). */
  function proceed() {
    if (isReady && boxStart !== null && boxSize !== null) {
      onConfirm({
        mode: 'ready',
        dispatchedOn,
        orderNumber: '',
        buId,
        customerName: '',
        note: note.trim(),
        handoverIds: [],
        boxStart,
        boxSize,
        locationId: pickedLocationId,
      });
      return;
    }
    onConfirm({
      mode: 'order',
      dispatchedOn,
      orderNumber: typed,
      ...(matched ? { orderId: matched.id } : {}),
      buId,
      customerName: effectiveCustomer.trim(),
      note: note.trim(),
      handoverIds,
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
        <Select
          id="wh-purpose"
          label="Tujuan"
          options={PURPOSE_OPTIONS}
          value={purpose}
          onValueChange={(next) => onPurposeChange(next as WarehousePurpose)}
        />
        {isReady ? (
          <p className="text-xs text-muted-foreground">
            Hanya mencatat serial untuk target barang ready, tanpa No SO, customer, dan tautan task.
          </p>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="wh-dispatched-on" required>
            {isReady ? 'Tanggal catat' : 'Tanggal keluar'}
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

        {isReady ? null : (
          <>
            {(handoverContext?.orders.length ?? 0) > 0 && typed === '' ? (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">SO tertaut task ini:</span>
                {handoverContext?.orders.map((order) => (
                  <Button
                    key={order.id}
                    type="button"
                    size="sm"
                    variant="outline"
                    color="primary"
                    onClick={() => setOrderNumber(order.number)}
                  >
                    {order.number}
                  </Button>
                ))}
              </div>
            ) : null}

            <TaskSalesList sales={handoverContext?.sales ?? []} linkable={historyLinkable} />

            <OrderNumberCombobox
              id="wh-order-number"
              value={orderNumber}
              onChange={setOrderNumber}
              orders={suggestions}
              matched={matched}
              error={touched ? errors.order : undefined}
            />
          </>
        )}

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
            disabled={matched !== null}
            placeholder="Pilih BU"
            {...(touched && errors.bu ? { error: errors.bu } : {})}
          />
          {matched ? (
            <p className="text-xs text-muted-foreground">
              Terkunci mengikuti BU SO (satu SO satu BU).
            </p>
          ) : null}
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

        {isReady ? null : (
          <>
            {matched ? (
              <div className="space-y-1.5">
                <Label htmlFor="wh-customer-locked">Customer</Label>
                <Input id="wh-customer-locked" value={matched.customerName} readOnly disabled />
              </div>
            ) : (
              <div className="space-y-1.5">
                <CustomerCombobox
                  id="wh-customer"
                  value={customerName}
                  onChange={setCustomerName}
                  customers={options?.customers ?? []}
                  inactiveNames={options?.inactiveCustomerNames ?? []}
                  savedAs="pengeluaran"
                />
                {touched && errors.customer ? (
                  <p role="alert" className="text-xs text-destructive-text">
                    {errors.customer}
                  </p>
                ) : null}
              </div>
            )}

            <div className="space-y-2">
              <Label>Tautan Serah Terima</Label>
              <HandoverLinkPicker
                locationId={pickedLocationId}
                registry={candidateRegistry}
                onRegistryChange={() => bumpRegistry((n) => n + 1)}
                {...(customerId ? { customerId } : {})}
                {...(effectiveCustomer.trim() !== ''
                  ? { customerName: effectiveCustomer.trim() }
                  : {})}
                {...(matched ? { orderId: matched.id } : {})}
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
              {originalLinked && originHandoverId && handoverContext ? (
                <p className="text-xs text-muted-foreground">
                  SO ini akan ditautkan ke task {handoverContext.handover.number}.
                </p>
              ) : null}
            </div>
          </>
        )}

        {isReady ? (
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
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="wh-note">Catatan</Label>
          <Textarea
            id="wh-note"
            rows={3}
            maxLength={WAREHOUSE_LIMITS.noteMax}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>

        {needsPhotoBanner ? (
          <Alert color="warning">
            <AlertDescription>
              Serial baru untuk item wajib foto dicatat tanpa foto bukti. Ingatkan tim QC untuk
              melampirkan foto bukti QC.
            </AlertDescription>
          </Alert>
        ) : null}
        {isReady ? (
          <p className="text-xs text-muted-foreground">
            Serial yang sudah Tercatat WH akan dilewati (tidak dicatat dua kali).
          </p>
        ) : (
          <WarningBanners counts={counts} />
        )}

        {!isReady && conflictIds.length > 0 ? (
          <Alert color="destructive">
            <AlertDescription className="space-y-2">
              <span className="block">
                {conflictIds.length} serial sudah ada di SO ini dan tidak bisa dimasukkan dua kali.
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                color="destructive"
                onClick={() => onRemoveRows(conflictIds)}
              >
                Keluarkan dari pilihan
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {!isReady && checking ? (
          <p className="text-xs text-muted-foreground" role="status">
            Memeriksa serial yang sudah ada di SO…
          </p>
        ) : null}
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
