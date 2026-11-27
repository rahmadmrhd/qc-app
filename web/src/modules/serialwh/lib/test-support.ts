import type { MeDto, WarehouseSerialDto } from '@shared/contract';
import { makeMe } from '@/test/make-me';
import type { WarehouseItemWithBox } from './ready-box';

/** Serial gudang contoh untuk tes (lolos, QC, belum pernah keluar). */
export function whSerial(overrides: Partial<WarehouseSerialDto> = {}): WarehouseSerialDto {
  return {
    id: 'ser1',
    serial: 'SN1',
    itemId: 'item1',
    itemLabel: 'Tenda AX300',
    buId: 'bu1',
    buCode: 'A',
    locationId: 'loc1',
    locationName: 'Gudang 1',
    testDate: '2026-11-20',
    status: 'good',
    custody: 'qc',
    whCreated: false,
    needsProof: false,
    dispatches: [],
    // Bawaan: tercatat bila ada rujukan; tes dapat menimpa (`recorded: true` tanpa rujukan = BU tak terbaca).
    recorded: (overrides.dispatches?.length ?? 0) > 0,
    ...overrides,
  };
}

export function whItem(overrides: Partial<WarehouseItemWithBox> = {}): WarehouseItemWithBox {
  return {
    id: 'item1',
    label: 'Tenda AX300',
    brandName: 'Tenda',
    model: 'AX300',
    buIds: ['bu1'],
    proofRequired: false,
    proofMin: 0,
    ...overrides,
  };
}

/** Pengguna dengan `serialwh: edit` pada BU yang diminta (bawaan satu BU "bu1"). */
export function whMe(buIds: readonly string[] = ['bu1'], extra: Partial<MeDto> = {}): MeDto {
  const base = makeMe({
    businessUnits: buIds.map((id, index) => ({
      id,
      code: String.fromCharCode(65 + index),
      name: `BU ${index + 1}`,
      status: 'active',
      permissions: {
        item: 'none',
        serial: 'none',
        serialservice: 'none',
        serialwh: 'edit',
      },
    })) as MeDto['businessUnits'],
  });
  return { ...base, email: 'wh@x.com', ...extra };
}
