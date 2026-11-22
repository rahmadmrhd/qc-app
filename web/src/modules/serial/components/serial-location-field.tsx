import type { MeDto, SerialLocationOptionDto } from '@shared/contract';
import { normalizeKey } from '@shared/items';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { LinkField } from '@/components/link-field';
import { locationLinkAccess } from '@/lib/link-access';
import { meQueryKey } from '@/modules/auth/queries';
import { toLocationOptions } from '../lib/locations';
import { useSerialLocations } from '../lib/use-serial-locations';

export interface SerialLocationFieldProps {
  id: string;
  label: string;
  /** Id lokasi terpilih; `''` = belum dipilih. */
  value: string;
  /** Label lokasi terpilih bila tidak termasuk pilihan (mis. lokasi dari catatan tersimpan atau berkas impor). */
  valueLabel?: string;
  onChange: (locationId: string, label: string) => void;
  placeholder?: string;
  hideLabel?: boolean;
  className?: string;
  error?: string | undefined;
  disabled?: boolean;
  required?: boolean;
  /** Daftar pilihan tertentu (mis. lokasi servis); tanpa ini = semua lokasi yang dapat dipilih di modul serial. */
  locations?: readonly SerialLocationOptionDto[];
}

/**
 * Pilih lokasi serial (`LinkField`, tanpa Tambah). Buka ke View lokasi hanya bila pemakai berhak (`access: view`,
 * `locationLinkAccess`; keputusan pemilik 18); `me` dibaca dari cache (selalu termuat saat boot), tanpa suspend.
 */
export function SerialLocationField({
  id,
  label,
  value,
  valueLabel,
  onChange,
  placeholder = 'Pilih lokasi…',
  hideLabel,
  className,
  error,
  disabled,
  required,
  locations: restrictTo,
}: SerialLocationFieldProps) {
  const { locations: known, isPending } = useSerialLocations();
  const me = useQueryClient().getQueryData<MeDto>(meQueryKey);
  const openHref = locationLinkAccess(me).openLocationHref;
  const locations = restrictTo ?? known;
  const [term, setTerm] = useState('');
  const all = toLocationOptions(locations);
  const key = normalizeKey(term);
  const options = all.filter((option) => key === '' || normalizeKey(option.label).includes(key));
  return (
    <LinkField
      id={id}
      required={required}
      label={label}
      placeholder={placeholder}
      value={value === '' ? null : value}
      labelOf={(locationId) =>
        all.find((option) => option.id === locationId)?.label ??
        (locationId === value && valueLabel ? valueLabel : locationId)
      }
      options={options}
      loading={restrictTo === undefined && isPending}
      onSearchChange={setTerm}
      searchDebounceMs={0}
      onChange={(next) =>
        onChange(next ?? '', all.find((option) => option.id === next)?.label ?? '')
      }
      openHref={openHref}
      {...(hideLabel !== undefined ? { hideLabel } : {})}
      {...(className !== undefined ? { className } : {})}
      {...(error !== undefined ? { error } : {})}
      {...(disabled !== undefined ? { disabled } : {})}
    />
  );
}
