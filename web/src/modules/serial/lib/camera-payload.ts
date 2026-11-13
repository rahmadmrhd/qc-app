import { splitSerialInput } from '@shared/serials';

/**
 * Payload yang sama tidak dikirim ulang selama jendela ini setelah TERAKHIR terlihat (jendela bergeser: label yang
 * terus ditahan di depan kamera tidak terkirim berulang; kirim lagi hanya bila sempat hilang dari pandangan selama
 * jendela ini). Satu konstanta agar mudah diubah.
 */
export const CAMERA_DUPLICATE_WINDOW_MS = 3000;

export interface PayloadGate {
  /**
   * Menyaring satu payload hasil bacaan. Dipecah per baris dengan pemecah yang sama dengan tempel
   * (`splitSerialInput`); serial yang masih dalam jendela dibuang. Mengembalikan teks yang diteruskan ke pemanggil
   * (serial baru satu per baris, ditambah baris yang tak lolos validasi agar pemanggil menolaknya seperti tempel),
   * atau `null` bila tak ada yang baru.
   */
  accept(payload: string): string | null;
}

export function createPayloadGate(
  windowMs: number = CAMERA_DUPLICATE_WINDOW_MS,
  now: () => number = Date.now,
): PayloadGate {
  const lastSeen = new Map<string, number>();

  function fresh(key: string, time: number): boolean {
    const previous = lastSeen.get(key);
    lastSeen.set(key, time);
    return previous === undefined || time - previous >= windowMs;
  }

  return {
    accept(payload) {
      const time = now();
      for (const [key, seen] of lastSeen) {
        if (time - seen >= windowMs) lastSeen.delete(key);
      }
      const split = splitSerialInput(payload);
      const lines = [
        ...split.serials.filter((serial) => fresh(`s:${serial}`, time)),
        ...split.rejected.filter((line) => fresh(`r:${line}`, time)),
      ];
      return lines.length === 0 ? null : lines.join('\n');
    },
  };
}
