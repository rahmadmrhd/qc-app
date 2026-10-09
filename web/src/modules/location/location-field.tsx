import type { LocatedModule } from '@shared/assignments';
import type { Level } from '@shared/permissions';
import { NativeSelect } from '@/components/native-select';
import { Label } from '@/components/ui/label';
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

/** Field Lokasi untuk form tulis modul berlokasi: hanya lokasi aktif terpilih yang boleh ditulis user. */
export function LocationField({ id, module, level, value, onChange }: LocationFieldProps) {
  const me = useMe();
  const { selectedIds } = useActiveLocations();
  const options = locationsWith(me, module, level, selectedIds);
  // Mengubah baris yang sudah ada: lokasinya tetap tampil walau di luar pilihan tulis atau lokasi aktif.
  const outside = value !== '' && !options.some((location) => location.id === value);
  const known = outside ? me.locations.find((location) => location.id === value) : undefined;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Lokasi</Label>
      <NativeSelect
        id={id}
        value={value}
        disabled={options.length === 0}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="" disabled>
          Pilih lokasi…
        </option>
        {outside ? (
          <option value={value} disabled>
            {known ? `${known.name} (${known.code})` : '(lokasi tidak tersedia)'}
          </option>
        ) : null}
        {options.map((location) => (
          <option key={location.id} value={location.id}>
            {`${location.name} (${location.code})`}
          </option>
        ))}
      </NativeSelect>
      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Tidak ada lokasi aktif yang boleh Anda ubah.
        </p>
      ) : null}
    </div>
  );
}
