/** Teks alternatif gambar dari nama berkas: tanpa ekstensi dan tanpa karakter yang merusak `![alt](...)`. */
export function altTextFromFileName(name: string): string {
  const dot = name.lastIndexOf('.');
  return altTextFromStem(dot >= 0 ? name.slice(0, dot) : name);
}

/** Teks alternatif dari nama tanpa ekstensi (mis. nama antrean dialog lampiran). */
export function altTextFromStem(stem: string): string {
  const forbidden = `[]()${String.fromCharCode(92)}`;
  const safe = [...stem]
    .filter((ch) => !forbidden.includes(ch))
    .join('')
    .trim();
  return safe === '' ? 'gambar' : safe;
}
