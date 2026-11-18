import type { SerialDto, SerialEditable } from '@shared/contract';
import { isIsoDate, normalizeSerial, serialProblem } from '@shared/serials';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FieldError } from '@/components/field-error';
import { LinkField, type LinkOption } from '@/components/link-field';
import { BusyLabel } from '@/components/spinner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';
import { isStaleSaveError, STALE_SAVE_MESSAGE } from '@/modules/sticker/lib/stale';
import { todayWib } from '../lib/locations';
import {
  serialDetailQueryOptions,
  serialItemOptionsQueryOptions,
  useUpdateSerial,
} from '../queries';
import { SerialLocationField } from './serial-location-field';
import { SerialNoteField } from './serial-note-field';

export interface EditSerialDialogProps {
  serial: SerialDto;
  onClose: () => void;
}

type FieldErrors = Partial<Record<keyof SerialEditable, string>>;

/** Penanda bidang yang juga diubah orang lain: simpan akan menimpa nilai server itu. */
function ConflictNote({ text }: { text: string | undefined }) {
  if (!text) return null;
  return (
    <p className="text-xs text-amber-700 dark:text-amber-400">
      Orang lain sudah mengubahnya jadi: {text}. Kalau disimpan, perubahan itu tertimpa.
    </p>
  );
}

/**
 * Ubah data serial (serial, item, tanggal uji, sample, catatan, lokasi). BU, status, dan stiker tidak dapat diubah di
 * sini. Server membandingkan dengan data sekarang: hanya bidang yang berbeda yang tercatat sebagai perubahan.
 */
