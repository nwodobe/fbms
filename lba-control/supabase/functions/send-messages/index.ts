/**
 * Vidage de la file des messages sortants.
 *
 * Cette fonction est le seul endroit du produit qui parle à un fournisseur
 * externe. Elle tourne côté serveur, avec la clé `service_role`, et c'est
 * précisément pour cela qu'elle est ici et non dans le navigateur : la commande
 * §3 interdit cette clé côté client, et les identifiants des fournisseurs de SMS
 * n'ont rien à faire dans un bundle téléchargé par un pisteur.
 *
 * Ce qu'elle garantit :
 *
 *  · **elle ne décide de rien** — la base a déjà dit quoi envoyer, à qui, et à
 *    partir de quand. Ici on lit une ligne, on appelle un fournisseur, on
 *    consigne le résultat ;
 *
 *  · **elle ne perd rien** — chaque message réservé est rendu avec son sort,
 *    succès ou échec, y compris si le fournisseur répond n'importe quoi ;
 *
 *  · **elle n'envoie jamais deux fois** — la réservation se fait en base avec
 *    `for update skip locked`, donc deux exécutions simultanées ne se disputent
 *    pas les mêmes lignes.
 *
 * Aucun secret n'est écrit dans ce fichier. Tous viennent de l'environnement, et
 * un fournisseur non configuré fait échouer proprement le message concerné
 * plutôt que l'exécution entière.
 *
 * Déploiement :
 *   supabase functions deploy send-messages
 *   supabase secrets set TWILIO_ACCOUNT_SID=… TWILIO_AUTH_TOKEN=… TWILIO_SMS_FROM=…
 *   supabase secrets set WHATSAPP_TOKEN=… WHATSAPP_PHONE_ID=…
 *   supabase secrets set RESEND_API_KEY=… RESEND_FROM=…
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

interface OutboxRow {
  id: string
  channel: 'sms' | 'whatsapp' | 'email'
  destination: string
  subject: string | null
  body: string
}

interface SendResult {
  sent: boolean
  provider: string
  providerRef?: string
  segments?: number
  error?: string
  retryable: boolean
}

/** Un fournisseur non configuré n'est pas une panne : c'est un message qui n'a pas de route. */
function missingConfig(provider: string, variables: string[]): SendResult {
  return {
    sent: false,
    provider,
    error: `Fournisseur ${provider} non configuré : ${variables.join(', ')} absent(s).`,
    // Non rejouable : réessayer sans configuration donnerait le même résultat
    // toutes les trente secondes jusqu'à épuisement des tentatives.
    retryable: false,
  }
}

/**
 * Segments facturés. Miroir de `smsSegments` dans `src/domain/messaging.ts`.
 *
 * Le français contient presque toujours un caractère hors GSM-7 : compter en
 * 160 sous-estimerait la facture de plus du double.
 */
function smsSegments(message: string): number {
  const isUnicode = /[^\x20-\x7E\n\r]/.test(message.replace(/[éèùàçÉÈÙÀÇ]/g, 'e'))
  const size = isUnicode ? 70 : 160
  const multipart = isUnicode ? 67 : 153
  return message.length <= size ? 1 : Math.ceil(message.length / multipart)
}

// ---------------------------------------------------------------------------
// Fournisseurs
// ---------------------------------------------------------------------------

async function sendSms(row: OutboxRow): Promise<SendResult> {
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID')
  const token = Deno.env.get('TWILIO_AUTH_TOKEN')
  const from = Deno.env.get('TWILIO_SMS_FROM')

  if (!sid || !token || !from) {
    return missingConfig('twilio', ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_SMS_FROM'])
  }

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: row.destination, From: from, Body: row.body }),
    },
  )

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    return {
      sent: false,
      provider: 'twilio',
      error: `${response.status} ${payload?.message ?? 'erreur inconnue'}`,
      // 4xx : la demande elle-même est refusée — numéro invalide, destinataire
      // désabonné. Insister coûte de l'argent sans rien changer.
      retryable: response.status >= 500 || response.status === 429,
    }
  }

  return {
    sent: true,
    provider: 'twilio',
    providerRef: payload?.sid,
    segments: Number(payload?.num_segments) || smsSegments(row.body),
    retryable: false,
  }
}

async function sendWhatsApp(row: OutboxRow): Promise<SendResult> {
  const token = Deno.env.get('WHATSAPP_TOKEN')
  const phoneId = Deno.env.get('WHATSAPP_PHONE_ID')

  if (!token || !phoneId) {
    return missingConfig('whatsapp', ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID'])
  }

  const response = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      // Le `+` initial est retiré : l'API Meta attend le numéro sans lui.
      to: row.destination.replace(/^\+/, ''),
      type: 'text',
      text: { body: row.body },
    }),
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    return {
      sent: false,
      provider: 'whatsapp',
      error: `${response.status} ${payload?.error?.message ?? 'erreur inconnue'}`,
      retryable: response.status >= 500 || response.status === 429,
    }
  }

  return {
    sent: true,
    provider: 'whatsapp',
    providerRef: payload?.messages?.[0]?.id,
    retryable: false,
  }
}

async function sendEmail(row: OutboxRow): Promise<SendResult> {
  const key = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('RESEND_FROM')

  if (!key || !from) return missingConfig('resend', ['RESEND_API_KEY', 'RESEND_FROM'])

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [row.destination],
      subject: row.subject ?? 'Notification',
      text: row.body,
    }),
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    return {
      sent: false,
      provider: 'resend',
      error: `${response.status} ${payload?.message ?? 'erreur inconnue'}`,
      retryable: response.status >= 500 || response.status === 429,
    }
  }

  return { sent: true, provider: 'resend', providerRef: payload?.id, retryable: false }
}

const SENDERS: Record<OutboxRow['channel'], (row: OutboxRow) => Promise<SendResult>> = {
  sms: sendSms,
  whatsapp: sendWhatsApp,
  email: sendEmail,
}

// ---------------------------------------------------------------------------
// Boucle
// ---------------------------------------------------------------------------

Deno.serve(async (request: Request) => {
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!url || !serviceKey) {
    return new Response(
      JSON.stringify({ error: 'Environnement Supabase incomplet.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })

  const requested = Number(new URL(request.url).searchParams.get('limit')) || 50
  const { data: claimed, error } = await supabase.rpc('claim_messages', { p_limit: requested })

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const rows = (claimed ?? []) as OutboxRow[]
  const report = { claimed: rows.length, sent: 0, failed: 0 }

  for (const row of rows) {
    let result: SendResult
    try {
      result = await SENDERS[row.channel](row)
    } catch (cause) {
      // Une exception du réseau ou du fournisseur reste un échec RENDU à la
      // base. Sortir d'ici sans consigner laisserait le message bloqué en
      // « sending » pour toujours — invisible et jamais réessayé.
      result = {
        sent: false,
        provider: row.channel,
        error: cause instanceof Error ? cause.message : String(cause),
        retryable: true,
      }
    }

    const { error: recordError } = await supabase.rpc('record_message_result', {
      p_id: row.id,
      p_sent: result.sent,
      p_provider: result.provider,
      p_provider_ref: result.providerRef ?? null,
      p_segments: result.segments ?? null,
      p_error: result.error ?? null,
      p_retryable: result.retryable,
    })

    if (recordError) console.error('Résultat non consigné', row.id, recordError.message)
    if (result.sent) report.sent += 1
    else report.failed += 1
  }

  return new Response(JSON.stringify(report), {
    headers: { 'Content-Type': 'application/json' },
  })
})
