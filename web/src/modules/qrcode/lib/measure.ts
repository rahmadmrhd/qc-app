import type { Measure } from '@shared/qrcode';
import { PT_PER_MM } from '@shared/qrcode';
import { LABEL_FONT_FAMILY } from './fonts';

/** Dipakai sebelum font siap dan di tes (jsdom tanpa canvas): lebar ~0,55 em per karakter. */
export const fallbackMeasure: Measure = (text, sizePt) => (text.length * sizePt * 0.55) / PT_PER_MM;

/** Pengukur memakai font label di canvas: ukur pada 100 px lalu skala linear ke ukuran yang diminta. */
export function createCanvasMeasure(): Measure {
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return fallbackMeasure;
  return (text, sizePt, bold) => {
    context.font = `${bold ? 600 : 400} 100px ${LABEL_FONT_FAMILY}, sans-serif`;
    return (context.measureText(text).width / 100) * (sizePt / PT_PER_MM);
  };
}