export function EditSerialDialog({ serial, onClose }: EditSerialDialogProps) {
  const queryClient = useQueryClient();
  const update = useUpdateSerial();
  // Data dasar pembanding: nilai server saat dialog dibuka, diperbarui bila server memberi versi lebih baru (412).
  const [base, setBase] = useState(serial);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<FieldErrors>({});
  const [serialText, setSerialText] = useState(serial.serial);
  const [item, setItem] = useState({ id: serial.itemId, label: serial.itemLabel });
  const [testDate, setTestDate] = useState(serial.testDate);
  const [sample, setSample] = useState(serial.sample);
  const [note, setNote] = useState(serial.note);
  const [location, setLocation] = useState({ id: serial.locationId, label: serial.locationName });
  const [itemTerm, setItemTerm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);

  const { data, isFetching } = useQuery(serialItemOptionsQueryOptions(itemTerm.trim()));
  // BU serial tidak lagi terikat BU item (spek Catat wajib foto butir N): semua item yang terlihat boleh dipilih.
  const itemOptions: LinkOption[] = (data?.items ?? []).map((option) => ({
    id: option.id,
    label: option.label,
  }));

  // Selama dalam pengiriman atau di servis, lokasi hanya berubah lewat Kirim/Terima (server menolak ubah lokasi).
  const locationLocked = base.custody !== 'qc';
  const normalized = normalizeSerial(serialText);
  const serialInvalid = serialProblem(normalized) !== null;
  // Catatan yang tak disentuh dikirim apa adanya (tanpa pangkas diam-diam): hanya suntingan pengguna yang dipangkas.
  const noteOut = note === base.note ? base.note : note.trim();
  const changed =
    normalized !== base.serial ||
    item.id !== base.itemId ||
    testDate !== base.testDate ||
    sample !== base.sample ||
    noteOut !== base.note ||
    location.id !== base.locationId;
  const today = todayWib();
  const valid =
    !serialInvalid &&
    isIsoDate(testDate) &&
    testDate <= today &&
    item.id !== '' &&
    location.id !== '';

  /**
   * Versi usang (412): muat data terbaru dan ganti HANYA bidang yang belum diubah pengguna; bidang yang sudah diubah
   * dipertahankan. Dengan begitu simpan ulang tidak mengembalikan perubahan orang lain ke nilai lama.
   */
  async function rebase() {
    try {
      const fresh = (
        await queryClient.fetchQuery({ ...serialDetailQueryOptions(serial.id), staleTime: 0 })
      ).serial;
      const mine = {
        serial: normalizeSerial(serialText),
        itemId: item.id,
        testDate,
        sample,
        note: noteOut,
        locationId: location.id,
      };
      const theirs = {
        serial: fresh.serial,
        itemId: fresh.itemId,
        testDate: fresh.testDate,
        sample: fresh.sample,
        note: fresh.note,
        locationId: fresh.locationId,
      };
      const before = {
        serial: base.serial,
        itemId: base.itemId,
        testDate: base.testDate,
        sample: base.sample,
        note: base.note,
        locationId: base.locationId,
      };
      const next: FieldErrors = {};
      const show: Record<keyof SerialEditable, string> = {
        serial: fresh.serial,
        itemId: fresh.itemLabel,
        testDate: fresh.testDate,
        sample: fresh.sample ? 'Sample' : 'Bukan sample',
        note: fresh.note === '' ? '(kosong)' : fresh.note,
        locationId: fresh.locationName,
      };
      for (const field of Object.keys(mine) as (keyof typeof mine)[]) {
        if (mine[field] === before[field]) continue; // belum diubah pengguna: diganti nilai server di bawah
        if (theirs[field] !== before[field] && theirs[field] !== mine[field]) {
          next[field] = show[field];
        }
      }
      if (mine.serial === before.serial) setSerialText(fresh.serial);
      if (mine.itemId === before.itemId) setItem({ id: fresh.itemId, label: fresh.itemLabel });
      if (mine.testDate === before.testDate) setTestDate(fresh.testDate);
      if (mine.sample === before.sample) setSample(fresh.sample);
      if (mine.note === before.note) setNote(fresh.note);
      if (mine.locationId === before.locationId) {
        setLocation({ id: fresh.locationId, label: fresh.locationName });
      }
      setConflicts(next);
      setBase(fresh);
      setNotice(
        `${STALE_SAVE_MESSAGE}. Field yang belum Anda ubah sudah diperbarui ke data terbaru. Cek dulu, lalu simpan lagi.`,
      );
    } catch (loadError) {
      setError(describeError(loadError));
    }
  }

  async function submit() {
    setError(null);
    setNotice(null);
    setConflicts({});
    setFieldErrors({});
    try {
      await update.mutateAsync({
        id: serial.id,
        expectedUpdatedAt: base.updatedAt,
        serial: normalized,
        itemId: item.id,
        testDate,
        sample,
        note: noteOut,
        locationId: location.id,
      });
      onClose();
    } catch (caught) {
      if (isStaleSaveError(caught)) {
        await rebase();
        return;
      }
      if (caught instanceof ApiError && caught.fields) {
        const next: FieldErrors = {};
        for (const key of [
          'serial',
          'itemId',
          'testDate',
          'sample',
          'note',
          'locationId',
        ] as const) {
          const message = caught.fields[key];
          if (message) next[key] = message;
        }
        if (Object.keys(next).length > 0) {
          setFieldErrors(next);
          return;
        }
      }
      setError(describeError(caught));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ubah data serial</DialogTitle>
          <DialogDescription>
            Perubahan dicatat di riwayat. Business Unit, status, dan stiker tidak bisa diubah di
            sini; stok stiker tidak terpengaruh.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="edit-serial">Serial</Label>
            <Input
              id="edit-serial"
              className="font-mono"
              value={serialText}
              aria-invalid={serialInvalid || fieldErrors.serial ? true : undefined}
              onChange={(event) => setSerialText(event.target.value)}
            />
            <FieldError errors={[fieldErrors.serial]} />
            <ConflictNote text={conflicts.serial} />
          </div>
          <LinkField
            id="edit-item"
            label="Item"
            placeholder="Cari merk atau tipe item…"
            value={item.id === '' ? null : item.id}
            labelOf={(id) => (id === item.id ? item.label : id)}
            options={itemOptions}
            loading={isFetching && data === undefined}
            hasMore={data?.nextCursor != null}
            onSearchChange={setItemTerm}
            searchDebounceMs={200}
            onChange={(id) =>
              setItem({ id: id ?? '', label: itemOptions.find((o) => o.id === id)?.label ?? '' })
            }
            error={fieldErrors.itemId}
          />
          <ConflictNote text={conflicts.itemId} />
          <div className="space-y-1.5">
            <Label htmlFor="edit-date">Tanggal uji</Label>
            <Input
              id="edit-date"
              type="date"
              max={today}
              value={testDate}
              onChange={(event) => setTestDate(event.target.value)}
            />
            <FieldError errors={[fieldErrors.testDate]} />
            <ConflictNote text={conflicts.testDate} />
          </div>
          <SerialLocationField
            id="edit-location"
            label="Lokasi"
            value={location.id}
            valueLabel={location.label}
            onChange={(id, label) => setLocation({ id, label })}
            error={fieldErrors.locationId}
            disabled={locationLocked}
          />
          {locationLocked ? (
            <p className="text-xs text-muted-foreground">
              Lokasi tidak bisa diubah selama Serial Number masih dalam pengiriman atau di servis.
              Lokasi berubah lewat aksi Kirim dan Terima.
            </p>
          ) : null}
          <ConflictNote text={conflicts.locationId} />
          <div className="flex items-center gap-2">
            <Checkbox
              id="edit-sample"
              checked={sample}
              onCheckedChange={(on) => setSample(on === true)}
            />
            <Label htmlFor="edit-sample">Sample</Label>
          </div>
          <ConflictNote text={conflicts.sample} />
          <div className="space-y-1.5">
            <SerialNoteField
              id="edit-note"
              label="Catatan"
              value={note}
              onChange={setNote}
              error={fieldErrors.note}
            />
            <ConflictNote text={conflicts.note} />
          </div>
          {notice ? (
            <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
              {notice}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button
            type="button"
            disabled={update.isPending || !changed || !valid}
            onClick={() => void submit()}
          >
            {update.isPending ? <BusyLabel>Menyimpan…</BusyLabel> : 'Simpan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
