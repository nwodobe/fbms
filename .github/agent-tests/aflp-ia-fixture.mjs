/**
 * Assistant IA AFLP — jeu d'essai commun aux bancs de contrôle.
 *
 * TOUTES LES DONNÉES SONT FICTIVES. Aucun nom de producteur, aucun montant
 * réel, aucune coordonnée de parcelle — règle 4 du dépôt (CLAUDE.md §5).
 *
 * Le jeu est CONSTRUIT pour produire des cas connus, pas pour ressembler à la
 * production :
 *   · Béoumi porte exactement UNE équipe RT, dont un achat ancien → le
 *     comptage RT et la distinction enregistrée / active y sont vérifiables ;
 *   · une équipe est réconciliée AVANT sa dernière avance → NO-GO ;
 *   · une équipe n'a aucune réconciliation et a payé plus qu'elle n'a reçu ;
 *   · un achat n'a pas de reçu → hors assiette de refinancement ;
 *   · un solde de sacs est négatif.
 *
 * Ce fichier ne contient aucune assertion : il n'est qu'une source de données.
 */
import path from 'node:path';
import { createRequire } from 'node:module';

export const RACINE = process.cwd();
export const require_ = createRequire(path.join(RACINE, 'package-inexistant.js'));

export function charger() {
  /* L'ordre importe : le moteur et la couche de compréhension résolvent le
     catalogue par `global.AFLP_IA_CATALOGUE` en priorité. En le posant, on
     reproduit exactement la situation du navigateur, où les quatre fichiers
     sont chargés par des balises <script> successives. */
  const CATALOGUE = require_(path.join(RACINE, 'shared/aflp-ia-catalogue.js'));
  const COMPREHENSION = require_(path.join(RACINE, 'shared/aflp-ia-comprehension.js'));
  const IA = require_(path.join(RACINE, 'shared/aflp-ia-moteur.js'));
  const JOURNAL = require_(path.join(RACINE, 'shared/aflp-ia-journal.js'));
  const LANGUE = require_(path.join(RACINE, 'shared/aflp-ia-langue.js'));
  return { CATALOGUE, COMPREHENSION, IA, JOURNAL, LANGUE };
}

export const JOUR = '2027-03-10';

export const DONNEES = {
  dateRef: JOUR,
  villages: [
    { id: 'v1', data: { s1: { village: 'VILLAGE ALPHA', cluster: 'Djébonoua', gpsLat: 7.1 } } },
    { id: 'v2', data: { s1: { village: 'VILLAGE BRAVO', cluster: 'Brobo' } } },
    { id: 'v3', data: { s1: { village: 'VILLAGE CHARLIE', cluster: 'Béoumi', gpsLat: 7.9 } } },
  ],
  rt: [
    { id: 'rt1', village_nom: 'VILLAGE ALPHA', data: { nom: 'EQUIPE 01', cluster: 'Djébonoua' } },
    { id: 'rt2', village_nom: 'VILLAGE BRAVO', data: { nom: 'EQUIPE 02', cluster: 'Brobo' } },
    { id: 'rt3', village_nom: 'VILLAGE CHARLIE', data: { nom: 'EQUIPE 03', cluster: 'Béoumi' } },
  ],
  achats: [
    { date: JOUR, cluster: 'Djébonoua', village_nom: 'VILLAGE ALPHA', rt_id: 'rt1', rt_nom: 'EQUIPE 01',
      poids_net: 12000, montant: 6000000, commission_rt: 120000, numero_recu: 'R-001',
      refinancable: true, qualite_statut: 'OK', statut_validation: 'OK' },
    { date: JOUR, cluster: 'Brobo', village_nom: 'VILLAGE BRAVO', rt_id: 'rt2', rt_nom: 'EQUIPE 02',
      poids_net: 5000, montant: 2500000, commission_rt: 50000, numero_recu: '',
      refinancable: false, qualite_statut: 'À contrôler', statut_validation: 'Validation BM requise' },
    { date: '2027-02-01', cluster: 'Béoumi', village_nom: 'VILLAGE CHARLIE', rt_id: 'rt3', rt_nom: 'EQUIPE 03',
      poids_net: 3000, montant: 1500000, commission_rt: 30000, numero_recu: 'R-003',
      refinancable: true, qualite_statut: 'OK', statut_validation: 'OK' },
  ],
  avances: [
    { date: '2027-03-08', cluster: 'Djébonoua', rt_id: 'rt1', rt_nom: 'EQUIPE 01', montant: 7000000 },
    { date: '2027-03-09', cluster: 'Brobo', rt_id: 'rt2', rt_nom: 'EQUIPE 02', montant: 3000000 },
    { date: '2027-03-09', cluster: 'Béoumi', rt_id: 'rt3', rt_nom: 'EQUIPE 03', montant: 1000000 },
  ],
  reconciliations: [
    { date: '2027-03-09', rt_id: 'rt1', rt_nom: 'EQUIPE 01', statut: 'Réconcilié', ecart: 0 },
    { date: '2027-03-05', rt_id: 'rt2', rt_nom: 'EQUIPE 02', statut: 'Réconcilié', ecart: 0 },
  ],
  sacs: [
    { date: JOUR, type: 'DOTATION_RT', source: 'ANAGROCI', destination: 'RT', cluster: 'Djébonoua', rt_id: 'rt1', quantite: 500 },
    { date: JOUR, type: 'DISTRIBUTION', source: 'RT', destination: 'PRODUCTEUR', cluster: 'Djébonoua', rt_id: 'rt1', producteur_id: 'p1', quantite: 200 },
    { date: JOUR, type: 'DECHIRE_RT', source: 'RT', destination: 'PERTE', cluster: 'Brobo', rt_id: 'rt2', quantite: 30 },
  ],
  fileLocale: { enAttente: 4, echecs: 1 },
};

/** Contexte de compréhension autonome, sans dépendance à un état construit. */
export const CONTEXTE = {
  zones: ['GBEKE 1', 'GBEKE 2'],
  clusters: [
    { cle: 'DJEBONOUA', label: 'Djébonoua' }, { cle: 'BROBO', label: 'Brobo' },
    { cle: 'SAKASSOU', label: 'Sakassou' }, { cle: 'BEOUMI', label: 'Béoumi' },
    { cle: 'BOTRO', label: 'Botro' }, { cle: 'DIABO', label: 'Diabo' },
  ],
  villages: [
    { nom: 'VILLAGE ALPHA', cluster: 'Djébonoua' },
    { nom: 'VILLAGE BRAVO', cluster: 'Brobo' },
    { nom: 'VILLAGE CHARLIE', cluster: 'Béoumi' },
  ],
  rt: [{ cle: 'rt1', nom: 'EQUIPE 01' }, { cle: 'rt2', nom: 'EQUIPE 02' }, { cle: 'rt3', nom: 'EQUIPE 03' }],
};
