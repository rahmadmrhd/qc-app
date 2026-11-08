import type { HandoverDto } from '@shared/contract';

/** Fixture DTO task untuk tes komponen (bukan berkas tes). */
export function makeHandover(over: Partial<HandoverDto> = {}): HandoverDto {
  return {
    id: 'h1',
    number: 'ST-20261015-001',
    locationId: 'loc-a',
    customerId: 'c1',
    customerName: 'PT Maju',
    note: '- [ ] A = 1\n- [ ] B = 2',
    status: 'new',
    checklist: [
      { index: 0, text: 'A = 1', checked: false, by: '', at: '' },
      { index: 1, text: 'B = 2', checked: false, by: '', at: '' },
    ],
    comments: [],
    completedAt: '',
    completedBy: '',
    createdAt: '2026-10-15T01:00:00.000Z',
    createdBy: 'wh@qc.local',
    updatedAt: '2026-10-15T01:00:00.000Z',
    updatedBy: 'wh@qc.local',
    ...over,
  };
}
