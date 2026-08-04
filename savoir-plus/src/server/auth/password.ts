import { hash, verify, argon2id } from 'argon2';

const ARGON2_MEMORY_COST_KIB = 65_536;
const ARGON2_TIME_COST = 3;
const ARGON2_PARALLELISM = 1;

export function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase('en-US');
}

export function assertPasswordPolicy(password: string): void {
  if (password.length < 12) {
    throw new Error('PASSWORD_TOO_SHORT');
  }
  if (password.length > 128) {
    throw new Error('PASSWORD_TOO_LONG');
  }
  if (!/[a-z]/u.test(password) || !/[A-Z]/u.test(password) || !/[0-9]/u.test(password)) {
    throw new Error('PASSWORD_COMPLEXITY_NOT_MET');
  }
}

export async function hashPassword(password: string): Promise<string> {
  assertPasswordPolicy(password);
  return hash(password, {
    type: argon2id,
    memoryCost: ARGON2_MEMORY_COST_KIB,
    timeCost: ARGON2_TIME_COST,
    parallelism: ARGON2_PARALLELISM,
  });
}

export async function verifyPassword(passwordHash: string, candidate: string): Promise<boolean> {
  if (!candidate || candidate.length > 128) {
    return false;
  }
  try {
    return await verify(passwordHash, candidate, { type: argon2id });
  } catch {
    return false;
  }
}
