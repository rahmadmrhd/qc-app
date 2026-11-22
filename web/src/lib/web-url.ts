/**
 * Hanya URL http(s) yang dijadikan tautan (`href`). Server memvalidasi saat simpan, tetapi data lama atau jalur lain
 * dapat menyimpan skema berbahaya (`javascript:`); ini pengaman tampilan.
 */
export const isWebUrl = (value: string): boolean => /^https?:\/\//i.test(value);
