# Procédure de publication de la branche (sans contournement des droits)

**Pourquoi cette procédure.** Dans cette session, l'écriture sur le dépôt GitHub a été refusée par le contrôle d'accès (demande d'accès en écriture refusée deux fois). Elle n'a pas été contournée. La branche est livrée sous forme de *bundle* Git signé par son empreinte, que vous publiez vous-même avec vos propres droits.

Fichiers livrés : `fbms-observatoire-2027.bundle` (branche complète), `patches/` (un fichier par commit, alternative), `PR_observatoire.md` (texte de la demande de fusion).

## Windows (PowerShell), dans le dossier où se trouve votre clone FBMS

```powershell
cd C:\chemin\vers\fbms
git fetch origin
git status                                   # doit être propre
git bundle verify $HOME\Downloads\fbms-observatoire-2027.bundle
# attendu : "The bundle requires this ref: 3686cb1..." puis "is okay"
git fetch $HOME\Downloads\fbms-observatoire-2027.bundle feature/aflp-observatoire-2027:feature/aflp-observatoire-2027
git log --oneline 3686cb1..feature/aflp-observatoire-2027   # liste les commits livrés
git diff --stat 3686cb1 feature/aflp-observatoire-2027      # aucun fichier interdit (supabase/** hors migrations Observatoire, .github/**, sw.js...)
git push -u origin feature/aflp-observatoire-2027
```

Puis ouvrir la demande de fusion **sans la fusionner** :

```powershell
gh pr create --base main --head feature/aflp-observatoire-2027 --title "Observatoire agronomique AFLP 2027 (module isolé, désactivé par défaut)" --body-file $HOME\Downloads\PR_observatoire.md --draft
```

Sans `gh` : GitHub > onglet *Pull requests* > *New pull request* > base `main`, compare `feature/aflp-observatoire-2027` > coller le contenu de `PR_observatoire.md` > *Create draft pull request*.

## Si le commit de base `3686cb1` n'est pas dans votre clone

`git fetch origin` d'abord. S'il manque toujours, `main` a été réécrit : ne forcez rien, appliquez les correctifs un par un avec `git am patches\*.patch` sur une branche créée depuis `main`, et signalez les conflits.

## Ce que cette procédure ne fait pas

Elle ne fusionne pas dans `main`, n'applique aucune migration et ne déploie rien. La mise en ligne suit la demande unique de validation (`DEMANDE_MISE_EN_PRODUCTION.md`).

## Deuxième branche : correctif de sécurité « photos » (à publier séparément)

```powershell
git bundle verify $HOME\Downloads\fbms-correctif-photos.bundle
git fetch $HOME\Downloads\fbms-correctif-photos.bundle fix/photos-urls-signees:fix/photos-urls-signees
git push -u origin fix/photos-urls-signees
gh pr create --base main --head fix/photos-urls-signees --title "Sécurité photos : affichage par URL signées (étape 1)" --body "Préalable à la fermeture du bucket photos. Voir docs/securite/ANOMALIE_BUCKET_PHOTOS.md. Sans effet visible tant que le bucket reste public." --draft
```

Cette branche peut être fusionnée avant l'Observatoire : elle ne dépend de rien et ne change rien tant que le bucket est public.
