import { Pause, Play } from 'lucide-react';
import { useEffect, useReducer, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { DemoCue, DemoScene } from '../lib/demo-types';

/** Lama kartu langkah teks (klip yang belum ada/gagal dimuat) sebelum pemutar berganti adegan. */
export const TEXT_SCENE_MS = 4000;

interface PlayerState {
  index: number;
  paused: boolean;
}
type PlayerAction =
  | { type: 'next'; count: number }
  | { type: 'goto'; index: number }
  | { type: 'toggle' };

function reducer(state: PlayerState, action: PlayerAction): PlayerState {
  switch (action.type) {
    case 'next':
      return { ...state, index: action.count > 0 ? (state.index + 1) % action.count : 0 };
    case 'goto':
      return { ...state, index: action.index };
    case 'toggle':
      return { ...state, paused: !state.paused };
  }
}

function matches(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false;
}

/** `prefers-reduced-motion: reduce`, diikuti bila pengaturannya berubah saat tooltip terbuka. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => matches('(prefers-reduced-motion: reduce)'));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** Cue terakhir yang `at`-nya sudah lewat; tanpa cue yang cocok, keterangan dasar adegan. */
function captionAt(fallback: string, cues: readonly DemoCue[] | undefined, time: number): string {
  let text = fallback;
  let best = -1;
  for (const cue of cues ?? []) {
    if (cue.at <= time && cue.at > best) {
      best = cue.at;
      text = cue.text;
    }
  }
  return text;
}

function StepList({ scenes }: { scenes: readonly DemoScene[] }) {
  return (
    <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm">
      {scenes.map((scene, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: daftar statis, urutan adalah identitasnya
        <li key={i}>{scene.caption}</li>
      ))}
    </ol>
  );
}

function StepCard({ number, text }: { number: number; text: string }) {
  return (
    <div className="flex min-h-24 items-start gap-3 p-3 text-sm" aria-live="polite">
      <span
        aria-hidden
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground"
      >
        {number}
      </span>
      <p>{text}</p>
    </div>
  );
}

function ClipScene({
  scene,
  paused,
  loop,
  onCaption,
  onEnded,
  onError,
}: {
  scene: Extract<DemoScene, { kind: 'klip' }>;
  paused: boolean;
  loop: boolean;
  onCaption: (text: string) => void;
  onEnded: () => void;
  onError: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (paused) {
      video.pause();
      return;
    }
    // Pemutaran otomatis dapat ditolak peramban; klip tetap tampil dan keterangan dasar tetap terbaca.
    video.play()?.catch(() => undefined);
  }, [paused]);
  return (
    <video
      ref={ref}
      src={scene.berkas}
      className="aspect-video w-full rounded-md bg-muted object-contain"
      muted
      loop={loop}
      playsInline
      autoPlay
      preload="none"
      onTimeUpdate={(event) =>
        onCaption(captionAt(scene.caption, scene.cues, event.currentTarget.currentTime))
      }
      onEnded={onEnded}
      onError={onError}
    />
  );
}

/**
 * Pemutar demo tooltip (spek 4.6): adegan `kode` bergantian menurut `durationMs`, adegan `klip` memutar video
 * tanpa suara dengan keterangan mengikuti `cues`. Berulang dari adegan pertama. Klip tanpa `berkas` atau yang gagal
 * dimuat tampil sebagai kartu langkah bernomor untuk adegan itu saja (berganti seperti adegan kode, `TEXT_SCENE_MS`);
 * adegan lain tetap beranimasi. `prefers-reduced-motion` menjatuhkan SELURUH pemutar ke daftar langkah bernomor.
 */
export function DemoPlayer({ scenes }: { scenes: readonly DemoScene[] }) {
  const [state, dispatch] = useReducer(reducer, { index: 0, paused: false });
  const reduced = usePrefersReducedMotion();
  const [failedClips, setFailedClips] = useState<ReadonlySet<number>>(() => new Set());
  const [clipCaption, setClipCaption] = useState<string | null>(null);

  const count = scenes.length;
  const index = Math.min(state.index, Math.max(count - 1, 0));
  const scene = scenes[index];
  // Klip tanpa `berkas` atau yang gagal dimuat tampil sebagai kartu langkah teks untuk adegan itu saja.
  const textClip =
    scene?.kind === 'klip' && (!scene.berkas || failedClips.has(index)) ? scene : null;
  const fallback = reduced;

  // Keterangan klip mengikuti video; tiap pindah adegan kembali ke keterangan dasar.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `index` sengaja memicu reset keterangan
  useEffect(() => setClipCaption(null), [index]);

  useEffect(() => {
    if (fallback || state.paused || !scene) return;
    let duration: number;
    if (scene.kind === 'kode') duration = scene.durationMs;
    else if (textClip) duration = TEXT_SCENE_MS;
    else return; // klip yang diputar: berganti lewat `ended`
    const timer = setTimeout(() => dispatch({ type: 'next', count }), duration);
    return () => clearTimeout(timer);
  }, [fallback, state.paused, scene, textClip, count]);

  if (count === 0) return null;
  if (fallback) return <StepList scenes={scenes} />;
  if (!scene) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-md border bg-card">
        {scene.kind === 'kode' ? (
          scene.render()
        ) : textClip ? (
          <StepCard number={index + 1} text={textClip.caption} />
        ) : (
          <ClipScene
            // Video baru per adegan agar waktu cue dan `src` tidak terbawa.
            key={index}
            scene={scene}
            paused={state.paused}
            loop={count === 1}
            onCaption={setClipCaption}
            onEnded={() => dispatch({ type: 'next', count })}
            onError={() => setFailedClips((current) => new Set(current).add(index))}
          />
        )}
      </div>
      {textClip ? null : (
        <p className="min-h-10 text-sm" aria-live="polite">
          {scene.kind === 'klip' ? (clipCaption ?? scene.caption) : scene.caption}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={state.paused ? 'Putar' : 'Jeda'}
          className="inline-flex size-7 items-center justify-center rounded-md border text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
          onClick={() => dispatch({ type: 'toggle' })}
        >
          {state.paused ? (
            <Play className="size-3.5" aria-hidden />
          ) : (
            <Pause className="size-3.5" aria-hidden />
          )}
        </button>
        {count > 1 ? (
          <div className="flex items-center">
            {scenes.map((_, i) => (
              <button
                // biome-ignore lint/suspicious/noArrayIndexKey: daftar statis, urutan adalah identitasnya
                key={i}
                type="button"
                aria-label={`Adegan ${i + 1}`}
                aria-current={i === index ? 'true' : undefined}
                className="group inline-flex size-6 items-center justify-center focus-visible:outline-hidden"
                onClick={() => dispatch({ type: 'goto', index: i })}
              >
                <span
                  className={cn(
                    'size-2 rounded-full bg-muted-foreground/40 transition-colors group-focus-visible:ring-2 group-focus-visible:ring-ring',
                    i === index && 'bg-primary',
                  )}
                />
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
