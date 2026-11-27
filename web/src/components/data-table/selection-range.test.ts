import { describe, expect, it } from 'vitest';
import { rangeBetween } from './selection-range';

const ids = ['a', 'b', 'c', 'd'];

describe('rangeBetween', () => {
  it('maju', () => {
    expect(rangeBetween(ids, 'a', 'c')).toEqual(['a', 'b', 'c']);
  });
  it('mundur', () => {
    expect(rangeBetween(ids, 'c', 'a')).toEqual(['a', 'b', 'c']);
  });
  it('satu baris', () => {
    expect(rangeBetween(ids, 'a', 'a')).toEqual(['a']);
  });
  it('id tidak ada', () => {
    expect(rangeBetween(ids, 'x', 'c')).toEqual([]);
    expect(rangeBetween(ids, 'a', 'x')).toEqual([]);
  });
});
