import pkg from '../../package.json';
import type { Env } from './env';

/** Versi dan build server yang dilaporkan `/api/ping` (versi = `server/package.json`, build = SHA commit image). */
export interface BuildInfo {
  version: string;
  build: string;
}

/**
 * `env` boleh `undefined`: tes `app.request()` tanpa Env. Versi dibaca dari `server/package.json` (satu sumber
 * kebenaran, dinaikkan `bun run release:prepare`); build `unknown` bila SHA tak diketahui.
 */
export function buildInfo(env: Pick<Env, 'BUILD_SHA'> | undefined): BuildInfo {
  return { version: pkg.version, build: env?.BUILD_SHA || 'unknown' };
}
