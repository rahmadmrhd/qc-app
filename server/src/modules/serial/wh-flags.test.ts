import { describe, expect, test } from 'bun:test';
import { needsProofSql, whRecordedSql } from './wh-flags';

describe('fragmen SQL Keluar Gudang', () => {
  test('memakai alias serial pemanggil dan hanya pengeluaran selesai', () => {
    const sql = whRecordedSql('x');
    expect(sql).toContain('wr_s.serial_id = x.id');
    expect(sql).toContain("wr_d.status = 'done'");
  });

  test('needsProof: hanya serial WH, item wajib foto hidup, foto draft dan gagal tak dihitung', () => {
    const sql = needsProofSql('x');
    expect(sql).toContain('x.wh_created = 1');
    expect(sql).toContain("np_i.deleted_at = ''");
    expect(sql).toContain("NOT IN ('draft', 'failed')");
    expect(sql).toContain('GREATEST(np_i.proof_min, 1)');
  });
});
