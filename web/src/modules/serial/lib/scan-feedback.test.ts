import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useScanFeedback } from './scan-feedback';

interface FakeParam {
  value: number;
  setValueAtTime: ReturnType<typeof vi.fn>;
  linearRampToValueAtTime: ReturnType<typeof vi.fn>;
  cancelScheduledValues: ReturnType<typeof vi.fn>;
}

function fakeAudio(state: AudioContextState = 'running') {
  const oscillators: {
    type: string;
    frequency: { value: number };
    connect: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }[] = [];
  const gains: { gain: FakeParam; connect: ReturnType<typeof vi.fn> }[] = [];
  const resume = vi.fn(async () => undefined);
  const close = vi.fn(async () => undefined);
  class FakeContext {
    state = state;
    currentTime = 0;
    destination = {};
    resume = resume;
    close = close;
    createOscillator() {
      const oscillator = {
        type: 'sine',
        frequency: { value: 0 },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      oscillators.push(oscillator);
      return oscillator;
    }
    createGain() {
      const gain = {
        gain: {
          value: 1,
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          cancelScheduledValues: vi.fn(),
        },
        connect: vi.fn(),
      };
      gains.push(gain);
      return gain;
    }
  }
  vi.stubGlobal('AudioContext', FakeContext);
  return { oscillators, gains, resume, close };
}

/** Puncak amplitudo yang dijadwalkan pada satu simpul gain (nilai awal + semua setValueAtTime/linearRamp). */
function peakOf(gain: FakeParam): number {
  const values = [
    gain.value,
    ...gain.setValueAtTime.mock.calls.map((call) => call[0] as number),
    ...gain.linearRampToValueAtTime.mock.calls.map((call) => call[0] as number),
  ];
  return Math.max(...values);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('nada jelas terdengar: puncak gain > 0.5, gelombang persegi, envelope halus (mulai dan berakhir di 0)', () => {
  const audio = fakeAudio();
  const { result } = renderHook(() => useScanFeedback());
  act(() => result.current.announce('added'));
  expect(audio.oscillators).toHaveLength(1);
  expect(audio.oscillators[0]?.type).toBe('square');
  const gain = audio.gains[0]?.gain as FakeParam;
  expect(peakOf(gain)).toBeGreaterThan(0.5);
  expect(peakOf(gain)).toBeLessThanOrEqual(1);
  // Attack dan decay pendek (tanpa klik): awal 0 dan akhir 0.
  expect(gain.setValueAtTime.mock.calls[0]?.[0]).toBe(0);
  const ramps = gain.linearRampToValueAtTime.mock.calls;
  expect(ramps[ramps.length - 1]?.[0]).toBe(0);
  expect(audio.oscillators[0]?.start).toHaveBeenCalled();
  expect(audio.oscillators[0]?.stop).toHaveBeenCalled();
});

test('nada berbeda per hasil: frekuensi dan durasi', () => {
  const audio = fakeAudio();
  const { result } = renderHook(() => useScanFeedback());
  const spec = new Map<string, { frequency: number; stop: number }>();
  for (const feedback of ['added', 'duplicate', 'rejected'] as const) {
    act(() => result.current.announce(feedback));
    const oscillator = audio.oscillators[audio.oscillators.length - 1];
    spec.set(feedback, {
      frequency: oscillator?.frequency.value ?? 0,
      stop: (oscillator?.stop.mock.calls[0]?.[0] as number) ?? 0,
    });
  }
  const frequencies = new Set([...spec.values()].map((tone) => tone.frequency));
  expect(frequencies.size).toBe(3);
  // Berhasil paling singkat, ditolak paling panjang; durasi tambah wajar (>= 150 ms).
  expect(spec.get('added')?.stop).toBeGreaterThanOrEqual(0.15);
  expect(spec.get('rejected')?.stop).toBeGreaterThan(spec.get('added')?.stop ?? 0);
});

test('AudioContext yang suspended dilanjutkan (kebijakan autoplay); yang berjalan tidak dipanggil resume', () => {
  const suspended = fakeAudio('suspended');
  const first = renderHook(() => useScanFeedback());
  act(() => first.result.current.announce('added'));
  expect(suspended.resume).toHaveBeenCalledTimes(1);
  first.unmount();

  const running = fakeAudio('running');
  const second = renderHook(() => useScanFeedback());
  act(() => second.result.current.announce('added'));
  expect(running.resume).not.toHaveBeenCalled();
});

test('unlock membuat dan melanjutkan konteks audio tanpa membunyikan nada (dipanggil dari gerak pengguna)', () => {
  const audio = fakeAudio('suspended');
  const { result } = renderHook(() => useScanFeedback());
  act(() => result.current.unlock());
  expect(audio.resume).toHaveBeenCalledTimes(1);
  expect(audio.oscillators).toHaveLength(0);
});

test('getar tetap per hasil dan kilat padam sendiri', () => {
  fakeAudio();
  const vibrate = vi.fn();
  Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
  const { result } = renderHook(() => useScanFeedback());
  act(() => result.current.announce('rejected'));
  expect(vibrate).toHaveBeenCalledWith(200);
  expect(result.current.feedback).toBe('rejected');
  act(() => {
    vi.advanceTimersByTime(1300);
  });
  expect(result.current.feedback).toBeNull();
  Reflect.deleteProperty(navigator, 'vibrate');
});

test('tanpa Web Audio: umpan balik visual dan getar tetap jalan tanpa galat', () => {
  vi.stubGlobal('AudioContext', undefined);
  const { result } = renderHook(() => useScanFeedback());
  act(() => result.current.announce('added'));
  expect(result.current.feedback).toBe('added');
});
