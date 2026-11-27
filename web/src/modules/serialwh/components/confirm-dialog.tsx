import type {
  WarehouseHandoverContextDto,
  WarehouseItemOptionDto,
  WarehouseOptionsDto,
} from '@shared/contract';
import { customerKey } from '@shared/handover';
import {
  normalizeOrderNumber,
  orderNumberProblem,
  WAREHOUSE_LIMITS,
} from '@shared/serial-warehouse';
import { isIsoDate } from '@shared/serials';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
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
import { todayWib } from '@/modules/serial/lib/locations';
import { summarizeRows } from '../lib/draft';
import type { WarehouseDraftRow } from '../lib/draft-store';
import { countWarnings } from '../lib/warnings';
import { lookupWarehouseSerials, warehouseOrderOptionsQueryOptions } from '../queries';
import { HandoverLinkPicker } from './handover-link-picker';
import { findMatchingOrder, OrderNumberCombobox } from './order-number-combobox';
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
  /** Lokasi/tanggal uji untuk serial baru yang belum punya (hanya bila ada baris seperti itu). */
  newLocationId?: string;
  newTestDate?: string;
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
  /** Nilai awal dari chip Lokasi/Tanggal uji (boleh kosong). */
  defaultLocationId: string;
  defaultTestDate: string;
  options: WarehouseOptionsDto | undefined;
  /** Konteks task asal (`?handover`). */
  handoverContext?: WarehouseHandoverContextDto | undefined;
  originHandoverId?: string | undefined;
  /** Tujuan pengeluaran; dipegang halaman karena ikut menentukan arti filter "Sembunyikan yang sudah tercatat". */
  purpose: WarehousePurpose;
  onPurposeChange: (purpose: WarehousePurpose) => void;
  /** Mengeluarkan baris dari pilihan (serial yang sudah ada di SO ini). */
  onRemoveRows: (serialIds: readonly string[]) => void;
  /** Dipanggil SINKRON dari klik "Simpan & salin" (gestur untuk clipboard). */
  onConfirm: (values: ConfirmValues) => void;
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
  defaultTestDate,
  options,
  handoverContext,
  originHandoverId,
  purpose,
  onPurposeChange,
  onRemoveRows,
  onConfirm,
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
  // BU pilihan di dialog ini: baru menggantikan chip BU form saat disimpan (batal tidak mengubah apa pun).
  const [pickedBuId, setPickedBuId] = useState(formBuId);
  // Serial baru tanpa lokasi/tanggal uji (chip filter kosong saat scan) melengkapinya di sini.
  const fillLocation = rows.some((row) => row.kind === 'new' && row.locationId === '');
  const fillTestDate = rows.some((row) => row.kind === 'new' && row.testDate === '');
  const [newLocationId, setNewLocationId] = useState(defaultLocationId);
  const [newTestDate, setNewTestDate] = useState(defaultTestDate === '' ? today : defaultTestDate);

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

  const needsItemBu = rows.some((row) => row.kind === 'new');
  const orderProblem = orderNumberProblem(typed);
  const errors = {
    order: isReady
      ? undefined
      : orderProblem === 'empty'
        ? 'No SO wajib diisi'
        : orderProblem === 'too_long'
          ? `No SO maksimal ${WAREHOUSE_LIMITS.orderNumberMax} karakter`
          : orderProblem === 'control_chars'
            ? 'No SO memuat karakter yang tidak boleh'
            : undefined,
    customer: isReady || effectiveCustomer.trim() !== '' ? undefined : 'Customer wajib diisi',
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
    location: fillLocation && newLocationId === '' ? 'Lokasi wajib dipilih' : undefined,
    testDate:
      fillTestDate && (!isIsoDate(newTestDate) || newTestDate > today)
        ? 'Tanggal uji tidak boleh kosong atau setelah hari ini'
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
    if (isReady) {
      onConfirm({
        mode: 'ready',
        dispatchedOn,
        orderNumber: '',
        buId,
        customerName: '',
        note: note.trim(),
        handoverIds: [],
        ...(fillLocation ? { newLocationId } : {}),
        ...(fillTestDate ? { newTestDate } : {}),
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
      ...(fillLocation ? { newLocationId } : {}),
      ...(fillTestDate ? { newTestDate } : {}),
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

        {fillLocation ? (
          <LinkField
            id="wh-new-location"
            label="Lokasi serial baru"
            required
            value={newLocationId === '' ? null : newLocationId}
            onChange={(next) => setNewLocationId(next ?? '')}
            options={locationOptions}
            localFilter
            highlight
            keyboardless
            placeholder="Pilih lokasi"
            {...(touched && errors.location ? { error: errors.location } : {})}
          />
        ) : null}
        {fillTestDate ? (
          <div className="space-y-1.5">
            <Label htmlFor="wh-new-test-date" required>
              Tanggal uji serial baru
            </Label>
            <Input
              id="wh-new-test-date"
              type="date"
              max={today}
              aria-required="true"
              value={newTestDate}
              onChange={(event) => setNewTestDate(event.target.value)}
            />
            {touched && errors.testDate ? (
              <p role="alert" className="text-xs text-destructive-text">
                {errors.testDate}
              </p>
            ) : null}
          </div>
        ) : null}

        {isReady ? null : (
          <>
            {matched ? (
              <div className="space-y-1.5">
                <Label htmlFor="wh-customer-locked" required>
                  Customer
                </Label>
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
              {originalLinked && originHandoverId && handoverContext ? (
                <p className="text-xs text-muted-foreground">
                  SO ini akan ditautkan ke task {handoverContext.handover.number}.
                </p>
              ) : null}
            </div>
          </>
        )}

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
    </>
  );
}
