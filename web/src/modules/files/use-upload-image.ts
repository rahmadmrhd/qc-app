import { prepareImage } from './image';
import { useUploadFile } from './queries';

/** Mengembalikan fungsi yang mengecilkan, mengunggah, lalu memberi id berkas. */
export function useUploadImage(): (file: File) => Promise<string> {
  const upload = useUploadFile();
  return async (file) => {
    const prepared = await prepareImage(file);
    const saved = await upload.mutateAsync(prepared);
    return saved.id;
  };
}
