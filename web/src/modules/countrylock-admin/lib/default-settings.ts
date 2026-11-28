import type { ClSettings } from '@shared/countrylock-bundle';

/**
 * Pengaturan bawaan bila `settings.json` belum ada di draf: IP router jump dan komputer satu segmen /24, kredensial
 * bawaan tiap merk. Admin wajib menyesuaikannya dengan jaringan sebenarnya sebelum menerbitkan bundel.
 */
export function defaultSettings(): ClSettings {
  const mode = {
    ip: '',
    ipServer: '192.168.88.2',
    connectVia: 'Target' as const,
    interfaceBridge: 'bridge1',
  };
  return {
    schema: 1,
    router: { ip: '192.168.88.2', username: 'admin', password: '', interfaceBridge: 'bridge1' },
    network: { computerIp: '192.168.88.3', prefixLength: 24 },
    brands: {
      mikrotik: {
        label: 'Mikrotik',
        username: 'admin',
        password: '',
        web: 'http://{ip}/',
        modes: { single: { ...mode }, multi: { ...mode } },
      },
      ubiquiti: {
        label: 'Ubiquiti',
        username: 'ubnt',
        password: 'ubnt',
        web: 'https://{ip}/',
        modes: { single: { ...mode }, multi: { ...mode } },
      },
    },
  };
}
