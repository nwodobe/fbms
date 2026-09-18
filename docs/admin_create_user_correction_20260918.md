# Creation des acces FBMS : correctif prepare, non deploye

Date : 18 septembre 2026. Branche : `fix/admin-create-user-end-to-end`.
Base inspectee : `6536d8ef1cd81960a03560aedd728e38eb0b15e8` (main).

**Statut : implementation sur branche et tests locaux termines. Recette Auth/RLS distante, connexion du collaborateur et deploiement NON EFFECTUES. Ne pas fusionner ni deployer avant revue, recette reelle et accord explicite.**

## 1. Etat initial constate

Les controles Supabase ont ete effectues en lecture seule sur `FIELD BUYING ANAGROCI`, reference `jmbdgpdthzpszfnddwzi`.

| Element | Constat et limite |
|---|---|
| Projet | ACTIVE_HEALTHY au controle |
| Fonction `admin-create-user` | Absente des fonctions Edge deployees au controle |
| Source de la fonction | Presente dans le repository mais non mise en service |
| Formulaire | Appelle `/functions/v1/admin-create-user`; certaines erreurs reseau deviennent le meme message generique |
| Prerequis SQL | `fbms_roles_attribuables`, garde et journal des profils presents dans la base consultee |
| RLS des profils | INSERT/UPDATE/DELETE gardes par les regles BM; aucune policy modifiee par ce lot |
| Trigger automatique Auth | Aucun trigger non interne trouve sur `auth.users` au controle |
| Zonal Head | Attribuable, portee globale, cluster non obligatoire dans le referentiel serveur |
| Environnement de test heberge | Ancienne branche de test INACTIVE / MIGRATIONS_FAILED; pas de staging utilisable identifie |
| Navigateur vers GitHub Pages | Navigation refusee par l'environnement de controle (`ERR_BLOCKED_BY_ADMINISTRATOR`); cela ne prouve pas une panne du site |
| Secrets deployes | Presence et valeurs non verifiees; aucune cle privilegiee demandee ou affichee |

L'absence de la fonction constitue un blocage reel. Le mecanisme exact de l'erreur observee sur le navigateur du BM (HTTP, CORS, passerelle) reste a capturer. Aucune comparaison octet par octet du HTML actuellement servi par GitHub Pages n'a ete possible.

## 2. Modifications preparees

### Fonction serveur

`index.ts` conserve le point d'entree Supabase et delegue la logique a `handler.ts`. Ce n'est pas un deuxieme circuit de creation : un seul endpoint existe.

Le controle verifie l'identite par `getUser(token)`, le profil BM actif, le role attribuable obtenu du serveur et le cluster valide quand il est requis. Les champs privilegies du payload ne sont pas transmis au profil.

La creation Auth utilise le client privilegie cote serveur. L'INSERT de profil utilise la session du BM pour conserver RLS, garde et journal des habilitations. Les clients n'enregistrent ni session persistante ni renouvellement automatique cote serveur.

Le code accepte les variables standard Supabase et conserve la compatibilite avec `SERVICE_ROLE_KEY` si ce secret personnalise est configure. Une configuration absente produit une erreur controlee. Aucun secret n'est embarque dans le frontend.

Les origines navigateur sont configurees par `ADMIN_ALLOWED_ORIGINS`, valeur par defaut `https://nwodobe.github.io`. OPTIONS est traite avant la logique d'identite; POST exige toujours l'identite valide. Une origine autorisee ne remplace pas une permission.

### Coherence Auth + profil

Le succes exige un profil conforme. Apres une insertion au resultat incertain, une relecture ciblee peut confirmer le succes. Un profil divergent ou une lecture impossible provoque une alerte de coherence, sans suppression aveugle.

Si l'absence du profil est confirmee, la compensation ne vise que l'UUID retourne par la creation Auth de cette tentative. L'absence finale du compte Auth est verifiee. Un echec de compensation est signale, jamais transforme en succes.

**Ce parcours n'est pas une transaction atomique et ne garantit pas une livraison exactement une fois.** La protection double-clic est frontend et l'unicite des comptes depend d'Auth. Un resultat inconnu demande verification; un email existant ne constitue pas une preuve du succes d'une tentative precedente.

Les journaux du nouveau handler ne contiennent que reference, etape, code et, si necessaire, l'UUID nouvellement cree. Aucune donnee du formulaire, mot de passe ou jeton n'y est journalise.

### Formulaire

Le mot de passe est masque par defaut et peut etre affiche explicitement. Le bouton bloque les doubles soumissions. La session est verifiee avant l'appel et renouvelee si elle approche de son expiration.

Les erreurs distinguent service absent, session invalide, droits insuffisants, email existant, role/cluster refuse et coherence a verifier. Le detail technique expose un code, un statut HTTP et une reference sure, jamais une erreur distante brute contenant potentiellement des secrets.

Le mot de passe est efface apres succes. Une panne d'actualisation de la liste ne transforme pas une creation confirmee en echec. Le compte doit etre verifie avant toute nouvelle tentative apres une coupure.

