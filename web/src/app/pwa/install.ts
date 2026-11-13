import { useSyncExternalStore } from 'react';

export type InstallState = 'unavailable' | 'prompt' | 'ios-manual';

/** Peristiwa `beforeinstallprompt` (belum ada di lib.dom). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<unknown>;
}

// Peristiwa bisa tiba SEBELUM React merender; karena itu ditangkap di tingkat modul (FR-P5).
let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** iPhone/iPad/iPod, termasuk iPadOS yang menyamar sebagai Mac (`MacIntel` dengan layar sentuh). */
export function isIosBrowser(
  nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>,
): boolean {
  if (/iPad|iPhone|iPod/.test(nav.userAgent)) return true;
  return nav.platform === 'MacIntel' && nav.maxTouchPoints > 1;
}

/** Aplikasi sedang berjalan sebagai aplikasi terpasang (bukan tab peramban). */
export function isStandalone(win: Window): boolean {
  const mediaMatch = win.matchMedia?.('(display-mode: standalone)').matches ?? false;
  const iosStandalone = (win.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return mediaMatch || iosStandalone;
}

/** Mulai menangkap `beforeinstallprompt`/`appinstalled`; panggil sebelum render. Mengembalikan pembersih. */
export function startInstallCapture(win: Window = window): () => void {
  const onPrompt = (event: Event) => {
    // Tanpa ini peramban menampilkan mini-infobar sendiri; ajakan hanya lewat menu pengguna.
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    emit();
  };
  const onInstalled = () => {
    deferred = null;
    installed = true;
    emit();
  };
  win.addEventListener('beforeinstallprompt', onPrompt);
  win.addEventListener('appinstalled', onInstalled);
  return () => {
    win.removeEventListener('beforeinstallprompt', onPrompt);
    win.removeEventListener('appinstalled', onInstalled);
  };
}

function currentState(): InstallState {
  if (installed || isStandalone(window)) return 'unavailable';
  if (deferred) return 'prompt';
  if (isIosBrowser(navigator)) return 'ios-manual';
  return 'unavailable';
}

async function install(): Promise<void> {
  const event = deferred;
  if (!event) return;
  // Peristiwa hanya boleh dipakai sekali.
  deferred = null;
  emit();
  try {
    await event.prompt();
  } catch {
    // prompt() dapat ditolak (peristiwa kedaluwarsa, di luar gestur); bukan galat yang perlu ditampilkan.
  }
}

/** Status ajakan pasang dan aksinya; `install` hanya bermakna pada status `prompt`. */
export function useInstall(): { state: InstallState; install: () => Promise<void> } {
  const state = useSyncExternalStore(subscribe, currentState, () => 'unavailable' as InstallState);
  return { state, install };
}

export function resetInstallForTests(): void {
  deferred = null;
  installed = false;
  emit();
}
