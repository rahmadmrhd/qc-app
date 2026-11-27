import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

/**
 * Sisi kiri bar bawah ponsel form Catat Serial WH: ✕ batalkan pilihan, kotak centang tri-state (pilih semua / lepas
 * semua; sebagian = minus), dan "N dipilih", lalu Batal dan Simpan form di sebelah kanannya (`FormPage.selectionBar`).
 * Fokus tidak dipindahkan ke sini: kolom Serial Number tetap fokus agar pemindai fisik terus bekerja.
 */
export function SelectionSummary({
  count,
  allSelected,
  disabled = false,
  onClear,
  onToggleAll,
}: {
  count: number;
  allSelected: boolean;
  disabled?: boolean;
  /** ✕: batalkan seluruh pilihan. */
  onClear: () => void;
  /** Kotak centang: pilih semua, atau lepas semua bila sudah semua terpilih. */
  onToggleAll: () => void;
}) {
  const checked = allSelected ? true : count > 0 ? 'indeterminate' : false;
  return (
    <div data-slot="selection-summary" className="flex min-w-0 items-center">
      <Button
        type="button"
        variant="ghost"
        color="primary"
        size="icon"
        aria-label="Batalkan pilihan"
        disabled={disabled}
        onClick={onClear}
      >
        <X aria-hidden />
      </Button>
      {/* biome-ignore lint/a11y/noLabelWithoutControl: Checkbox Radix adalah kontrolnya */}
      <label className="flex min-h-11 min-w-11 shrink-0 items-center justify-center">
        <Checkbox
          aria-label={allSelected ? 'Lepas semua' : 'Pilih semua'}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onToggleAll}
        />
      </label>
      <span role="status" className="min-w-0 truncate text-sm font-medium">
        {count} dipilih
      </span>
    </div>
  );
}
