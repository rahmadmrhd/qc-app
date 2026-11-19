import { useQuery } from '@tanstack/react-query';
import { LinkField, type LinkOption } from '@/components/link-field';
import { serialBuOptionsQueryOptions } from '../queries';

export interface BuChoice {
  id: string;
  code: string;
}

/** BU yang boleh ditulis pengguna (`serials.buOptions`); `bus` kosong (`null`) selagi memuat atau bila gagal. */
export function useWritableBus(): { bus: BuChoice[] | null; loading: boolean } {
  const { data, isPending } = useQuery(serialBuOptionsQueryOptions());
  return {
    bus: data ? data.businessUnits.map((bu) => ({ id: bu.id, code: bu.code })) : null,
    loading: isPending,
  };
}

/**
 * Pilihan BU untuk `allowedIds` (BU yang lolos aturan cek ulang menurut server), dengan kode dari daftar BU tulis;
 * `fallback` mengisi kode BU yang belum ada di daftar itu (mis. BU saat ini serial). Urutan `allowedIds` dipertahankan.
 */
export function choicesFor(
  allowedIds: readonly string[],
  bus: readonly BuChoice[] | null,
  fallback: readonly BuChoice[] = [],
): BuChoice[] {
  return allowedIds.map((id) => ({
    id,
    code: bus?.find((bu) => bu.id === id)?.code ?? fallback.find((bu) => bu.id === id)?.code ?? id,
  }));
}

export interface RecheckBuFieldProps {
  id: string;
  label: string;
  /** Satu-satunya BU yang boleh dipilih (BU saat ini atau BU yang belum pernah terlibat). */
  choices: readonly BuChoice[];
  value: { buId: string; buLabel: string };
  onChange: (value: { buId: string; buLabel: string }) => void;
  error?: string | undefined;
  disabled?: boolean;
  loading?: boolean;
  placeholder?: string;
}

/**
 * Pilihan BU target cek ulang (`LinkField`, saran disaring lokal): hanya BU di `choices`. Tanpa Tambah/Buka (BU
 * dikelola di halaman Business Unit). Mengosongkan pilihan menghasilkan `buId` kosong.
 */
export function RecheckBuField({
  id,
  label,
  choices,
  value,
  onChange,
  error,
  disabled,
  loading,
  placeholder = 'Pilih Business Unit…',
}: RecheckBuFieldProps) {
  const options: LinkOption[] = choices.map((bu) => ({ id: bu.id, label: bu.code }));
  return (
    <LinkField
      id={id}
      label={label}
      placeholder={placeholder}
      value={value.buId === '' ? null : value.buId}
      labelOf={(buId) =>
        buId === value.buId ? value.buLabel : (choices.find((bu) => bu.id === buId)?.code ?? buId)
      }
      options={options}
      loading={loading ?? false}
      localFilter
      onChange={(buId) => {
        const bu = choices.find((choice) => choice.id === buId);
        onChange({ buId: bu?.id ?? '', buLabel: bu?.code ?? '' });
      }}
      error={error}
      disabled={disabled ?? false}
    />
  );
}
