import { type Point, scanCropRect } from './scan-region';

export interface ScanCapture {
  /** Sumber untuk pembaca: potongan area scan (kanvas yang dipakai ulang) atau seluruh video bila ukuran belum diketahui. */
  source: HTMLCanvasElement | HTMLVideoElement;
  /** Pusat area baca pada sumber itu (piksel); `null` bila seluruh video dibaca. */
  center: Point | null;
}

/**
 * Pengambil potongan area scan: satu kanvas dibuat sekali dan dipakai ulang tiap bingkai (ukurannya hanya diubah bila
 * persegi potong berubah, karena mengubah ukuran kanvas mengosongkan dan mengalokasikan ulang). Hanya piksel di dalam
 * bingkai (setelah `object-fit: cover`) yang digambar ke kanvas dan sampai ke pembaca. Tanpa konteks 2D atau tanpa ukuran
 * valid (video belum punya dimensi, kotak belum tampak) pembaca menerima seluruh video seperti sebelumnya.
 */
export function createScanCapturer(): (video: HTMLVideoElement) => ScanCapture {
  const canvas = document.createElement('canvas');
  let context: CanvasRenderingContext2D | null | undefined;
  return (video) => {
    const rect = scanCropRect(
      { width: video.videoWidth, height: video.videoHeight },
      { width: video.clientWidth, height: video.clientHeight },
    );
    if (rect === null) return { source: video, center: null };
    if (context === undefined) context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) return { source: video, center: null };
    if (canvas.width !== rect.width) canvas.width = rect.width;
    if (canvas.height !== rect.height) canvas.height = rect.height;
    context.drawImage(
      video,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      0,
      0,
      rect.width,
      rect.height,
    );
    return { source: canvas, center: { x: rect.width / 2, y: rect.height / 2 } };
  };
}
