import { useCallback, useEffect, useRef, useState } from 'react';

export type ScanFeedback = 'added' | 'duplicate' | 'rejected';

export const FEEDBACK_TEXT: Record<ScanFeedback, string> = {
  added: 'Ditambahkan',
  duplicate: 'Sudah ada',
  rejected: 'Ditolak',
};

export const FEEDBACK_FLASH: Record<ScanFeedback, string> = {
  added: 'border-emerald-500 bg-emerald-500/10',
  duplicate: 'border-amber-500 bg-amber-500/10',
  rejected: 'border-destructive bg-destructive/10',
};

export const FEEDBACK_TEXT_COLOR: Record<ScanFeedback, string> = {
  added: 'text-emerald-600 dark:text-emerald-400',
  duplicate: 'text-amber-600 dark:text-amber-400',
  rejected: 'text-destructive',
};

/** Nada berbeda per hasil; satu-satunya isyarat bunyi yang dipakai pemindai tanpa melihat layar. */
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

export const FLASH_MS = 1200;

type AudioContextConstructor = new () => AudioContext;

function audioContextConstructor(): AudioContextConstructor | undefined {
  const scope = window as unknown as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext;
}

/**
 * Umpan balik satu pembacaan (kilat, teks, nada, getar), dipakai bersama kolom pindai dan dialog kamera.
 * `announce(hasil)` menyalakan semuanya; kilat padam sendiri setelah `FLASH_MS`.
 */
export function useScanFeedback() {
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null);
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

  const announce = useCallback((result: ScanFeedback) => {
    setFeedback(result);
    try {
      const Context = audioContextConstructor();
      if (Context) {
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
      }
    } catch {
      // Bunyi tidak tersedia (jsdom, kebijakan autoplay): umpan balik visual tetap ada.
    }
    try {
      navigator.vibrate?.(FEEDBACK_VIBRATION[result]);
    } catch {
      // Tidak didukung.
    }
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setFeedback(null), FLASH_MS);
  }, []);

  return { feedback, announce };
}