## 3. Tests effectivement executes

| Controle | Resultat | Ce que cela ne prouve pas |
|---|---:|---|
| Logique du handler : Node avec services Supabase doubles | 47/47 reussis | Pas d'Auth distant, pas de RLS reelle ni de concurrence serveur prouvee |
| Formulaire Chromium : 12 scenarios a 3 tailles | 36/36 reussis | SDK, session et fetch simules; pas de transport CORS ni d'auth-gate reel |
| Tailles navigateur | 390x844, 768x1024, 1440x900 | Captures avec comptes fictifs, pas de session de production |
| TypeScript strict du coeur `handler.ts` | 0 diagnostic | Point d'entree Deno et resolution SDK distante non verifies |
| Syntaxe JavaScript du formulaire | Reussie | Ne remplace pas une recette d'integration |
| Creation puis connexion reelles en staging | NON TESTE | Ancien staging inactif; aucun compte reel cree |
| CORS et validation JWT de la passerelle Supabase | NON TESTE | A verifier sur endpoint deploye en environnement de test |
| Site GitHub Pages publie | NON TESTE | Acces navigateur bloque par l'environnement |

Les tests comprennent les refus de droits, le compte inactif, les roles interdits, le cluster manquant/inconnu, l'email existant, le mot de passe refuse, le double clic, la session expiree, les reponses incompletes et les echecs de profil/compensation.

Les 83 executions locales ne sont PAS 83 operations reelles contre Supabase. Les tests ne sont pas automatiquement branches a la CI; ils sont executables directement.

## 4. Reproduire les tests locaux

Prerequis : Node 22 avec TypeScript 5.8.3 accessible a `require('typescript')`; Python avec Playwright et Chromium. Installer les outils dans un environnement de test, pas dans un nouveau gestionnaire de paquets a la racine du depot.

```sh
node --test tests/admin-create-user-unit.cjs
python tests/admin-create-user-browser.py
```

`CHROMIUM_PATH` permet de choisir le navigateur. `ADMIN_TEST_OUTPUT` permet de choisir le repertoire des captures et du rapport JSON. Le test navigateur n'effectue aucun appel externe.

## 5. Conditions avant mise en service

1. Disposer d'un environnement Auth/Postgres/Edge de test. Ne pas reactiver une branche payante ni creer des comptes de production sans accord.
2. Verifier le point d'entree dans Deno, les dependances SDK et les secrets requis sans afficher leurs valeurs.
3. Deployer sur TEST avec validation JWT active; verifier les reponses OPTIONS, POST, origine et erreurs de passerelle. Ne pas utiliser `--no-verify-jwt` pour contourner un refus.
4. Rejouer avec une vraie session BM de test : creation Auth + profil, compte inactif/non BM refuse, doublon email refuse, cluster requis, Zonal Head sans cluster.
5. Se connecter avec le collaborateur de test dans une session distincte; verifier role, acces et audit.
6. Presenter les resultats et obtenir l'accord explicite avant deploiement production et publication frontend.
7. Apres accord, deployer la nouvelle fonction AVANT le nouveau formulaire. L'ancien formulaire accepte une reponse 201 enrichie; le nouveau formulaire exige `profile_verified` et refuserait a raison d'annoncer un succes avec l'ancienne reponse incomplete.
8. Verifier la version reellement servie par GitHub Pages et le parcours navigateur. Une creation reelle en production exige une confirmation separee du collaborateur.

## 6. Retour arriere et risques residuels

Aucune migration SQL, aucun changement RLS, aucun compte, role ou stock de production n'a ete modifie.

Si la recette echoue, ne pas fusionner. Si une anomalie apparait apres une publication autorisee, retirer temporairement la creation de comptes ou revenir a la version revue precedente. Ne jamais supprimer en masse les comptes crees ni desactiver RLS pour revenir en arriere.

La politique existante `email_confirm: true` reste conservee. Ce lot n'ajoute ni invitation email ni changement obligatoire du mot de passe a la premiere connexion; le mode de remise des identifiants reste a valider.

La relecture avant compensation n'est pas un verrou distribue contre toutes les courses possibles. Les cas de resultat incertain sont signales et requierent une verification administrateur. Aucune garantie d'idempotence serveur globale n'est revendiquee.

Les regles de role et de perimetre existantes sont reutilisees, pas reeditees. `shared/auth-gate.js`, les workflows, les stocks et les mouvements Sacherie restent hors modification.

## 7. Sources techniques

Code de depart : `shared/admin.html`, `supabase/functions/admin-create-user/index.ts`, `shared/auth-gate.js` au commit de base. Lecture des definitions SQL et de la liste des fonctions sur le projet cible, sans ecriture.

Documentation officielle consultee pour la preparation :
- https://supabase.com/docs/guides/functions/auth
- https://supabase.com/docs/guides/functions/secrets
- https://supabase.com/docs/guides/functions/cors
- https://supabase.com/docs/reference/javascript/auth-admin-createuser

**Conclusion : correctif propose et teste localement. Le blocage de production n'est pas declare resolu.**
