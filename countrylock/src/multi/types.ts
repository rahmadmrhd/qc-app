// Tipe bersama mesin Multi-Device (spek 2026-11-19). Murni: tanpa API Node/DOM, dipakai proses utama dan diuji `bun:test`.

export type DeviceStatus =
  | 'waiting'
  | 'pinging'
  | 'fetching_info'
  | 'ready'
  | 'queued'
  | 'injecting'
  | 'success'
  | 'failed'
  | 'disconnected';

export interface Credential {
  username: string;
  password: string;
}

/** Satu baris DHCP lease: IP dan MAC (sudah dinormalisasi `AA:BB:CC:DD:EE:FF`). */
export interface Lease {
  ip: string;
  mac: string;
}

/** Tipe, BU, dan Lokasi batch (satu per sesi Multi); dibubuhkan pada tiap peristiwa `injected`. */
export interface MultiTarget {
  itemId: string;
  itemLabel: string;
  buId: string;
  buLabel: string;
  locationId: string;
  locationLabel: string;
}

/** Peristiwa inject sukses; bertahan di proses utama sampai di-ack renderer. */
export interface InjectedEvent {
  eventId: string;
  mac: string;
  serial: string;
  model: string;
  /** Cap waktu engine (ISO); tanggal uji WIB dihitung darinya. */
  injectedAt: string;
  target: MultiTarget;
}
