import { useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { CameraScanButton } from '@/modules/serial/components/camera-scan-button';
import {
  FEEDBACK_FLASH,
  FEEDBACK_TEXT_COLOR,
  type ScanFeedback,
} from '@/modules/serial/lib/scan-feedback';
import type { IsKnown } from '@/modules/serial/lib/scan-table';

export interface ScanLine {
  tone: ScanFeedback;
  text: string;
}

export interface ScanBarProps {
  /** Mengetik menyaring tabel (pemanggil menunda ~350 ms). */
  onFilterChange: (text: string) => void;
  /** Enter/Tab/tempel banyak baris = scan: teks mentah (satu atau banyak baris) diserahkan ke pemanggil. */
  onScan: (text: string, options?: { silent?: boolean }) => void;
  /** Serial (ternormalisasi) yang sudah ada di pilihan: pemindai kamera tidak mengirimnya lagi. */
  isKnown: IsKnown;
  disabled?: boolean;
  /** Pengganti placeholder saat kolom dikunci (mis. "Pilih Item dulu"). */
  lockedPlaceholder?: string;
  /** Umpan balik hasil scan terakhir (satu baris). */
  line: ScanLine | null;
  /** Serial terakhir yang ditolak/ditahan: kolom ikut berkedip. */
  flash: ScanFeedback | null;
  sticky?: boolean;
}

/**
 * SATU kolom Serial Number untuk scan sekaligus cari (spek 5.3): mengetik = menyaring, Enter atau penutup bacaan
 * pemindai (Tab) = scan serial persis itu. Tempelan banyak baris = scan tiap baris. Fokus kembali setelah tiap scan.
 */
export function ScanBar({
  onFilterChange,
  onScan,
  isKnown,
  disabled = false,
  lockedPlaceholder,
  line,
  flash,
  sticky = false,
}: ScanBarProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function setText(next: string) {
    setValue(next);
    onFilterChange(next);
  }

  function submitTyped() {
    if (value.trim() === '') return false;
    const text = value;
    setText('');
    onScan(text);
    inputRef.current?.focus();
    return true;
  }

  return (
    <div
      className={cn(
        'space-y-1.5',
        sticky && 'sticky top-[var(--headroom-offset,0px)] z-10 bg-background pb-1',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="wh-scan">Serial Number</Label>
        <CameraScanButton
          onScan={(text) => {
            // Dialog kamera sudah memberi nada saat membaca; kirim senyap agar Simpan tidak membunyikan N kali.
            onScan(text, { silent: true });
            return 'added';
          }}
          isKnown={isKnown}
          disabled={disabled}
        />
      </div>
      <Input
        id="wh-scan"
        ref={inputRef}
        value={value}
        disabled={disabled}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        inputMode="text"
        placeholder={
          disabled && lockedPlaceholder ? lockedPlaceholder : 'Scan atau ketik untuk mencari'
        }
        className={cn(
          'font-mono transition-colors touch:h-12 touch:text-base',
          flash !== null && FEEDBACK_FLASH[flash],
        )}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            submitTyped();
            return;
          }
          // Banyak pemindai menutup bacaan dengan Tab; pada kolom kosong Tab tetap memindahkan fokus.
          if (event.key === 'Tab' && !event.shiftKey && value.trim() !== '') {
            event.preventDefault();
            submitTyped();
          }
        }}
        onPaste={(event) => {
          const pasted = event.clipboardData.getData('text');
          if (!/[\r\n]/.test(pasted)) return;
          event.preventDefault();
          const field = event.currentTarget;
          const start = field.selectionStart ?? value.length;
          const end = field.selectionEnd ?? start;
          const text = `${value.slice(0, start)}${pasted}${value.slice(end)}`;
          setText('');
          onScan(text);
        }}
      />
      <p
        aria-live="polite"
        className={cn('min-h-4 text-xs', line ? FEEDBACK_TEXT_COLOR[line.tone] : '')}
      >
        {line?.text ?? ''}
      </p>
    </div>
  );
}
