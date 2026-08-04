/**
 * Tests des critères d'acceptation US-AUTH-01 et US-AUTH-04
 * (docs/PRODUCT_BRIEF.md §7.1).
 */
import { describe, expect, it } from 'vitest';
import {
  INVITATION_CODE_PATTERN,
  PASSWORD_MIN_LENGTH,
  acceptInvitationSchema,
  emailSchema,
  passwordSchema,
  signInSchema,
  studentOnboardingSchema,
  studentSignUpSchema,
} from './auth';

describe('US-AUTH-01 CA1 : les trois champs sont obligatoires', () => {
  it('accepte une inscription complète', () => {
    const result = studentSignUpSchema.safeParse({
      firstName: 'Anderson',
      email: 'anderson@example.ci',
      password: 'fractions2026',
    });
    expect(result.success).toBe(true);
  });

  it.each(['firstName', 'email', 'password'])('rejette une inscription sans %s', (missing) => {
    const input: Record<string, unknown> = {
      firstName: 'Anderson',
      email: 'anderson@example.ci',
      password: 'fractions2026',
    };
    delete input[missing];
    expect(studentSignUpSchema.safeParse(input).success).toBe(false);
  });

  it('ne demande NI nom de famille, NI téléphone, NI date de naissance', () => {
    // UX_FLOWS.md §3 : chaque champ retiré = plus d'inscrits.
    // SECURITY.md §4.8 : minimisation des données de mineurs.
    const shape = Object.keys(studentSignUpSchema.shape);
    expect(shape.sort()).toEqual(['email', 'firstName', 'password']);
  });
});

describe('US-AUTH-01 CA2 : mot de passe d’au moins 10 caractères', () => {
  it(`rejette un mot de passe de ${PASSWORD_MIN_LENGTH - 1} caractères`, () => {
    expect(passwordSchema.safeParse('a'.repeat(PASSWORD_MIN_LENGTH - 1)).success).toBe(false);
  });

  it(`accepte exactement ${PASSWORD_MIN_LENGTH} caractères`, () => {
    expect(passwordSchema.safeParse('abcdefghij').success).toBe(true);
  });

  it('rejette un mot de passe démesuré — déni de service sur le hachage', () => {
    expect(passwordSchema.safeParse('a'.repeat(5000)).success).toBe(false);
  });

  it('rejette les mots de passe notoirement courants', () => {
    for (const weak of ['motdepasse', 'azertyuiop', 'MotDePasse123']) {
      expect(passwordSchema.safeParse(weak).success).toBe(false);
    }
  });

  it('n’impose AUCUNE règle de complexité arbitraire', () => {
    // Une phrase longue en minuscules est un bon mot de passe. Exiger
    // majuscule + chiffre + symbole produit « Password1! » chez tout le monde.
    expect(passwordSchema.safeParse('les fractions me fatiguent').success).toBe(true);
  });
});

describe('e-mail — normalisation et unicité insensible à la casse', () => {
  it('met l’adresse en minuscules', () => {
    const result = emailSchema.safeParse('  ANDERSON@Example.CI  ');
    expect(result.success && result.data).toBe('anderson@example.ci');
  });

  it('rejette une adresse malformée', () => {
    for (const bad of ['pas-un-email', 'a@', '@b.ci', '']) {
      expect(emailSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('rejette une adresse démesurée', () => {
    expect(emailSchema.safeParse(`${'a'.repeat(250)}@example.ci`).success).toBe(false);
  });
});

describe('connexion', () => {
  it('n’applique PAS la règle de longueur au mot de passe de connexion', () => {
    // Un compte ancien peut avoir un mot de passe plus court : le refuser à
    // la connexion enfermerait l'utilisateur dehors. C'est la vérification
    // du hash qui tranche, pas le schéma.
    expect(signInSchema.safeParse({ email: 'a@b.ci', password: 'court' }).success).toBe(true);
  });

  it('exige tout de même un mot de passe non vide', () => {
    expect(signInSchema.safeParse({ email: 'a@b.ci', password: '' }).success).toBe(false);
  });
});

describe('onboarding élève', () => {
  const valid = {
    gradeLevel: '2nde_C' as const,
    currentAverage: 9.57,
    targetAverage: 12,
    dailyMinutes: 60 as const,
    daysPerWeek: 5,
  };

  it('accepte le profil d’Anderson', () => {
    expect(studentOnboardingSchema.safeParse(valid).success).toBe(true);
  });

  it('rejette un objectif inférieur à la moyenne actuelle', () => {
    const result = studentOnboardingSchema.safeParse({ ...valid, targetAverage: 8 });
    expect(result.success).toBe(false);
  });

  it('accepte un profil sans moyenne actuelle déclarée', () => {
    const { currentAverage: _omitted, ...withoutAverage } = valid;
    expect(studentOnboardingSchema.safeParse(withoutAverage).success).toBe(true);
  });

  it('rejette une moyenne hors de l’échelle sur 20', () => {
    expect(studentOnboardingSchema.safeParse({ ...valid, targetAverage: 25 }).success).toBe(false);
  });

  it('rejette une fréquence hors de [1, 7]', () => {
    expect(studentOnboardingSchema.safeParse({ ...valid, daysPerWeek: 8 }).success).toBe(false);
    expect(studentOnboardingSchema.safeParse({ ...valid, daysPerWeek: 0 }).success).toBe(false);
  });

  it('n’accepte que les durées proposées à l’écran', () => {
    expect(studentOnboardingSchema.safeParse({ ...valid, dailyMinutes: 37 }).success).toBe(false);
  });

  it('n’accepte que la Seconde C — périmètre MVP', () => {
    expect(studentOnboardingSchema.safeParse({ ...valid, gradeLevel: '1ere_C' }).success).toBe(
      false,
    );
  });
});

describe('US-AUTH-04 : code d’invitation parent', () => {
  it('accepte un code au bon format', () => {
    expect(acceptInvitationSchema.safeParse({ code: 'SAVOIR-4K7P' }).success).toBe(true);
  });

  it('accepte un code saisi en minuscules', () => {
    const result = acceptInvitationSchema.safeParse({ code: 'savoir-4k7p' });
    expect(result.success && result.data.code).toBe('SAVOIR-4K7P');
  });

  it('exclut les caractères ambigus de l’alphabet', () => {
    // Ni O/0, ni I/1, ni L : un parent recopie ce code depuis un SMS.
    for (const ambiguous of ['SAVOIR-O0IL', 'SAVOIR-1234']) {
      expect(INVITATION_CODE_PATTERN.test(ambiguous)).toBe(false);
    }
  });

  it('rejette un code de mauvaise longueur ou sans préfixe', () => {
    for (const bad of ['SAVOIR-4K7', 'SAVOIR-4K7PQ', '4K7P', 'AUTRE-4K7P']) {
      expect(acceptInvitationSchema.safeParse({ code: bad }).success).toBe(false);
    }
  });
});
