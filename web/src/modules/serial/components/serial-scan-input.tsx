import { lazy, Suspense, useRef, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { DRAFT_FULL_NOTE } from '../lib/draft';
import {
  FEEDBACK_FLASH,
  FEEDBACK_TEXT,
  FEEDBACK_TEXT_COLOR,
  type ScanFeedback,
  useScanFeedback,
} from '../lib/scan-feedback';
import type { IsKnown } from '../lib/scan-table';
import { pickSingleSerial } from '../lib/scan-table';
import {
  CameraScanButton,
  type CameraScanButtonProps,
  type StrictScan,
} from './camera-scan-button';

const StrictScanDialog = lazy(() =>
  import('./strict-scan-dialog').then((module) => ({ default: module.StrictScanDialog })),
);

const STRICT_MANY_NOTE = 'Item ini wajib foto: satu serial per kali';

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
  /** Serial (ternormalisasi) yang sudah dimiliki halaman (mis. di draft): pemindai kamera tidak menambahkannya lagi. */
  isKnown?: IsKnown;
  /** Halaman satu-serial (Lapor Rusak): dialog kamera tanpa tabel, serial sah pertama langsung dipakai. */
  cameraSingle?: boolean;
  /** Sisa kapasitas draft halaman (jumlah baris yang masih boleh ditambah), dibaca tiap bacaan kamera. */
  cameraCapacity?: () => number;
  /** Hasil semua baris sesudah Simpan di dialog kamera (menggantikan toast ringkasan dialog). */
  onCameraSaved?: CameraScanButtonProps['onSaved'];
  /**
   * Item wajib foto: satu serial per kali lewat dialog dua langkah. Tempel, ketik, dan pemindai fisik (satu serial sah
   * yang belum ada di draft) membuka dialog langsung di langkah konfirmasi; tempelan banyak serial ditolak.
   */
  strict?: StrictScan | undefined;
}

export function SerialScanInput({
  id,
  label,
  onSubmit,
  disabled = false,
  autoFocus = false,
  feedbackText,
  isKnown,
  cameraSingle,
  cameraCapacity,
  onCameraSaved,
  strict,
}: SerialScanInputProps) {
  const [value, setValue] = useState('');
  const { feedback, announce } = useScanFeedback();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [strictSerial, setStrictSerial] = useState<string | null>(null);
  const [strictOwner, setStrictOwner] = useState('');
  const [strictNote, setStrictNote] = useState<string | null>(null);

  function submit(text: string) {
    if (strict) {
      submitStrict(text, strict);
      return;
    }
    announce(onSubmit(text));
    inputRef.current?.focus();
  }

  function submitStrict(text: string, context: StrictScan) {
    const pick = pickSingleSerial(text);
    if (pick.serial === null) {
      setStrictNote(pick.reason === 'many' ? STRICT_MANY_NOTE : null);
      announce('rejected');
      inputRef.current?.focus();
      return;
    }
    if (context.isKnown(pick.serial)) {
      setStrictNote(null);
      announce('duplicate');
      inputRef.current?.focus();
      return;
    }
    // Draft penuh: jangan buka dialog (pengguna akan memotret lalu kehilangan fotonya).
    if (context.capacity && context.capacity() <= 0) {
      setStrictNote(DRAFT_FULL_NOTE);
      announce('rejected');
      inputRef.current?.focus();
      return;
    }
    setStrictNote(null);
    setStrictOwner(context.newOwnerId());
    setStrictSerial(pick.serial);
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
        <CameraScanButton
          onScan={onSubmit}
          isKnown={isKnown}
          single={cameraSingle}
          onSaved={onCameraSaved}
          draftCapacity={cameraCapacity}
          strict={strict}
          disabled={disabled}
        />
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
        {feedback
          ? feedback === 'rejected' && strictNote !== null
            ? `${FEEDBACK_TEXT.rejected}: ${strictNote}`
            : (feedbackText?.[feedback] ?? FEEDBACK_TEXT[feedback])
          : ''}
      </p>
      {strict && strictSerial !== null ? (
        <Suspense fallback={null}>
          <StrictScanDialog
            open
            onOpenChange={(open) => {
              if (!open) {
                setStrictSerial(null);
                inputRef.current?.focus();
              }
            }}
            initialSerial={strictSerial}
            info={strict.info}
            ownerId={strictOwner}
            proof={strict.proof}
            isKnown={strict.isKnown}
            onConfirm={strict.onConfirm}
            capacity={strict.capacity}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
