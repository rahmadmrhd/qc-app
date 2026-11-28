import { formatBuLabel } from '@shared/business-units';
import type { WarehouseDispatchDetailDto } from '@shared/contract';
import { WAREHOUSE_BOX_LIMITS, WAREHOUSE_LIMITS } from '@shared/serial-warehouse';
import { isIsoDate } from '@shared/serials';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { LinkField, type LinkOption } from '@/components/link-field';
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
import { describeError } from '@/lib/api/describe-error';
import { warehouseBuIds } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { useOptionalActiveLocations } from '@/modules/location/active-locations-context';
import { WysiwygEditor } from '@/modules/markdown/wysiwyg-editor';
import { todayWib } from '@/modules/serial/lib/locations';
import { boxPlanSummary, parsePositiveInt } from '../lib/ready-box';
import { useUpdateWarehouseDispatch, warehouseOptionsQueryOptions } from '../queries';
import { HandoverLinkPicker } from './handover-link-picker';

export interface EditDispatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dispatch: WarehouseDispatchDetailDto;
}

/** Dialog ubah catatan Gudang (`kind === 'note'`, `status === 'done'`): daftar serial dan Tipe tidak dapat diubah. */
export function EditDispatchDialog(props: EditDispatchDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="full-on-phone" className="sm:max-w-xl">
        {props.open ? <EditDispatchBody {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function EditDispatchBody({ onOpenChange, dispatch }: EditDispatchDialogProps) {
  const me = useMe();
  const today = todayWib();
  const update = useUpdateWarehouseDispatch();
  const activeLocations = useOptionalActiveLocations();
  const optionsQuery = useQuery(warehouseOptionsQueryOptions());
  const locationOptions = useMemo<LinkOption[]>(
    () => (optionsQuery.data?.locations ?? []).map((l) => ({ id: l.id, label: l.name })),
    [optionsQuery.data],
  );

  const allowedBuIds = useMemo(() => warehouseBuIds(me, 'edit'), [me]);
  const buOptions = useMemo<LinkOption[]>(() => {
    const list = (me.businessUnits ?? [])
      .filter((bu) => !bu.deleted && allowedBuIds.includes(bu.id))
      .map((bu) => ({ id: bu.id, label: formatBuLabel(bu) }));
    if (!list.some((b) => b.id === dispatch.buId)) {
      list.unshift({
        id: dispatch.buId,
        label: formatBuLabel({ code: dispatch.buCode, name: dispatch.buName }),
      });
    }
    return list;
  }, [me, allowedBuIds, dispatch.buId, dispatch.buCode, dispatch.buName]);

  const [dispatchedOn, setDispatchedOn] = useState(dispatch.dispatchedOn);
  const [buId, setBuId] = useState(dispatch.buId);
  const [boxStartText, setBoxStartText] = useState(String(dispatch.boxStart ?? 1));
  const [boxSizeText, setBoxSizeText] = useState(String(dispatch.boxSize ?? 1));
  const [note, setNote] = useState(dispatch.note);
  const [handoverIds, setHandoverIds] = useState<string[]>(() =>
    dispatch.handovers.filter((h) => h.readable).map((h) => h.id),
  );
  const [pickedLocationId, setPickedLocationId] = useState<string | null>(null);
  const filterLocationId =
    pickedLocationId ?? activeLocations?.selectedIds[0] ?? locationOptions[0]?.id ?? '';
  const [touched, setTouched] = useState(false);

  const boxStart = parsePositiveInt(boxStartText);
  const boxSize = parsePositiveInt(boxSizeText);
  const boxSummary =
    boxStart !== null && boxSize !== null
      ? boxPlanSummary({ startNumber: boxStart, size: boxSize, count: dispatch.serialCount })
      : null;

  const errors = {
    date:
      !isIsoDate(dispatchedOn) || dispatchedOn > today
        ? 'Tanggal catat tidak boleh setelah hari ini'
        : undefined,
    bu: buId === '' ? 'BU wajib dipilih' : undefined,
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

  async function submit() {
    setTouched(true);
    if (blocked || boxStart === null || boxSize === null) return;
    try {
      await update.mutateAsync({
        id: dispatch.id,
        dispatchedOn,
        buId,
        boxStart,
        boxSize,
        note: note.trim(),
        handoverIds,
      });
      toast.success('Catatan Gudang diperbarui');
      onOpenChange(false);
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Ubah Catatan Gudang</DialogTitle>
        <DialogDescription>
          {dispatch.number} · {dispatch.itemLabel || '—'} · {dispatch.serialCount} Serial Number
          (Tipe dan daftar serial tidak dapat diubah)
        </DialogDescription>
      </DialogHeader>
      <form
        id="warehouse-edit-form"
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="wh-edit-dispatched-on" required>
            Tanggal catat
          </Label>
          <Input
            id="wh-edit-dispatched-on"
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
            id="wh-edit-bu"
            label="BU"
            required
            value={buId === '' ? null : buId}
            onChange={(next) => setBuId(next ?? '')}
            options={buOptions}
            localFilter
            highlight
            keyboardless
            disabled
            placeholder="Pilih BU"
            {...(touched && errors.bu ? { error: errors.bu } : {})}
          />
          <p className="text-xs text-muted-foreground">
            BU riwayat tidak dapat diubah. Item harus tercatat pada BU tersebut.
          </p>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="wh-edit-box-start" required>
                Nomor kardus awal
              </Label>
              <Input
                id="wh-edit-box-start"
                type="number"
                inputMode="numeric"
                min={1}
                max={WAREHOUSE_BOX_LIMITS.numberMax}
                aria-required="true"
                value={boxStartText}
                onChange={(event) => setBoxStartText(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wh-edit-box-size" required>
                Isi per kardus
              </Label>
              <Input
                id="wh-edit-box-size"
                type="number"
                inputMode="numeric"
                min={1}
                max={WAREHOUSE_BOX_LIMITS.sizeMax}
                aria-required="true"
                value={boxSizeText}
                onChange={(event) => setBoxSizeText(event.target.value)}
              />
            </div>
          </div>
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
          <Label id="wh-edit-note-label">Catatan</Label>
          <WysiwygEditor
            id="wh-edit-note"
            mode="note"
            value={note}
            onChange={setNote}
            labelledBy="wh-edit-note-label"
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
          <LinkField
            id="wh-edit-task-location"
            label="Filter lokasi task"
            value={filterLocationId === '' ? null : filterLocationId}
            onChange={(next) => setPickedLocationId(next ?? '')}
            options={locationOptions}
            localFilter
            highlight
            keyboardless
            placeholder="Pilih lokasi untuk memuat daftar task"
          />
          <HandoverLinkPicker
            locationId={filterLocationId}
            itemId={dispatch.itemId}
            value={handoverIds}
            onChange={setHandoverIds}
          />
        </div>
      </form>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          color="secondary"
          disabled={update.isPending}
          onClick={() => onOpenChange(false)}
        >
          Batal
        </Button>
        <Button
          type="submit"
          form="warehouse-edit-form"
          disabled={update.isPending || (touched && blocked)}
        >
          {update.isPending ? 'Menyimpan…' : 'Simpan'}
        </Button>
      </DialogFooter>
    </>
  );
}
