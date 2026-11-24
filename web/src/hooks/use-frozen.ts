import { useState } from 'react';

/** Nilai PERTAMA yang diterima, tidak berubah walau komponen dirender ulang dengan nilai baru. */
export function useFrozen<T>(value: T): T {
  const [frozen] = useState(value);
  return frozen;
}
