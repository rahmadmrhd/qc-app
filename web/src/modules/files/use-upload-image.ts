import { runBusy } from '@/app/pwa/busy';
import { prepareImage } from './image';
import { useUploadFile } from './queries';

/** Mengembalikan fungsi yang mengecilkan, mengunggah, lalu memberi id berkas. */
export function useUploadImage(): (file: File) => Promise<string> {
  const upload = useUploadFile();
  // Pengecilan gambar (sebelum permintaan unggah) juga penulisan yang sedang berjalan: muat ulang otomatis PWA tak boleh memotongnya.
  return (file) =>
    runBusy(async () => {
      const prepared = await prepareImage(file);
      const saved = await upload.mutateAsync(prepared);
      return saved.id;
    });
}
