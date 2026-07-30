/**
 * Schémas Zod partagés.
 *
 * Une règle, une définition : ces schémas valident les formulaires React Hook
 * Form **et** les entrées des fonctions serveur. Dupliquer la règle des deux
 * côtés garantirait qu'elles finissent par diverger, et c'est toujours la
 * version serveur qu'on découvre trop tard.
 *
 * Ils ne remplacent pas les contraintes SQL : ils donnent des messages
 * utilisables, la base garde le dernier mot.
 */
import { z } from 'zod'
import { checkBrandColors } from './contrast'

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

const isoDate = z.string().regex(ISO_DATE, 'Date attendue au format AAAA-MM-JJ.')

const trimmed = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .min(min, `${label} : ${min} caractère${min > 1 ? 's' : ''} minimum.`)
    .max(max, `${label} : ${max} caractères maximum.`)

// ---------------------------------------------------------------------------
// Marque du tenant
// ---------------------------------------------------------------------------

export const brandingSchema = z
  .object({
    commercialName: trimmed(2, 120, 'Nom commercial'),
    legalName: trimmed(2, 160, 'Raison sociale').optional().or(z.literal('')),
    slogan: z.string().trim().max(160, 'Slogan : 160 caractères maximum.').optional().or(z.literal('')),
    primaryColor: z.string().regex(HEX_COLOR, 'Couleur principale : code hexadécimal attendu (#1f6f43).'),
    secondaryColor: z.string().regex(HEX_COLOR, 'Couleur secondaire : code hexadécimal attendu (#b45309).'),
    phone: z.string().trim().max(40).optional().or(z.literal('')),
    email: z.string().trim().email('Email invalide.').max(160).optional().or(z.literal('')),
    address: z.string().trim().max(300).optional().or(z.literal('')),
    taxId: z.string().trim().max(60).optional().or(z.literal('')),
    documentFooter: z.string().trim().max(300).optional().or(z.literal('')),
  })
  // Le contraste est vérifié ici ET dans la fonction serveur : une couleur
  // illisible acceptée se retrouverait sur les PDF, les bons de transfert et
  // les reçus, c'est-à-dire sur des documents qui sortent de l'entreprise.
  .superRefine((values, ctx) => {
    const verdict = checkBrandColors(values.primaryColor, values.secondaryColor)
    if (verdict.accepted) return

    for (const issue of verdict.issues) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: issue,
        path: [issue.includes('secondaire') ? 'secondaryColor' : 'primaryColor'],
      })
    }
  })

export type BrandingInput = z.infer<typeof brandingSchema>

// ---------------------------------------------------------------------------
// Société partenaire
// ---------------------------------------------------------------------------

export const partnerCompanySchema = z.object({
  code: trimmed(2, 20, 'Code')
    .regex(/^[A-Z0-9-]+$/, 'Code : majuscules, chiffres et tirets uniquement.'),
  name: trimmed(2, 160, 'Nom'),
  contactName: z.string().trim().max(120).optional().or(z.literal('')),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  email: z.string().trim().email('Email invalide.').max(160).optional().or(z.literal('')),
  address: z.string().trim().max(300).optional().or(z.literal('')),
  weightTolerancePct: z
    .number({ invalid_type_error: 'Tolérance : nombre attendu.' })
    .min(0, 'La tolérance ne peut pas être négative.')
    .max(100, 'Une tolérance supérieure à 100 % n’a pas de sens.')
    .nullable()
    .optional(),
  acceptanceTolerancePct: z
    .number({ invalid_type_error: 'Tolérance : nombre attendu.' })
    .min(0, 'La tolérance ne peut pas être négative.')
    .max(100, 'Une tolérance supérieure à 100 % n’a pas de sens.')
    .nullable()
    .optional(),
})

export type PartnerCompanyInput = z.infer<typeof partnerCompanySchema>

// ---------------------------------------------------------------------------
// Campagne
// ---------------------------------------------------------------------------

export const campaignSchema = z
  .object({
    code: trimmed(2, 20, 'Code'),
    name: trimmed(2, 120, 'Nom'),
    startDate: isoDate,
    endDate: isoDate,
  })
  .refine((values) => values.endDate >= values.startDate, {
    message: 'La date de fin doit être postérieure ou égale à la date de début.',
    path: ['endDate'],
  })

export type CampaignInput = z.infer<typeof campaignSchema>

// ---------------------------------------------------------------------------
// Contrat
// ---------------------------------------------------------------------------

export const contractSchema = z
  .object({
    partnerCompanyId: z.string().uuid('Sélectionnez une société partenaire.'),
    campaignId: z.string().uuid('Sélectionnez une campagne.'),
    productId: z.string().uuid('Sélectionnez un produit.'),
    reference: trimmed(2, 60, 'Référence'),
    targetVolumeKg: z
      .number({ invalid_type_error: 'Volume cible : nombre attendu.' })
      .positive('Le volume cible doit être strictement positif.')
      .nullable()
      .optional(),
    startDate: isoDate,
    endDate: isoDate,
    deliveryPlace: z.string().trim().max(200).optional().or(z.literal('')),
    korMin: z.number().min(0, 'Le KOR minimum ne peut pas être négatif.').max(100).nullable().optional(),
    humidityMax: z.number().min(0).max(100, 'Une humidité supérieure à 100 % est impossible.').nullable().optional(),
    impuritiesMax: z.number().min(0).max(100).nullable().optional(),
    weightTolerancePct: z.number().min(0).max(100).nullable().optional(),
    acceptanceTolerancePct: z.number().min(0).max(100).nullable().optional(),
    paymentTerms: z.string().trim().max(300).optional().or(z.literal('')),
    paymentDelayDays: z.number().int().min(0).nullable().optional(),
    // Arbitrages D1 et D2, paramétrables par contrat.
    coverageBasis: z.enum(['purchase_validated', 'reception_accepted', 'payment_received']),
    valuationPriceBasis: z.enum(['negocie', 'net_reconnu', 'producteur', 'valorisation_ecart']),
  })
  .refine((values) => values.endDate >= values.startDate, {
    message: 'La date de fin doit être postérieure ou égale à la date de début.',
    path: ['endDate'],
  })

export type ContractInput = z.infer<typeof contractSchema>

// ---------------------------------------------------------------------------
// Prix négocié
// ---------------------------------------------------------------------------

export const negotiatedPriceSchema = z
  .object({
    contractId: z.string().uuid(),
    priceType: z.enum(['negocie', 'plafond_achat', 'producteur', 'net_reconnu', 'valorisation_ecart']),
    price: z
      .number({ invalid_type_error: 'Prix : nombre attendu.' })
      .positive('Le prix doit être strictement positif.'),
    validFrom: isoDate,
    validTo: isoDate.nullable().optional(),
    isProvisional: z.boolean().default(false),
    // Une révision de prix sans motif est un changement de valeur sans trace
    // exploitable : le champ est obligatoire, c'est délibéré.
    justification: trimmed(10, 500, 'Justification'),
  })
  .refine((values) => values.validTo == null || values.validTo >= values.validFrom, {
    message: 'La fin de validité doit être postérieure ou égale au début.',
    path: ['validTo'],
  })

export type NegotiatedPriceInput = z.infer<typeof negotiatedPriceSchema>

// ---------------------------------------------------------------------------
// Utilitaire de formulaire
// ---------------------------------------------------------------------------

/** Convertit '' en null pour les colonnes nullables — '' n'est pas une absence de valeur. */
export function emptyToNull<T extends Record<string, unknown>>(values: T): T {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    output[key] = typeof value === 'string' && value.trim() === '' ? null : value
  }
  return output as T
}
