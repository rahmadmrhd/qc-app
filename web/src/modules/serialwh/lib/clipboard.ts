// Penulisan clipboard Keluar Gudang.

/**
 * Menulis teks (atau janji teks) ke clipboard. Dipanggil langsung dari gestur klik; janji dipakai agar teks boleh
 * disusun setelah kiriman ke server selesai tanpa kehilangan izin gestur. `false` = gagal: tampilkan
 * `ClipboardResultDialog` agar pengguna menyalin manual.
 */
export async function copyLines(text: string | Promise<string>): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      const blob =
        typeof text === 'string'
          ? new Blob([text], { type: 'text/plain' })
          : text.then((value) => new Blob([value], { type: 'text/plain' }));
      // Penolakan janji (kiriman gagal) ditangani oleh `write` di bawah; ini hanya mencegah "unhandled rejection".
      if (typeof blob !== 'string') void Promise.resolve(blob).catch(() => undefined);
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
      return true;
    }
    const value = await text;
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
