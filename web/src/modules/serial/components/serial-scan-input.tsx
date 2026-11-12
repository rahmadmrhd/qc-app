import { useEffect, useRef, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export type ScanFeedback = 'added' | 'duplicate' | 'rejected';

export interface SerialScanInputProps {
  id: string;
  label: string;
  /** Dipanggil dengan isi yang dikirim (satu serial, atau banyak baris dari tempelan); mengembalikan hasilnya. */
  onSubmit(text: string): ScanFeedback;
  disabled?: boolean;
  autoFocus?: boolean;
}

const FEEDBACK_TEXT: Record<ScanFeedback, string> = {
  added: 'Ditambahkan',
  duplicate: 'Sudah ada',
  rejected: 'Ditolak',
};

const FEEDBACK_FLASH: Record<ScanFeedback, string> = {
  added: 'border-emerald-500 bg-emerald-500/10',
  duplicate: 'border-amber-500 bg-amber-500/10',
  rejected: 'border-destructive bg-destructive/10',
};

const FEEDBACK_TEXT_COLOR: Record<ScanFeedback, string> = {
  added: 'text-emerald-600 dark:text-emerald-400',
  duplicate: 'text-amber-600 dark:text-amber-400',
  rejected: 'text-destructive',
};

/** Nada berbeda per hasil; satu-satunya isyarat bunyi yang dipakai pemindai fisik tanpa melihat layar. */
const FEEDBACK_TONE: Record<ScanFeedback, { frequency: number; seconds: number }> = {
  added: { frequency: 880, seconds: 0.08 },
  duplicate: { frequency: 440, seconds: 0.16 },
  rejected: { frequency: 220, seconds: 0.28 },
};

const FEEDBACK_VIBRATION: Record<ScanFeedback, number | number[]> = {
  added: 30,
  duplicate: [40, 40, 40],
  rejected: 200,
};

const FLASH_MS = 1200;

type AudioContextConstructor = new () => AudioContext;

function audioContextConstructor(): AudioContextConstructor | undefined {
  const scope = window as unknown as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext;
}

export function SerialScanInput({
  id,
  label,
  onSubmit,
  disabled = false,
  autoFocus = false,
}: SerialScanInputProps) {
  const [value, setValue] = useState('');
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      try {
        void audioRef.current?.close();
      } catch {
        // Tidak penting.
      }
    },
    [],
  );

  function beep(result: ScanFeedback) {
    try {
      const Context = audioContextConstructor();
      if (!Context) return;
      audioRef.current ??= new Context();
      const context = audioRef.current;
      const tone = FEEDBACK_TONE[result];
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = tone.frequency;
      gain.gain.value = 0.08;
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + tone.seconds);
    } catch {
      // Bunyi tidak tersedia (jsdom, kebijakan autoplay): umpan balik visual tetap ada.
    }
  }

  function vibrate(result: ScanFeedback) {
    try {
      navigator.vibrate?.(FEEDBACK_VIBRATION[result]);
    } catch {
      // Tidak didukung.
    }
  }

  function submit(text: string) {
    const result = onSubmit(text);
    setFeedback(result);
    beep(result);
    vibrate(result);
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setFeedback(null), FLASH_MS);
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
      <Label htmlFor={id}>{label}</Label>
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
          submit(pasted);
        }}
      />
      <p
        aria-live="polite"
        className={cn('min-h-4 text-xs', feedback ? FEEDBACK_TEXT_COLOR[feedback] : '')}
      >
        {feedback ? FEEDBACK_TEXT[feedback] : ''}
      </p>
    </div>
  );
}
