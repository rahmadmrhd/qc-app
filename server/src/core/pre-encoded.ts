/**
 * JSON yang sudah berbentuk teks (disusun SQLite atau perangkaian string): dikirim apa adanya, tanpa
 * `JSON.parse` lalu `JSON.stringify` ulang di Worker (CPU edge). `toJSON` menjaga pemakai generik (tes,
 * `JSON.stringify` biasa) tetap menerima nilai yang sama.
 */
export class PreEncodedJson {
  constructor(readonly text: string) {}

  toJSON(): unknown {
    return JSON.parse(this.text);
  }
}
