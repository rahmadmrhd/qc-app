import { normalizeKey } from '@shared/items';

/**
 * `|kunci1|kunci2|` dari nama lain item (kosong bila tanpa nama lain). HARUS sama dengan `aliasKeysOf` di
 * `server/src/modules/item/repo.ts` (migrasi 0007); tes memeriksa kesamaannya.
 */
export function aliasKeysOf(aliases: readonly string[]): string {
  const keys = [
    ...new Set(aliases.map((alias) => normalizeKey(alias)).filter((key) => key !== '')),
  ];
  return keys.length === 0 ? '' : `|${keys.join('|')}|`;
}

/** Kunci nama lain dari bentuk tersimpan `|kunci1|kunci2|` (kebalikan `aliasKeysOf`). */
export function splitAliasKeys(aliasKeys: string): string[] {
  return aliasKeys.split('|').filter((key) => key !== '');
}
