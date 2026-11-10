import type { LocatedModule } from '@shared/assignments';
import { normalizeKey } from '@shared/items';
import type { Level } from '@shared/permissions';
import { useState } from 'react';
import { LinkField, type LinkOption } from '@/components/link-field';
import { locationsWith } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { useActiveLocations } from './active-locations-context';

export interface LocationFieldProps {
  id: string;
  module: LocatedModule;
  /** Level minimum untuk menulis, mis. `edit`. */
  level: Level;
  value: string;
  onChange: (locationId: string) => void;
}

/**
 * Field Lokasi untuk form tulis modul berlokasi: hanya lokasi aktif terpilih yang boleh ditulis user. Memakai
 * `LinkField` (spek BU keputusan 24); tanpa Tambah dan Buka karena lokasi tidak punya dialog tambah di form ini
 * maupun halaman lihat.
 */
export function LocationField({ id, module, level, value, onChange }: LocationFieldProps) {
  const me = useMe();
  const { selectedIds } = useActiveLocations();
  const [term, setTerm] = useState('');
  const writable = locationsWith(me, module, level, selectedIds);
  // Mengubah baris yang sudah ada: lokasinya tetap tampil walau di luar pilihan tulis atau lokasi aktif.
  const outside = value !== '' && !writable.some((location) => location.id === value);
  const known = outside ? me.locations.find((location) => location.id === value) : undefined;
  const labelOf = (locationId: string) => {
    const location = writable.find((item) => item.id === locationId) ?? known;
    return location ? `${location.name} (${location.code})` : '(lokasi tidak tersedia)';
  };
  const key = normalizeKey(term);
  const options: LinkOption[] = writable
    .map((location) => ({ id: location.id, label: `${location.name} (${location.code})` }))
    .filter((option) => key === '' || normalizeKey(option.label).includes(key));
  return (
    <div className="space-y-1.5">
      <LinkField
        id={id}
        label="Lokasi"
        placeholder="Pilih lokasi…"
        value={value === '' ? null : value}
        labelOf={labelOf}
        options={options}
        onSearchChange={setTerm}
        onChange={(next) => onChange(next ?? '')}
        disabled={writable.length === 0}
      />
      {writable.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Tidak ada lokasi aktif yang boleh Anda ubah.
        </p>
      ) : null}
    </div>
  );
}
