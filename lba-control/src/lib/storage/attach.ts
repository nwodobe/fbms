/**
 * Dépôt d'un justificatif, en ligne comme hors ligne.
 *
 * C'est délibérément la même fonction dans les deux cas, comme pour la saisie
 * d'un achat : un chemin « hors ligne » séparé finirait par diverger du chemin
 * principal, et c'est toujours celui du terrain qui en pâtirait.
 *
 * Ce que la fonction garantit, dans cet ordre :
 *
 *  1. Le fichier est contrôlé et compressé **avant toute tentative d'envoi**.
 *     Un fichier inutilisable est refusé pendant que le pisteur est encore
 *     devant le vendeur, pas trois heures plus tard au retour du réseau.
 *
 *  2. Si l'envoi passe, le chemin est renvoyé à l'appelant, qui l'écrit avec sa
 *     ligne métier.
 *
 *  3. Sinon, les octets sont conservés sur l'appareil et **aucun chemin n'est
 *     inscrit**. La ligne reste sans justificatif tant que les octets ne sont
 *     pas arrivés : c'est la seule version honnête, et la seule qui laisse les
 *     contrôles serveur — seuil de justificatif, poids « vérifié » — faire leur
 *     travail.
 */

import { bindingKey, type AttachmentBinding } from '@/domain/attachments'
import type { UploadKind } from '@/domain/uploads'
import { queueAttachment } from '@/lib/offline/attachments'
import { prepareUpload, storeBytes } from './upload'

export interface AttachProofInput {
  file: File
  kind: UploadKind
  binding: AttachmentBinding
  tenantId: string
  userId: string
  deviceId: string
  isOnline: boolean
}

export type AttachProofResult =
  | { queued: false; path: string; savedBytes: number }
  | { queued: true; reason: string; savedBytes: number }

/** Une panne de transport se réessaie ; un refus métier se reproduirait à l'identique. */
function isTransportFailure(message: string): boolean {
  return /fetch|network|timeout|réseau|offline|econnrefused/i.test(message)
}

export async function attachProof(input: AttachProofInput): Promise<AttachProofResult> {
  // Contrôle et compression d'abord : sans réseau, ils fonctionnent quand même.
  const prepared = await prepareUpload(input.file, input.kind)

  const queueIt = async (reason: string): Promise<AttachProofResult> => {
    await queueAttachment({
      tenantId: input.tenantId,
      userId: input.userId,
      deviceId: input.deviceId,
      kind: input.kind,
      binding: input.binding,
      // Les octets sont extraits maintenant : conservés sous forme de tampon,
      // ils traversent IndexedDB sans dépendre du clonage d'un Blob.
      content: await prepared.blob.arrayBuffer(),
      mimeType: prepared.mimeType,
    })
    return { queued: true, reason, savedBytes: prepared.savedBytes }
  }

  if (!input.isOnline) {
    return queueIt('Appareil hors connexion')
  }

  try {
    const path = await storeBytes({
      blob: prepared.blob,
      mimeType: prepared.mimeType,
      kind: input.kind,
      tenantId: input.tenantId,
      // L'emplacement visé nomme le fichier : deux justificatifs d'une même
      // ligne — ticket de départ et ticket de réception — ne se recouvrent pas.
      entityId: entityIdFor(input.binding),
    })
    return { queued: false, path, savedBytes: prepared.savedBytes }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Un refus du bucket — type interdit, quota, droits — se reproduirait à
    // l'identique : le mettre en file ferait espérer un envoi qui n'aura pas
    // lieu. Seules les pannes de transport sont mises en attente.
    if (!isTransportFailure(message)) throw error
    return queueIt(`Envoi impossible : ${message}`)
  }
}

/**
 * Nom de l'objet dans le bucket.
 *
 * Dérivé de l'emplacement métier, pas de l'identifiant de ligne seul : un
 * transfert porte deux tickets, et les ranger sous le même nom en effacerait un.
 */
export function entityIdFor(binding: AttachmentBinding): string {
  return bindingKey(binding).replace(/[.#]/g, '-')
}
