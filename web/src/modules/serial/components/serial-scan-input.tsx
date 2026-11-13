import { useRef, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  FEEDBACK_FLASH,
  FEEDBACK_TEXT,
  FEEDBACK_TEXT_COLOR,
  type ScanFeedback,
  useScanFeedback,
} from '../lib/scan-feedback';
import { CameraScanButton } from './camera-scan-button';

export type { ScanFeedback };

export interface SerialScanInputProps {
  id: string;
  label: string;
  /** Dipanggil dengan isi yang dikirim (satu serial, atau banyak baris dari tempelan); mengembalikan hasilnya. */
  onSubmit(text: string): ScanFeedback;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Teks umpan balik pengganti (mis. "Dicari" bagi pencarian, bukan "Ditambahkan"). */
  feedbackText?: Partial<Record<ScanFeedback, string>>;
}

export function SerialScanInput({
  id,
  label,
  onSubmit,
  disabled = false,
  autoFocus = false,
  feedbackText,
}: SerialScanInputProps) {
  const [value, setValue] = useState('');
  const { feedback, announce } = useScanFeedback();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function submit(text: string) {
    announce(onSubmit(text));
    inputRef.current?.focus();
  }

  function submitTyped() {
    if (value.trim() === '') return false;
    const text = value;
    setValue('');
    submit(text);
    return true;
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <CameraScanButton onScan={onSubmit} disabled={disabled} />
      </div>
      <Textarea
        id={id}
        ref={inputRef}
        rows={1}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        className={cn(
          'min-h-9 max-h-40 font-mono transition-colors',
          feedback !== null && FEEDBACK_FLASH[feedback],
        )}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submitTyped();
            return;
          }
          // Banyak pemindai menutup pembacaan dengan Tab: dianggap terminator (kolom kosong = Tab biasa).
          if (event.key === 'Tab' && !event.shiftKey && value.trim() !== '') {
            event.preventDefault();
            submitTyped();
          }
        }}
        onPaste={(event) => {
          const pasted = event.clipboardData.getData('text');
          if (!/[\r\n]/.test(pasted)) return;
          event.preventDefault();
          // Teks yang sudah diketik ikut terkirim (tempelan disisipkan di kursor), lalu kolom dikosongkan.
          const field = event.currentTarget;
          const start = field.selectionStart ?? value.length;
          const end = field.selectionEnd ?? start;
          const text = `${value.slice(0, start)}${pasted}${value.slice(end)}`;
          setValue('');
          submit(text);
        }}
      />
      <p
        aria-live="polite"
        className={cn('min-h-4 text-xs', feedback ? FEEDBACK_TEXT_COLOR[feedback] : '')}
      >
        {feedback ? (feedbackText?.[feedback] ?? FEEDBACK_TEXT[feedback]) : ''}
      </p>
    </div>
  );
}
