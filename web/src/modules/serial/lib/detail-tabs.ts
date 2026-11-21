/** Tab View Serial: identitas dan tahap, riwayat (aksi + linimasa), foto bukti QC. Dipisah agar rute dapat mengimpornya tanpa menarik halaman. */
export const SERIAL_TABS = ['detail', 'riwayat', 'foto'] as const;
export type SerialTab = (typeof SERIAL_TABS)[number];
