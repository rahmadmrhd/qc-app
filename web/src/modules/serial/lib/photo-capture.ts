/** Kualitas JPEG bingkai kamera; dikecilkan lagi oleh `prepareImage` sebelum diunggah. */
const JPEG_QUALITY = 0.9;

/**
 * Mengambil bingkai video saat ini sebagai berkas JPEG pada resolusi video. Menolak (Error berpesan Indonesia) bila
 * video belum siap atau gambar gagal dienkode, supaya pemanggil dapat menampilkan pesan dan tidak macet.
 */
export async function captureFrame(video: HTMLVideoElement, name: string): Promise<File> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (video.readyState < 2 || !width || !height) {
    throw new Error('Kamera belum siap, tunggu sebentar lalu coba lagi');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Peramban tidak mendukung pengolahan gambar');
  // Hanya bingkai video: pratinjau cap adalah overlay HTML dan tidak pernah digambar ke kanvas ini.
  context.drawImage(video, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
  );
  if (!blob || blob.size === 0) throw new Error('Gagal mengambil gambar dari kamera, coba lagi');
  return new File([blob], name, { type: 'image/jpeg' });
}
