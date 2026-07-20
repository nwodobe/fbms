# RCN Trace — Étape 1 : audit de l'existant

Date : 20/07/2026  
Projet : ANAGROCI Operations Suite / RCN Trace  
Statut : Audit fonctionnel et technique de l'existant  
Décision : l'étape 11 Farmer Buying est suspendue temporairement ; RCN Trace devient prioritaire.

---

## 1. Objectif de cette étape

Cette étape ne corrige pas encore l'application.

Elle sert à comprendre ce qui existe déjà dans RCN Trace avant toute intervention.

Objectifs :

- vérifier les fichiers RCN Trace présents dans le dépôt ;
- comprendre l'architecture actuelle ;
- vérifier les tables Supabase RCN existantes ;
- identifier les modules déjà couverts ;
- identifier les angles morts avant production ;
- éviter de casser Farmer Buying ou les autres modules.

Aucune donnée de production n'a été modifiée pendant cet audit.

---

## 2. Fichiers inspectés

Les fichiers principaux identifiés sont :

| Fichier | Rôle observé |
|---|---|
| `rcntrace/index.html` | Shell SPA RCN Trace, design, chargement des scripts, protection par `auth-gate` |
| `rcntrace/README.md` | Description fonctionnelle Modules 1 & 2 |
| `rcntrace/rcntrace.js` | Moteur métier, règles KOR, BIN, transfert, calibrage, stockage local |
| `rcntrace/rcntrace-ui.js` | Interface et routeur des écrans |
| `rcntrace/rcntrace-sync.js` | Synchronisation Supabase offline-first |
| `supabase/rcntrace.sql` | Schéma Supabase cible RCN Trace |
| `supabase/rcntrace_etl.sql` | Vues ETL et BI depuis `rcn_state` |
| `rcntrace/procurement-pricing.js` | Logique prix / procurement |
| `rcntrace/ci-geo.js` | Cartographie / géographie Côte d'Ivoire |

---

## 3. Architecture observée

RCN Trace est déjà plus avancé qu'un simple prototype visuel.

Il existe trois couches :

### 3.1 Couche interface

`index.html` charge :

- Supabase JS ;
- XLSX ;
- `shared/auth-gate.js` avec `data-module="rcntrace"` ;
- le shell visuel RCN Trace ;
- les scripts métier RCN.

Le module est donc déjà rattaché au portail sécurisé.

### 3.2 Couche moteur métier

`rcntrace.js` contient déjà des règles métier importantes :

- formule KOR ;
- tolérance écart KOR strictement inférieure à 1 ;
- réception ;
- qualité ;
- déchargement ;
- lot officiel ;
- BIN ;
- contributeurs ;
- transfert ;
- calibrage ;
- pertes / résidus ;
- sacs jute ;
- fournisseurs ;
- audit.

Le moteur travaille d'abord en local, puis synchronise.

### 3.3 Couche synchronisation

`rcntrace-sync.js` utilise un modèle offline-first :

- hydratation depuis Supabase au démarrage ;
- écriture dans `rcn_state` ;
- écriture audit dans `rcn_audit` ;
- reprise au retour réseau ;
- synchronisation idempotente via `upsert`.

C'est une bonne base, mais elle doit être auditée plus durement avant production.

---

## 4. Modules fonctionnels déjà présents

Le README annonce la couverture de la chaîne :

```text
REC → QLT → RCN → BIN → TRF → CAL
```

Cela correspond à :

| Code | Module | Statut observé |
|---|---|---|
| REC | Réception temporaire camion | Présent |
| QLT | Sampling / qualité | Présent |
| RCN | Lot officiel | Présent |
| BIN | Stock et BIN | Présent |
| TRF | Transfert | Présent |
| CAL | Calibrage | Présent |

L'interface mentionne aussi trois grands espaces de travail :

- Procurement ;
- Activité entrepôt ;
- Calibrage.

---

## 5. Tables Supabase RCN observées

Toutes les tables RCN inspectées ont RLS activé.

### 5.1 Tables avec données

| Table | Lignes estimées | Observation |
|---|---:|---|
| `rcn_audit` | 36 | Journal existant |
| `rcn_fournisseurs` | 64 | Base fournisseurs chargée |
| `rcn_referentiels` | 19 | Référentiels chargés |
| `rcn_state` | 13 | Magasin opérationnel JSONB déjà alimenté |
| `rcn_jute_settings` | 1 | Paramètre sacherie RCN existant |
| `rcn_proc_parametres` | 1 | Paramètre procurement existant |
| `rcn_proc_prix` | 1 | Prix / paramètres achat existants |

### 5.2 Tables opérationnelles encore vides

Les tables suivantes existent mais semblent vides :

- `rcn_receptions` ;
- `rcn_qualites` ;
- `rcn_decisions_gm` ;
- `rcn_dechargements` ;
- `rcn_lots` ;
- `rcn_bin_cycles` ;
- `rcn_bin_contributeurs` ;
- `rcn_mouvements` ;
- `rcn_transferts` ;
- `rcn_transfert_contributeurs` ;
- `rcn_calibrages` ;
- `rcn_cal_sorties` ;
- `rcn_cal_pertes` ;
- `rcn_cal_arrets` ;
- plusieurs tables RCN Procurement ;
- plusieurs tables RCN Jute.

Conclusion : la donnée opérationnelle semble surtout portée actuellement par `rcn_state`, pendant que les tables normalisées sont prêtes pour ETL / BI mais peu ou pas alimentées directement.

