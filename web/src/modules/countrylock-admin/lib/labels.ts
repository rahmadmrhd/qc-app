import type { ClBrand, ClFileRole } from '@shared/countrylock-bundle';

export const ROLE_LABELS: Record<ClFileRole, string> = {
  settings: 'Pengaturan',
  script: 'Skrip',
  router: 'Berkas router',
};

export const BRAND_LABELS: Record<ClBrand, string> = {
  mikrotik: 'Mikrotik',
  ubiquiti: 'Ubiquiti',
};

export const BRAND_OPTIONS: { value: ClBrand; label: string }[] = [
  { value: 'mikrotik', label: BRAND_LABELS.mikrotik },
  { value: 'ubiquiti', label: BRAND_LABELS.ubiquiti },
];
