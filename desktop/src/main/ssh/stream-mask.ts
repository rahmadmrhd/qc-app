// Penyamaran rahasia pada aliran keluaran perangkat yang datang dalam potongan acak.
//
// Tiga sifat yang dijaga (temuan B1/N1-N3):
// 1. Rahasia yang terbelah antar potongan data dan/atau oleh `\r`/`\n` sisipan perangkat
//    (pembungkusan baris) tetap tersamarkan: baris yang berakhir pada awalan sebuah rahasia
//    ditahan sampai potongan berikutnya menentukan apakah itu rahasia utuh.
// 2. Penyamaran tidak pernah dijalankan ulang pada hasil penyamaran: bagian yang sudah tersamar
//    diganti penanda internal satu karakter (MARK) yang tidak cocok dengan rahasia mana pun,
//    sehingga buffer tidak tumbuh walau rahasia hanya berisi `*`; `****` baru ditulis saat baris
//    dipancarkan.
// 3. Token penanda (`__QC_INJECT_<hex>__`) tidak pernah dirusak oleh penyamaran (sandi pendek
//    seperti `a` atau `1` akan memotongnya), supaya saringan penanda tetap mengenalinya.

const MARK = '';
const TOKEN_SOURCE = '__QC_INJECT_[0-9a-f]{8}__';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class StreamMasker {
  private pending = '';
  private readonly secrets: string[];
  private readonly pattern: RegExp | null;
  private readonly maxLength: number;

  constructor(secrets: readonly string[]) {
    // Terpanjang dulu: pada awal yang sama, alternatif yang lebih panjang dicoba lebih dulu.
    this.secrets = [...new Set(secrets.filter((s) => s.length > 0))].sort(
      (a, b) => b.length - a.length,
    );
    this.maxLength = this.secrets[0]?.length ?? 0;
    // Token dicocokkan lebih dulu sebagai satu kesatuan (dibiarkan apa adanya); rahasia boleh
    // diselingi `\r`/`\n` sisipan perangkat.
    this.pattern =
      this.secrets.length === 0
        ? null
        : new RegExp(
            `(${TOKEN_SOURCE})|${this.secrets
              .map((s) => `(?:${[...s].map(escapeRegExp).join('[\\r\\n]*')})`)
              .join('|')}`,
            'g',
          );
  }

  private mask(text: string): string {
    if (!this.pattern) return text;
    return text.replace(this.pattern, (match, token: string | undefined) =>
      token === undefined ? MARK : match,
    );
  }

  /** Menerima potongan baru; mengembalikan baris LENGKAP yang aman dipancarkan (sudah tersamar). */
  push(text: string): string[] {
    this.pending = this.mask(this.pending + text);
    return this.take(false);
  }

  /** Mengosongkan baris lengkap yang masih ditahan (akhir sesi). Sisa baris parsial dibuang. */
  flush(): string[] {
    this.pending = this.mask(this.pending);
    return this.take(true);
  }

  private take(final: boolean): string[] {
    const lastBreak = Math.max(this.pending.lastIndexOf('\n'), this.pending.lastIndexOf('\r'));
    if (lastBreak === -1) return [];
    let cut = lastBreak + 1;
    if (!final) cut = Math.min(cut, this.holdCut(cut));
    const head = this.pending.slice(0, cut);
    this.pending = this.pending.slice(cut);
    return head
      .split(/[\r\n]/)
      .filter((line) => line !== '')
      .map((line) => line.replaceAll(MARK, '****'));
  }

  /**
   * Titik potong yang tidak memotong rahasia di tengah: bila teks (tanpa pemisah baris) sebelum
   * `cut` berakhir pada awalan sebuah rahasia, tahan mulai awal baris tempat awalan itu dimulai.
   */
  private holdCut(cut: number): number {
    if (this.maxLength < 2) return cut;
    // Kumpulkan sampai maxLength karakter bukan-pemisah dari belakang, beserta posisinya.
    const positions: number[] = [];
    let probe = '';
    for (let i = cut - 1; i >= 0 && positions.length < this.maxLength; i -= 1) {
      const ch = this.pending.charAt(i);
      if (ch === '\r' || ch === '\n') continue;
      positions.push(i);
      probe = ch + probe;
    }
    let earliest = cut;
    for (const secret of this.secrets) {
      for (let k = Math.min(secret.length - 1, probe.length); k >= 1; k -= 1) {
        if (probe.endsWith(secret.slice(0, k))) {
          const start = positions[k - 1] as number;
          if (start < earliest) earliest = start;
          break;
        }
      }
    }
    if (earliest === cut) return cut;
    const lineStart = Math.max(
      this.pending.lastIndexOf('\n', earliest - 1),
      this.pending.lastIndexOf('\r', earliest - 1),
    );
    return lineStart + 1;
  }
}
