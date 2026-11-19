// Pembantu bersama IPC proses utama (dipakai `ipc.ts`, `inject-runner.ts`, dan `multi/host.ts`): galat yang aman
// diteruskan ke renderer, validasi argumen zod, dan pembersih teks progres. Dipisah dari `ipc.ts` agar modul lain tak
// perlu mengimpor `ipc.ts` (dan tak membuat impor melingkar).

import { type BRIDGE_ARGS, stripTerminalControl } from '@countrylock/bridge-contract';
import type { z } from 'zod';
import { maskSecrets } from './ssh/inject-session';

/** Galat yang pesannya aman ditampilkan ke renderer (tanpa kata sandi). */
export class IpcError extends Error {}

/** Argumen IPC divalidasi sebagai tuple (argumen berlebih ditolak); pesan tidak memuat nilai. */
export function parseArgs<T extends z.ZodType>(schema: T, args: unknown[]): z.infer<T> {
  const result = schema.safeParse(args);
  if (!result.success) {
    const where = result.error.issues[0]?.path.filter((p) => typeof p === 'string').join('.');
    throw new IpcError(`Argumen tidak valid${where ? `: ${where}` : ''}`);
  }
  return result.data;
}

export type BridgeArgKey = keyof typeof BRIDGE_ARGS;

const MAX_PROGRESS_CHARS = 500;

/** Buang escape terminal dulu, baru samarkan sandi (ANSI di tengah sandi tak boleh lolos). */
export function sanitizeProgress(text: string, secrets: readonly string[]): string {
  const clean = maskSecrets(stripTerminalControl(text), secrets);
  return clean.length > MAX_PROGRESS_CHARS ? `${clean.slice(0, MAX_PROGRESS_CHARS)}...` : clean;
}
