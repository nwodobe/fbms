# Méthodologie de reporting hebdomadaire : Observatoire AFLP

## 1. Calendrier

| Moment | Action | Responsable |
|---|---|---|
| Lundi à dimanche | Visites hebdomadaires, saisie hors ligne puis synchronisation | Chef d'Unité, Assistant |
| Au fil de la semaine, au plus tard dimanche | Vérification et validation des visites | Chef de Zone (droits Observatoire configurés) |
| **Dimanche 23 h 59 (Abidjan)** | Clôture de la semaine ISO | |
| Lundi matin | Contrôle que les synchronisations attendues sont arrivées (onglet Synchronisation & Journal) | Chefs de Zone |
| Lundi, après contrôle | Lancement du générateur = **gel des données** | Branch Manager |
| Lundi | Relecture, arbitrage des recommandations dans le registre, envoi manuel | Branch Manager |

## 2. Lancer le générateur (Windows)

Prérequis une fois : Python 3.10+ et `pip install reportlab openpyxl matplotlib`.
Variables d'environnement (clé **publique** déjà présente dans l'application, jamais la clé de service) :

```bat
setx FBMS_SUPABASE_URL "https://<projet>.supabase.co"
setx FBMS_SUPABASE_ANON_KEY "<clé publique de l'application>"
```

Chaque lundi : double-cliquer `lancer_rapport_lundi.bat`, ou :

```bat
cd RAPPORTS_OBSERVATOIRE_AFLP
python generer_rapport.py
```

Le générateur demande le courriel et le mot de passe FBMS (non affiché, jamais enregistré), vérifie que le rôle est
Branch Manager, Assistant Branch Manager ou Zonal Head, extrait en lecture seule, gèle l'instantané puis produit les fichiers
dans `sorties/`. Un Zonal Head n'obtient que sa zone (RLS) : son rapport ne vaut pas rapport des six clusters.

Pour ajouter un contexte terrain rédigé par vous (inséré tel quel, signalé « non calculé ») :
`python generer_rapport.py --contexte contexte_W48.txt`

## 3. Gel, versions et observations tardives

- L'instantané JSON est l'unique source du rapport. Son empreinte SHA-256 est imprimée en pied de page et dans l'Excel.
  Régénérer avec `--instantane` redonne exactement les mêmes chiffres.
- Gel avant la clôture : rapport « PROVISOIRE ». Gel après : « DÉFINITIVE ».
- Chaque rapport écrit `MANIFESTE_YYYY-Www.json` (visites connues et leur version). La semaine suivante, toute visite
  d'une semaine déjà rapportée qui n'y figurait pas devient un **COMPLEMENT_TARDIF** ; toute visite modifiée devient une
  **CORRECTION_DOCUMENTEE**. Elles apparaissent en annexe ; l'ancien PDF n'est jamais régénéré ni modifié.
- Une visite saisie sur un téléphone non synchronisé est inconnue du serveur : le rapport l'écrit explicitement.

## 4. Chaîne de calcul

1. `extraction.py` : GET uniquement, compte utilisateur, RLS serveur. Aucune donnée nominative ni GPS ; parcelle sous forme d'empreinte.
2. `moteur.py` : calcule tous les chiffres (règles R1 à R10 du dictionnaire).
3. `recommandations.py` : règles déterministes (3 niveaux, garde-fous).
4. `redaction.py` : gabarits de phrases alimentés par les seuls résultats. Aucune IA ne recalcule ni n'interprète les chiffres.
5. `rendu.py` : PDF, Excel, registre, brouillon Outlook.

Si un assistant IA est utilisé ensuite pour enrichir la note, il travaille à partir de `RESULTATS_YYYY-Www.json` et ne
peut citer aucun chiffre absent de ce fichier.

## 5. Circuit de validation

| Rôle | Responsabilité | Droits réels vérifiés |
|---|---|---|
| Chef d'Unité / Assistant | Collecte, première vérification | Lecture de leur cluster ; un AUH ne peut pas recevoir le droit de validation |
| Chef de Zone | Vérification, validation, remontée des anomalies | Selon `pheno_affectations` (droit VERIFICATION ou VALIDATION) ; lecture de sa zone |
| Branch Manager | Interprétation, arbitrage des recommandations (registre), validation du rapport | Lecture complète |
| Direction | Décision sur les moyens | Reçoit le PDF ; aucun accès FBMS requis |

**Observations réalisées par une équipe villageoise (RT).** Le RT n'a pas d'accès à l'Observatoire et aucun compte RT
n'existe. Procédure proposée : le RT remplit la fiche papier de l'Observatoire (date réelle d'observation), la remet au
Chef d'Unité ; celui-ci la saisit en mode `TRANSCRIPTION_PAPIER`, l'observateur restant identifié distinctement du
transcripteur (contrainte serveur `transcripteur_id <> observateur_id`). La fiche est photographiée comme preuve. Aucun
identifiant de connexion n'est partagé ; aucune validation n'est attribuée à un autre utilisateur. Canal de remise de la
fiche : à décider par le Branch Manager (aucun canal n'est présumé approuvé).

## 6. Paramètres modifiables

`generateur/config.py` : plan d'échantillonnage déclaré, seuil de 10 arbres, délais 48 h / 72 h, paliers expérimentaux.
Tout changement est noté ici avec sa date et son auteur.

| Date | Paramètre | Ancienne → nouvelle valeur | Décidé par |
|---|---|---|---|
| 22/11/2026 | Version initiale | | Mandat du Branch Manager |
