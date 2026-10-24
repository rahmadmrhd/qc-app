/**
 * Merapikan keluaran serializer editor: baris kosong beruntun diringkas jadi satu (di luar blok kode berpagar)
 * dan baris kosong di ujung dibuang. Isi blok kode tidak diubah.
 */
export function normalizeMarkdown(markdown: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of markdown.split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1] ?? null;
    if (fence === null && marker) fence = marker;
    else if (fence !== null && marker && marker[0] === fence[0] && marker.length >= fence.length) {
      fence = null;
    }
    const blank = fence === null && line.trim() === '';
    if (blank && (out.length === 0 || out[out.length - 1] === '')) continue;
    out.push(blank ? '' : line);
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}
