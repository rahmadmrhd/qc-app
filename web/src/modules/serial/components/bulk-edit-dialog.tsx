import { useState } from 'react';
import { Select } from '@/components/select';
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
import type { BulkPatch } from '../lib/draft';
import { EMPTY_ITEM_BU, ItemBuField, type ItemBuValue } from './item-bu-field';
import { SerialLocationField } from './serial-location-field';
import { SerialNoteField } from './serial-note-field';

export interface BulkEditDialogProps {
  open: boolean;
  count: number;
  /** Banyak baris terpilih yang berstatus Cek ulang (item dan Sample tidak berlaku untuk baris itu). */
  recheckCount?: number;
  onApply(patch: BulkPatch): void;
  onClose(): void;
}

const SAMPLE_OPTIONS = [
  { value: '', label: 'Tidak diubah' },
  { value: 'yes', label: 'Ya' },
  { value: 'no', label: 'Tidak' },
];

/** Ubah massal baris terpilih dalam dialog: hanya kolom yang diisi yang diterapkan (kosong = tidak diubah). */
export function BulkEditDialog({
  open,
  count,
  recheckCount = 0,
  onApply,
  onClose,
}: BulkEditDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      {/* Isi dimuat hanya selama dialog terbuka: tiap pembukaan mulai dari form kosong. */}
      <DialogContent className="sm:max-w-lg">
        <BulkEditBody
          count={count}
          recheckCount={recheckCount}
          onApply={onApply}
          onClose={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}

function BulkEditBody({
  count,
  recheckCount = 0,
  onApply,
  onClose,
}: Pick<BulkEditDialogProps, 'count' | 'recheckCount' | 'onApply' | 'onClose'>) {
  const [item, setItem] = useState<ItemBuValue>(EMPTY_ITEM_BU);
  const [testDate, setTestDate] = useState('');
  const [location, setLocation] = useState({ id: '', label: '' });
  const [sample, setSample] = useState('');
  const [note, setNote] = useState('');
  const [clearNote, setClearNote] = useState(false);

  // BU boleh diubah sendiri (tanpa item); item yang dipilih tetap menuntut BU (BU kosong = belum lengkap).
  const itemIncomplete = item.itemId !== '' && item.buId === '';
  const dirty =
    item.itemId !== '' ||
    item.buId !== '' ||
    testDate !== '' ||
    location.id !== '' ||
    sample !== '' ||
    note.trim() !== '' ||
    clearNote;

  function apply() {
    const patch: BulkPatch = {};
    if (item.itemId !== '') {
      patch.itemId = item.itemId;
      patch.itemLabel = item.itemLabel;
      patch.proofMin = item.proofMin;
    }
    if (item.buId !== '') {
      patch.buId = item.buId;
      patch.buLabel = item.buLabel;
    }
    if (testDate !== '') patch.testDate = testDate;
    if (location.id !== '') {
      patch.locationId = location.id;
      patch.locationLabel = location.label;
    }
    if (sample !== '') patch.sample = sample === 'yes';
    if (clearNote) patch.note = '';
    else if (note.trim() !== '') patch.note = note.trim();
    onApply(patch);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Ubah {count} baris</DialogTitle>
        <DialogDescription>
          Hanya kolom yang diisi yang diterapkan; kolom kosong tidak mengubah apa-apa.
          {recheckCount > 0
            ? ` ${recheckCount} baris berstatus Cek ulang: item dan Sample tidak diubah untuk baris itu, dan Business Unit yang tidak boleh dipakai cek ulang akan ditandai.`
            : ''}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <ItemBuField
          idPrefix="bulk"
          label="Item (ubah massal)"
          buFieldLabel="Business Unit (ubah massal)"
          value={item}
          onChange={setItem}
        />
        {itemIncomplete ? (
          <p className="text-xs text-destructive-text">Pilih Business Unit untuk item ini.</p>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="bulk-date">Tanggal uji (ubah massal)</Label>
          <Input
            id="bulk-date"
            type="date"
            value={testDate}
            onChange={(event) => setTestDate(event.target.value)}
          />
        </div>
        <SerialLocationField
          id="bulk-location"
          label="Lokasi (ubah massal)"
          value={location.id}
          onChange={(id, label) => setLocation({ id, label })}
        />
        <Select
          id="bulk-sample"
          label="Sample (ubah massal)"
          value={sample}
          options={SAMPLE_OPTIONS}
          onValueChange={setSample}
        />
        <div className="space-y-1.5">
          <SerialNoteField
            id="bulk-note"
            label="Catatan (ubah massal)"
            value={note}
            disabled={clearNote}
            onChange={setNote}
          />
          <p className="text-xs text-muted-foreground">Kosong = tidak diubah.</p>
          <div className="flex items-center gap-2">
            <Checkbox
              id="bulk-clear-note"
              checked={clearNote}
              onCheckedChange={(on) => setClearNote(on === true)}
            />
            <Label htmlFor="bulk-clear-note" className="text-xs font-normal">
              Kosongkan catatan
            </Label>
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" color="primary" onClick={onClose}>
          Batal
        </Button>
        <Button type="button" disabled={!dirty || itemIncomplete} onClick={apply}>
          Terapkan ke {count} baris
        </Button>
      </DialogFooter>
    </>
  );
}
