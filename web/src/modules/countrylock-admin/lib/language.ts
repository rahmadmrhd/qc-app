/** Bahasa penyorot sintaks editor kode admin Country Lock. */
export type CodeLanguage = 'rsc' | 'sh' | 'json' | 'text';

/**
 * Bahasa menurut nama jalur berkas: `.json` JSON, `.sh` shell, `.rsc`/`.txt` skrip RouterOS (skrip Mikrotik dan
 * Ubiquiti lama berekstensi `.txt`), selain itu teks biasa.
 */
export function languageOf(path: string): CodeLanguage {
  const dot = path.lastIndexOf('.');
  const extension = dot >= 0 ? path.slice(dot + 1).toLowerCase() : '';
  if (extension === 'json') return 'json';
  if (extension === 'sh') return 'sh';
  if (extension === 'rsc' || extension === 'txt') return 'rsc';
  return 'text';
}
