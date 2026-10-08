const VALID_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail_(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail_(email: string): boolean {
  return VALID_EMAIL_PATTERN.test(email);
}
