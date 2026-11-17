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

/**
 * Nada berbeda per hasil; satu-satunya isyarat bunyi yang dipakai pemindai tanpa melihat layar.
 *
 * Gelombang `square` (seperti bip pemindai kasir): energinya paling besar untuk amplitudo yang sama (RMS = puncak,
 * sinus hanya 0,71 puncak) dan harmoniknya yang tinggi terdengar jelas di speaker ponsel yang lemah di nada rendah.
 * Puncak gain 0,9 (bukan 1) menyisakan ruang agar tak terpotong; attack/decay pendek menghindari bunyi "klik".
 *
 * Volume TIDAK diatur sendiri: Web Audio keluar lewat saluran MEDIA perangkat, jadi mengikuti tombol volume media.
 * Batasan platform: di iOS, Web Audio dibisukan oleh sakelar senyap (ringer) dan hanya bisa mulai setelah gerak
 * pengguna (lihat `unlock`).
 */
const FEEDBACK_TONE: Record<ScanFeedback, { frequency: number; seconds: number }> = {
  added: { frequency: 1568, seconds: 0.15 },
  duplicate: { frequency: 880, seconds: 0.22 },
  rejected: { frequency: 330, seconds: 0.4 },
};

const TONE_PEAK_GAIN = 0.9;
const TONE_ATTACK_SECONDS = 0.008;
const TONE_DECAY_SECONDS = 0.03;

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
 * Satu konteks audio untuk seluruh halaman (dibuat malas, dipakai bersama kolom pindai dan dialog kamera). Dibuat dan
 * dilanjutkan dari gerak pengguna yang membuka dialog (`unlockScanAudio`, dipanggil tombol kamera dan ketukan di
 * dialog): iOS Safari hanya mau memulai Web Audio dari klik/sentuhan, bukan dari pembacaan kamera yang tiba kemudian.
 * Tidak ditutup saat dialog ditutup (masih dipakai halaman); konteks baru hanya bila konstruktor Web Audio berganti
 * (tes).
 */
let shared: { Context: AudioContextConstructor; context: AudioContext } | null = null;

function sharedAudioContext(): AudioContext | null {
  const Context = audioContextConstructor();
  if (!Context) return null;
  if (shared === null || shared.Context !== Context) {
    closeQuietly(shared?.context);
    shared = { Context, context: new Context() };
  }
  const { context } = shared;
  // `interrupted` (iOS Safari: setelah panggilan atau aplikasi ke latar) juga perlu dilanjutkan, bukan hanya `suspended`.
  if (context.state === 'suspended' || (context.state as string) === 'interrupted') {
    void Promise.resolve(context.resume()).catch(() => undefined);
  }
  return context;
}

function closeQuietly(context: AudioContext | undefined) {
  try {
    void Promise.resolve(context?.close()).catch(() => undefined);
  } catch {
    // Tidak penting.
  }
}

/** Menyiapkan bunyi dari dalam gerak pengguna (klik/sentuhan); tanpa membunyikan nada. Aman dipanggil berulang. */
export function unlockScanAudio() {
  try {
    sharedAudioContext();
  } catch {
    // Tidak penting.
  }
}

/** Menutup konteks bersama (tes). */
export function resetScanAudio() {
  closeQuietly(shared?.context);
  shared = null;
}

/**
 * Umpan balik satu pembacaan (kilat, teks, nada, getar), dipakai bersama kolom pindai dan dialog kamera.
 * `announce(hasil)` menyalakan semuanya; kilat padam sendiri setelah `FLASH_MS`.
 */
export function useScanFeedback() {
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  const audioContext = sharedAudioContext;
  const unlock = unlockScanAudio;

  const announce = useCallback((result: ScanFeedback) => {
    setFeedback(result);
    try {
      const context = audioContext();
      if (context) {
        const tone = FEEDBACK_TONE[result];
        const start = context.currentTime;
        const end = start + tone.seconds;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'square';
        oscillator.frequency.value = tone.frequency;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(TONE_PEAK_GAIN, start + TONE_ATTACK_SECONDS);
        gain.gain.setValueAtTime(TONE_PEAK_GAIN, end - TONE_DECAY_SECONDS);
        gain.gain.linearRampToValueAtTime(0, end);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start);
        oscillator.stop(end);
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

  return { feedback, announce, unlock };
}
