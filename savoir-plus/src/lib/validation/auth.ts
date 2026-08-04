/**
 * Savoir+ — Schémas de validation de l'authentification.
 *
 * SECURITY.md §4.3 : rejet, jamais nettoyage silencieux. Une entrée invalide
 * est refusée ; elle n'est pas « corrigée ».
 *
 * Ces schémas servent le client (retour immédiat) ET le serveur (autorité).
 * La validation côté client est un confort, jamais une protection.
 */
import { z } from 'zod';

/** SECURITY.md §4.1 — 10 caractères minimum. */
export const PASSWORD_MIN_LENGTH = 10;

/**
 * Plafond de longueur. Un mot de passe de 10 Mo est une attaque par déni de
 * service sur la fonction de hachage, pas un utilisateur prudent.
 */
export const PASSWORD_MAX_LENGTH = 200;

/**
 * Mots de passe notoirement compromis, en français et en anglais.
 * Liste volontairement courte et lisible ; une vérification contre une base
 * de fuites (k-anonymat) viendra plus tard.
 *
 * Pas de règle de complexité arbitraire : elle produit `Password1!` chez tout
 * le monde et n'améliore rien (SECURITY.md §4.1).
 */
const COMMON_PASSWORDS = new Set([
  'motdepasse',
  'motdepasse1',
  'azertyuiop',
  'qwertyuiop',
  'password1234',
  '1234567890',
  'motdepasse123',
  'savoirplus',
  'anderson123',
]);

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'L’adresse e-mail est obligatoire.')
  .max(254, 'Adresse e-mail trop longue.')
  .email('Cette adresse e-mail n’est pas valide.')
  // Unicité insensible à la casse en base : on normalise à l'entrée pour que
  // la valeur stockée corresponde à ce que l'index attend.
  .transform((value) => value.toLowerCase());

export const passwordSchema = z
  .string()
  .min(
    PASSWORD_MIN_LENGTH,
    `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`,
  )
  .max(PASSWORD_MAX_LENGTH, 'Mot de passe trop long.')
  .refine(
    (value) => !COMMON_PASSWORDS.has(value.toLowerCase()),
    'Ce mot de passe est trop courant. Choisis-en un autre.',
  );

/** UX_FLOWS.md §3 — 3 champs à l'inscription, pas un de plus. */
export const firstNameSchema = z
  .string()
  .trim()
  .min(2, 'Ton prénom doit contenir au moins 2 caractères.')
  .max(60, 'Prénom trop long.');

export const studentSignUpSchema = z.object({
  firstName: firstNameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Le mot de passe est obligatoire.'),
});

export const passwordResetRequestSchema = z.object({ email: emailSchema });

export const passwordResetSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

/**
 * Profil élève (UX_FLOWS.md §3, étape 4).
 * `currentAverage` est DÉCLARATIF : on le borne, on ne le vérifie pas.
 */
export const studentOnboardingSchema = z
  .object({
    gradeLevel: z.literal('2nde_C'),
    currentAverage: z.number().min(0).max(20).optional(),
    targetAverage: z.number().min(0).max(20),
    dailyMinutes: z.union([z.literal(30), z.literal(45), z.literal(60), z.literal(90)]),
    daysPerWeek: z.number().int().min(1).max(7),
  })
  .refine((v) => v.currentAverage === undefined || v.targetAverage >= v.currentAverage, {
    message: 'Ton objectif doit être au moins égal à ta moyenne actuelle.',
    path: ['targetAverage'],
  });

/**
 * Code d'invitation parent, au format `SAVOIR-XXXX` (UX_FLOWS.md §6.1).
 * Alphabet sans caractères ambigus : ni O/0, ni I/1, ni L.
 */
export const INVITATION_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const INVITATION_CODE_PATTERN = /^SAVOIR-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;

export const invitationCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(INVITATION_CODE_PATTERN, 'Ce code d’invitation n’est pas valide.');

export const acceptInvitationSchema = z.object({ code: invitationCodeSchema });

export type StudentSignUpInput = z.infer<typeof studentSignUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type StudentOnboardingInput = z.infer<typeof studentOnboardingSchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
