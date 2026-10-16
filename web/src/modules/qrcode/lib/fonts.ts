import regularUrl from '@fontsource/poppins/files/poppins-latin-400-normal.woff?url';
import boldUrl from '@fontsource/poppins/files/poppins-latin-600-normal.woff?url';

export const LABEL_FONT_FAMILY = 'QRLabelPoppins';

export interface LabelFonts {
  regular: ArrayBuffer;
  bold: ArrayBuffer;
}

let cache: Promise<LabelFonts> | null = null;

/** Berkas font ter-inline di bundel (data URL), jadi tidak ada permintaan jaringan. */
export function loadLabelFonts(): Promise<LabelFonts> {
  cache ??= Promise.all([
    fetch(regularUrl).then((response) => response.arrayBuffer()),
    fetch(boldUrl).then((response) => response.arrayBuffer()),
  ])
    .then(([regular, bold]) => ({ regular, bold }))
    .catch((error: unknown) => {
      cache = null;
      throw error;
    });
  return cache;
}

let registered: Promise<void> | null = null;

/** Mendaftarkan font ke canvas (FontFace) agar teks canvas memakai font yang sama dengan PDF. */
export function registerCanvasFonts(): Promise<void> {
  registered ??= loadLabelFonts()
    .then(async (fonts) => {
      const faces = [
        new FontFace(LABEL_FONT_FAMILY, fonts.regular, { weight: '400' }),
        new FontFace(LABEL_FONT_FAMILY, fonts.bold, { weight: '600' }),
      ];
      await Promise.all(faces.map((face) => face.load()));
      for (const face of faces) document.fonts.add(face);
    })
    .catch((error: unknown) => {
      registered = null;
      throw error;
    });
  return registered;
}