---

## 6. Points positifs

### 6.1 Architecture déjà structurée

RCN Trace n'est pas à reprendre de zéro.

Il existe déjà :

- une SPA ;
- un moteur métier ;
- une synchronisation ;
- une base Supabase ;
- une logique offline-first ;
- un journal audit ;
- une base fournisseurs.

### 6.2 La formule KOR est bien intégrée

La formule confirmée est présente :

```text
KOR = (GK + Spotted/2 + Immature/2) × 0.17637
```

La tolérance stricte est aussi présente :

```text
écart conforme seulement si < 1
```

### 6.3 La logique BIN / contributeurs existe

Le principe est bon :

```text
le lot porte l'identité
la BIN porte la position
après mélange, la traçabilité passe par les contributeurs
```

### 6.4 La séparation entre poids physique et poids main-d'œuvre existe

C'est important parce que le poids net physique pilote le stock, tandis que le poids main-d'œuvre doit rester séparé.

---

## 7. Angles morts identifiés

### 7.1 Le moteur est encore trop local / JSONB

L'application écrit surtout dans `rcn_state`.

C'est pratique pour démarrer, mais risqué pour une exploitation industrielle si :

- plusieurs utilisateurs modifient le même objet ;
- les validations doivent être bloquées côté serveur ;
- les rapports doivent être juridiquement solides ;
- les données doivent être auditées ligne par ligne.

### 7.2 Les tables normalisées existent mais ne semblent pas encore utilisées comme source principale

Les tables normalisées sont présentes, mais la plupart sont vides.

Il faut décider si :

1. `rcn_state` reste la source opérationnelle principale ;
2. les tables normalisées deviennent progressivement la source principale ;
3. ou bien on garde `rcn_state` comme cache/offline et on impose des contrôles serveur sur les tables normalisées.

### 7.3 Les contrôles serveur métier doivent être renforcés

À ce stade, il faut vérifier ou ajouter des blocages serveur pour :

- lot officiel impossible avant décision GM ;
- déchargement impossible si GM n'a pas autorisé ;
- KOR final avec écart >= 1 bloqué ou mis en validation spéciale ;
- sortie BIN impossible si stock insuffisant ;
- transfert impossible si triple validation incomplète ;
- calibrage impossible sur transfert non reçu ;
- clôture calibrage impossible si bilan matière incohérent ;
- correction impossible sans motif et auteur.

### 7.4 Le workflow Bouaké → Yakro → Calibrage doit être clarifié

Le README mentionne déjà que Yakro n'est pas seulement calibrage mais peut être un second entrepôt.

Il faut verrouiller le flux réel :

```text
Bouaké réceptionne → crée lot/BIN → transfère vers Yakro
Yakro réceptionne → recrée lot/BIN local avec généalogie
Yakro peut aussi recevoir direct fournisseur
Calibrage consomme uniquement les transferts destinés au calibrage
```

### 7.5 Le module sacherie RCN est plus complexe que Farmer Buying

RCN Trace contient une logique jute fournisseur + interne.

Il faut éviter un piège :

```text
retour fournisseur ≠ sac utilisable
sac retourné ≠ sac disponible pour rebagging
rebagging = consommation interne, pas réduction de dette fournisseur
```

### 7.6 Les preuves documentaires ne sont pas encore clairement reliées à Supabase Storage

Il existe `rcn_documents`, mais l'audit doit vérifier si :

- ticket pesée ;
- fiche CCA ;
- photo camion ;
- fiche sampling ;
- décision GM ;
- bordereau transfert ;
- rapport calibrage ;

sont bien stockés, reliés et consultables.

---

## 8. Priorités recommandées avant développement

Avant de coder, il faut choisir l'ordre de remise à niveau.

### Priorité 1 — Audit métier écran par écran

Tester chaque écran dans l'ordre réel :

1. Réception camion ;
2. Sampling ;
3. décision GM ;
4. déchargement ;
5. analyse finale ;
6. création lot officiel ;
7. allocation BIN ;
8. séchage / triage ;
9. transfert ;
10. réception Yakro ;
11. calibrage ;
12. clôture ;
13. rapports ;
14. audit.

### Priorité 2 — Verrous métier côté serveur

Après l'audit écran, ajouter des contrôles serveur non destructifs.

### Priorité 3 — Workflow preuves documentaires

Brancher les preuves à Supabase Storage ou documenter clairement l'approche.

### Priorité 4 — Mini-simulation complète

Faire un scénario test de bout en bout :

```text
1 camion fournisseur → sampling → GM → déchargement → lot → BIN → transfert → réception Yakro → calibrage → bilan matière
```

---

## 9. Décision recommandée

Ne pas passer directement à l'étape 11 Farmer Buying.

La prochaine étape recommandée est :

```text
RCN Trace — Étape 2 : audit écran par écran du flux réel Bouaké / Yakro / Calibrage
```

Objectif : vérifier si l'application permet réellement le travail opérationnel quotidien d'un magasinier, d'un QA, d'un Branch Manager et d'un responsable calibrage.

---

## 10. Ce qui n'a pas été fait dans cette étape

- Aucun code RCN Trace modifié.
- Aucune table Supabase modifiée.
- Aucune donnée RCN supprimée.
- Aucun test navigateur réel effectué.
- Aucun test téléphone réel effectué.
- Aucun passage à l'étape 11 Farmer Buying.
