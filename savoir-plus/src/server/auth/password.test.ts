import { describe, expect, it } from 'vitest';
import { assertPasswordPolicy, normalizeEmail } from './password';

describe('password policy', () => {
  it('normalizes email deterministically', () => {
    expect(normalizeEmail('  Anderson@Example.COM ')).toBe('anderson@example.com');
  });

  it('accepts a strong password', () => {
    expect(() => assertPasswordPolicy('SavoirPlus2026!')).not.toThrow();
  });

  it('rejects a password shorter than 12 characters', () => {
    expect(() => assertPasswordPolicy('Court1A')).toThrow('PASSWORD_TOO_SHORT');
  });

  it('rejects a password without required character classes', () => {
    expect(() => assertPasswordPolicy('uniquementlettres')).toThrow(
      'PASSWORD_COMPLEXITY_NOT_MET',
    );
  });

  it('rejects an excessively long password', () => {
    expect(() => assertPasswordPolicy(`Aa1${'x'.repeat(126)}`)).toThrow('PASSWORD_TOO_LONG');
  });
});
