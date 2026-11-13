import { GUIDE_LIMITS } from '@shared/stickers';
import { fitWithin } from './image';

export interface ThumbnailPlan {
  side: number;
  mime: 'image/webp' | 'image/jpeg';
  quality: number;
}

const SIDES = [GUIDE_LIMITS.thumbSide, 240, 160] as const;
const FORMATS = ['image/webp', 'image/jpeg'] as const;
const QUALITIES = [0.8, 0.6, 0.4] as const;

/** Urutan percobaan: sisi (320, 240, 160) x format (WebP, JPEG) x kualitas (0,8; 0,6; 0,4). */
export function thumbnailPlans(): ThumbnailPlan[] {
  const plans: ThumbnailPlan[] = [];
  for (const side of SIDES) {
    for (const mime of FORMATS) {
      for (const quality of QUALITIES) plans.push({ side, mime, quality });
    }
  }
  return plans;
}

/**
 * Mencoba tiap rencana sampai ada blob <= `thumbTargetBytes` yang tipenya sama dengan rencana (peramban yang
 * jatuh balik ke PNG dilewati). Murni terhadap `encode`, jadi dapat dites tanpa canvas.
 */
export async function pickThumbnail(
  plans: readonly ThumbnailPlan[],
  encode: (plan: ThumbnailPlan) => Promise<Blob | null>,
): Promise<{ mime: string; bytes: Uint8Array }> {
  for (const plan of plans) {
    const blob = await encode(plan);
    if (!blob || blob.type !== plan.mime) continue;
    if (blob.size > GUIDE_LIMITS.thumbTargetBytes) continue;
    return { mime: plan.mime, bytes: new Uint8Array(await blob.arrayBuffer()) };
  }
  throw new Error('Thumbnail gagal dibuat');
}

function canvasToBlob(canvas: HTMLCanvasElement, plan: ThumbnailPlan): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, plan.mime, plan.quality));
}

/**
 * Buat thumbnail (sisi terpanjang <= 320 px, <= 30 KB) dari bitmap, Blob, atau File. Bergantung pada canvas
 * peramban (jsdom tidak punya), jadi bagian canvas ini hanya diverifikasi manual di peramban; logika pemilihan
 * rencana ada di `thumbnailPlans`/`pickThumbnail` yang dites. Bitmap dari pemanggil tidak ditutup di sini.
 */
export async function prepareThumbnail(
  source: ImageBitmap | Blob | File,
): Promise<{ mime: string; bytes: Uint8Array }> {
  const ownsBitmap = !('close' in source);
  const bitmap = 'close' in source ? source : await createImageBitmap(source);
  try {
    // Satu canvas per sisi: dipakai ulang oleh semua format dan kualitas pada sisi yang sama.
    let current: { side: number; canvas: HTMLCanvasElement } | null = null;
    return await pickThumbnail(thumbnailPlans(), async (plan) => {
      if (current?.side !== plan.side) {
        const { width, height } = fitWithin(bitmap.width, bitmap.height, plan.side);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Peramban tidak mendukung pengolahan gambar');
        context.drawImage(bitmap, 0, 0, width, height);
        current = { side: plan.side, canvas };
      }
      return canvasToBlob(current.canvas, plan);
    });
  } finally {
    if (ownsBitmap) bitmap.close();
  }
}
