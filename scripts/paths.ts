import path from 'node:path';

export const ROOT_DIR = path.resolve(import.meta.dir, '..');
export const GAS_DIR = path.join(ROOT_DIR, 'gas');
export const GAS_DIST_DIR = path.join(GAS_DIR, 'dist');
export const SHARED_DIR = path.join(ROOT_DIR, 'shared');
