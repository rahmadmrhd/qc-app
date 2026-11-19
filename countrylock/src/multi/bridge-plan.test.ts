import { describe, expect, test } from 'bun:test';
import type { ServerConfig } from '../config';
import { buildBridgePlan, describeBridgePlan } from './bridge-plan';

const server = (patch: Partial<ServerConfig> = {}): ServerConfig => ({
  ip: '192.168.88.1',
  username: 'admin',
  password: 'x',
  interfaceComp: 'ether5',
  interfaceList: ['ether1', 'ether2', 'ether5', 'ether2', ' ether3 '],
  interfaceBridge: 'bridge1',
  ...patch,
});

describe('buildBridgePlan', () => {
  test('interface bersih (tanpa interfaceComp dan duplikat); perintah mengikuti daftar itu; host = server.ip', () => {
    const plan = buildBridgePlan(server(), 'BridgeAll');
    expect(plan.host).toBe('192.168.88.1');
    expect(plan.interfaces).toEqual(['ether1', 'ether2', 'ether3']);
    expect(plan.steps.map((s) => s.command)).toEqual([
      '/interface bridge port remove [find interface!=ether5]',
      '/interface bridge port add bridge=BridgeAll interface=ether1',
      '/interface bridge port add bridge=BridgeAll interface=ether2',
      '/interface bridge port add bridge=BridgeAll interface=ether3',
    ]);
    expect(plan.valid).toBe(true);
  });

  test('nama tak aman menandai rencana tidak valid', () => {
    expect(buildBridgePlan(server({ interfaceList: ['ether1; /system reset'] }), 'b').valid).toBe(
      false,
    );
    expect(buildBridgePlan(server(), 'br idge').valid).toBe(false);
  });
});

describe('describeBridgePlan', () => {
  test('memuat host SSH, semua perintah, dan jujur bahwa penghapusan mencakup semua bridge', () => {
    const plan = buildBridgePlan(server({ ip: '10.9.8.7' }), 'BridgeAll');
    const text = describeBridgePlan(plan);
    expect(text).toContain('10.9.8.7');
    for (const step of plan.steps) expect(text).toContain(step.command);
    expect(text).toContain('SEMUA bridge');
    expect(text).toContain('ether1, ether2, ether3');
    expect(text).not.toContain('ether5, ');
  });
});
