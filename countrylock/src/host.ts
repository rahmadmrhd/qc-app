// Validasi alamat host perangkat/router: IPv4 titik-desimal atau nama host DNS biasa. Dipakai
// sebelum host mana pun diteruskan ke proses/soket (mencegah injeksi argumen `ping.exe`).

const IPV4 = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

export function isValidHost(host: string): boolean {
  if (host.length === 0 || host.length > 253) return false;
  if (IPV4.test(host)) return true;
  // Bentuk angka-titik yang bukan IPv4 sah (mis. 999.1.1.1) bukan nama host.
  if (/^[\d.]+$/.test(host)) return false;
  return host.split('.').every((label) => LABEL.test(label));
}
