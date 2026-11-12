import { normalizeKey } from '@shared/items';
import { useState } from 'react';
import { LinkField } from '@/components/link-field';
import { useMe } from '@/modules/auth/use-me';
import { serialLocationOptions } from '../lib/locations';

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
}

/** Pilih lokasi serial (`LinkField`, tanpa Tambah dan Buka). */
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
}: SerialLocationFieldProps) {
  const me = useMe();
  const [term, setTerm] = useState('');
  const all = serialLocationOptions(me);
  const key = normalizeKey(term);
  const options = all.filter((option) => key === '' || normalizeKey(option.label).includes(key));
  return (
    <LinkField
      id={id}
      label={label}
      placeholder={placeholder}
      value={value === '' ? null : value}
      labelOf={(locationId) =>
        all.find((option) => option.id === locationId)?.label ??
        (locationId === value && valueLabel ? valueLabel : locationId)
      }
      options={options}
      onSearchChange={setTerm}
      searchDebounceMs={0}
      onChange={(next) =>
        onChange(next ?? '', all.find((option) => option.id === next)?.label ?? '')
      }
      {...(hideLabel !== undefined ? { hideLabel } : {})}
      {...(className !== undefined ? { className } : {})}
      {...(error !== undefined ? { error } : {})}
      {...(disabled !== undefined ? { disabled } : {})}
    />
  );
}
