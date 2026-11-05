interface StoredObject {
  body: string;
  customMetadata: Record<string, string>;
}

/** R2 palsu di memori (hanya permukaan yang dipakai cache berkas) dengan penghitung dan injeksi galat. */
export class FakeR2 {
  objects = new Map<string, StoredObject>();
  gets = 0;
  puts = 0;
  deletes = 0;
  /** Bila true, semua operasi melempar (R2 sedang galat). */
  failing = false;

  private check(): void {
    if (this.failing) throw new Error('R2 galat (palsu)');
  }

  async get(key: string) {
    this.gets++;
    this.check();
    const object = this.objects.get(key);
    if (!object) return null;
    return { customMetadata: object.customMetadata, text: async () => object.body };
  }

  async put(key: string, body: string, options?: { customMetadata?: Record<string, string> }) {
    this.puts++;
    this.check();
    this.objects.set(key, { body, customMetadata: options?.customMetadata ?? {} });
  }

  async delete(key: string) {
    this.deletes++;
    this.check();
    this.objects.delete(key);
  }

  /** Untuk `env.FILES_CACHE`. */
  asBucket(): R2Bucket {
    return this as unknown as R2Bucket;
  }
}
