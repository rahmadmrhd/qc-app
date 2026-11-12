import { SERIAL_LIMITS } from '@shared/serials';
import { useState } from 'react';
import { Select } from '@/components/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { BulkPatch } from '../lib/draft';
import { EMPTY_ITEM_BU, ItemBuField, type ItemBuValue } from './item-bu-field';
import { SerialLocationField } from './serial-location-field';

export interface BulkEditBarProps {
  count: number;
  onApply: (patch: BulkPatch) => void;
  onRemove: () => void;
  onClearSelection: () => void;
}

const SAMPLE_OPTIONS = [
  { value: '', label: 'Tidak diubah' },
  { value: 'yes', label: 'Ya' },
  { value: 'no', label: 'Tidak' },
];

/** Ubah massal baris terpilih: hanya kolom yang diisi yang diterapkan (kosong = tidak diubah). */
export function BulkEditBar({ count, onApply, onRemove, onClearSelection }: BulkEditBarProps) {
  const [item, setItem] = useState<ItemBuValue>(EMPTY_ITEM_BU);
  const [testDate, setTestDate] = useState('');
  const [location, setLocation] = useState({ id: '', label: '' });
  const [sample, setSample] = useState('');
  const [note, setNote] = useState('');

  const itemIncomplete = item.itemId !== '' && item.buId === '';
  const dirty =
    item.itemId !== '' ||
    testDate !== '' ||
    location.id !== '' ||
    sample !== '' ||
    note.trim() !== '';

  function apply() {
    const patch: BulkPatch = {};
    if (item.itemId !== '') {
      patch.itemId = item.itemId;
      patch.itemLabel = item.itemLabel;
      patch.buId = item.buId;
      patch.buLabel = item.buLabel;
    }
    if (testDate !== '') patch.testDate = testDate;
    if (location.id !== '') {
      patch.locationId = location.id;
      patch.locationLabel = location.label;
    }
    if (sample !== '') patch.sample = sample === 'yes';
    if (note.trim() !== '') patch.note = note.trim();
    onApply(patch);
    setItem(EMPTY_ITEM_BU);
    setTestDate('');
    setLocation({ id: '', label: '' });
    setSample('');
    setNote('');
  }

  return (
    <section aria-label="Ubah massal" className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Ubah massal ({count} baris terpilih)</h2>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClearSelection}>
            Batal pilih
          </Button>
          <Button type="button" variant="destructive" size="sm" onClick={onRemove}>
            Hapus terpilih
          </Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <ItemBuField
          idPrefix="bulk"
          label="Item (ubah massal)"
          buFieldLabel="Business Unit (ubah massal)"
          value={item}
          onChange={setItem}
        />
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
          <Label htmlFor="bulk-note">Catatan (ubah massal)</Label>
          <Input
            id="bulk-note"
            value={note}
            maxLength={SERIAL_LIMITS.noteMax}
            placeholder="Kosong = tidak diubah"
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
      </div>
      <Button type="button" size="sm" disabled={!dirty || itemIncomplete} onClick={apply}>
        Terapkan ke {count} baris
      </Button>
      {itemIncomplete ? (
        <p className="text-xs text-destructive">Pilih Business Unit untuk item ini.</p>
      ) : null}
    </section>
  );
}
