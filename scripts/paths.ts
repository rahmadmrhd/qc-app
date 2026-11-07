import path from 'node:path';

export const ROOT_DIR = path.resolve(import.meta.dir, '..');
export const SHARED_DIR = path.join(ROOT_DIR, 'shared');
/** Keluaran build web = berkas statis yang dilayani server Bun (STATIC_DIR, bawaan server/dist). */
export const WEB_DIST_DIR = path.join(ROOT_DIR, 'server', 'dist');
