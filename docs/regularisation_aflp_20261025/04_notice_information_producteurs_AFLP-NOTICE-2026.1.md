# Notice d'information du producteur · Programme AFLP

**Version : AFLP-NOTICE-2026.1 · Statut : en attente de validation juridique**
À lire au producteur, à voix haute si nécessaire, dans la langue qu'il comprend. Une copie peut lui être remise.

---

## 1. Qui sommes-nous ?

ANAGROCI, société de transformation de noix de cajou, conduit le programme **AFLP** (ANAGROCI FieldLink Programme) dans la région du Gbêkê. ANAGROCI est responsable des informations recueillies sur vous dans ce programme.

Contact : antenne ANAGROCI de Bouaké, auprès de votre Chef d'Unité ou de votre Chef de Zone.

## 2. Pourquoi recueillons-nous vos informations ?

Pour :

1. vous inscrire au programme et vous attribuer un identifiant producteur ;
2. acheter votre cajou et vous payer correctement ;
3. connaître vos plantations (superficie, nombre d'arbres, production) pour organiser la collecte ;
4. vous proposer des formations et un suivi agricole ;
5. vérifier, lors de visites, les pratiques agricoles, sociales et environnementales ;
6. démontrer l'origine du cajou acheté (traçabilité) à nos clients et, si une certification est engagée, à un organisme de certification.

Nous ne vendons pas vos informations.

## 3. Quelles informations ?

- Identité : nom, prénoms, sexe, année de naissance, téléphone, pièce d'identité.
- Village, campement, relais terrain (RT) ou coopérative.
- Plantation : superficie déclarée, arbres, âge, production, ventes passées.
- **Position GPS de vos plantations**, si vous l'acceptez.
- Photos (pièce d'identité, plantation) si vous l'acceptez.
- Achats, paiements, mode de paiement.
- Résultats des questionnaires et visites de durabilité.

## 4. La position GPS de vos plantations

Le GPS sert à situer vos plantations, à éviter les doublons et à prouver que le cajou ne vient pas d'une zone interdite (forêt classée, aire protégée). Les coordonnées sont visibles seulement par l'équipe terrain et la supervision ANAGROCI. **Vous pouvez refuser le GPS** : vous restez inscrit, mais certaines démarches de certification pourront être impossibles.

## 5. Qui peut voir vos informations ?

- L'équipe AFLP d'ANAGROCI (agent, Chef d'Unité, Chef de Zone, Branch Manager) selon leur zone.
- Les services Achats et Finance d'ANAGROCI, pour les paiements.
- **Seulement si une certification est engagée et avec votre accord** : l'organisme de certification ou d'audit, pour contrôler le programme.
- Les autorités publiques, uniquement si la loi l'exige.

Aucun partage avec d'autres acheteurs ou commerçants.

## 6. Combien de temps et avec quelle sécurité ?

Vos informations sont conservées dans une base protégée par mot de passe et par des droits d'accès limités. Elles sont gardées pendant votre participation au programme puis le temps exigé par la loi et par les règles de traçabilité (durée à confirmer par le service juridique).

## 7. Vos droits

Vous pouvez à tout moment, gratuitement :

- demander à voir vos informations ;
- faire corriger une information fausse ;
- refuser une utilisation (GPS, photos, partage avec un certificateur) ;
- retirer votre accord pour la suite ;
- vous plaindre auprès d'ANAGROCI, puis, si vous n'êtes pas satisfait, auprès de l'**ARTCI** (Autorité de Régulation des Télécommunications/TIC de Côte d'Ivoire), autorité chargée de la protection des données personnelles.

Refuser ou retirer votre accord **ne vous empêche pas** de vendre votre cajou à ANAGROCI.

## 8. Votre accord

Après cette lecture, l'agent vous demande, **séparément** :

| Question | Oui | Non |
|---|---|---|
| Acceptez-vous de participer au programme AFLP ? | | |
| Acceptez-vous l'enregistrement de votre identité et de vos informations agricoles ? | | |
| Acceptez-vous l'enregistrement de la position GPS de vos plantations ? | | |
| Acceptez-vous les photos ? | | |
| Acceptez-vous les visites et inspections de durabilité ? | | |
| Acceptez-vous l'enregistrement de vos achats et paiements ? | | |
| Acceptez-vous les formations et leur suivi ? | | |
| Acceptez-vous, si une certification est engagée, la communication de votre dossier à l'organisme certificateur ? | | |

---

## Mode opératoire de l'agent (non lu au producteur)

1. Lire la notice intégralement, à voix haute si le producteur ne lit pas le français. Utiliser un interprète si besoin et le noter.
2. Laisser le producteur poser ses questions ; noter les questions importantes.
3. Recueillir chaque accord **séparément**. Ne jamais cocher « oui » à la place du producteur.
4. Enregistrer dans FBMS, le même jour :
   - la **remise de la notice** (`farmer_notice_deliveries` : version, date, méthode, langue, interprète, accusé de réception) ;
   - le **consentement données** (`farmer_consents` : périmètres réellement acceptés, méthode VERBAL / WRITTEN / WITNESSED) ;
   - si une feuille signée ou marquée de l'empreinte existe, la photographier et la rattacher comme preuve.
5. Si le producteur refuse un périmètre : enregistrer `PARTIAL` avec les seuls périmètres acceptés. S'il refuse tout : enregistrer `REFUSED`.
6. **Interdit** : remplir une remise de notice ou un consentement pour un producteur non rencontré, antidater une saisie, signer à la place du producteur.

## Points à valider par le service juridique avant généralisation

- Formalité ARTCI applicable au traitement AFLP (autorisation préalable, dépôt sur la plateforme CERTINUM) et numéro de récépissé à mentionner dans la notice.
- Durée de conservation.
- Base légale du partage avec un organisme certificateur et éventuel transfert hors de Côte d'Ivoire.
- Traitement des données des producteurs mineurs ou des membres de la famille mentionnés.
- Coordonnées précises du point de contact pour l'exercice des droits.
- Confirmation par la Direction de l'engagement « refuser ne vous empêche pas de vendre à ANAGROCI » (condition d'un consentement libre ; à retirer s'il ne peut pas être tenu).
- Correction du droit d'insertion des consentements : la politique actuelle de `farmer_consents` exclut Unit Head, Zonal Head et Assistant Unit Head (voir rapport, anomalie P0-1). Tant qu'elle n'est pas corrigée, ces rôles ne peuvent pas enregistrer le consentement recueilli.
