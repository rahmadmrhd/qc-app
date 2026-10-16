/** Nama konfigurasi untuk pesan ke pengguna: "title — subtitle", atau title saja bila subtitle kosong. */
export function designLabel(design: { title: string; subtitle: string }): string {
  const subtitle = design.subtitle.trim();
  return subtitle === '' ? design.title : `${design.title} — ${subtitle}`;
}
