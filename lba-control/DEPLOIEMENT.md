# Déploiement — mode d'emploi

Ce document donne les valeurs exactes à saisir, dans l'ordre. Tout ce qui pouvait être mis dans le
dépôt y est (`vercel.json`, `public/_redirects`, `public/_headers`) ; ce qui reste demande un accès
que le code n'a pas — un compte d'hébergement et le tableau de bord Supabase.

---

## Où se trouve le code

| | |
| --- | --- |
| Dépôt | `nwodobe/fbms` — https://github.com/nwodobe/fbms |
| Branche | `claude/lba-control-saas-architecture-5ctrf3` |
| Répertoire du projet | `lba-control/` |

⚠️ **La branche par défaut `main` ne contient pas cette application.** Elle héberge un autre projet
(FBMS, en HTML statique). L'hébergeur doit donc être pointé explicitement sur la branche ci-dessus,
sinon il déploiera le mauvais projet sans le moindre message d'erreur.

⚠️ **Le dépôt est public.** Aucun secret n'y figure — un test (`tests/unit/no-secrets.test.ts`) le
vérifie à chaque exécution, et seules les clés publiables sont utilisées. Mais le code source
complet est lisible par n'importe qui. Le rendre privé se fait dans *Settings → General → Danger
Zone → Change visibility*.

---

## 1. Variables d'environnement

Deux, et deux seulement. Les mêmes pour Vercel et Cloudflare Pages.

```
VITE_SUPABASE_URL              = https://fpraewmywcqwrjpcfzln.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY  = sb_publishable_MYdrMmI5cqP25pjTr9f_Eg_N_lg-3br
```

Ces deux valeurs sont **publiques par construction** : elles finissent dans le fichier JavaScript
téléchargé par chaque navigateur. C'est sans danger — la clé publiable n'a aucun pouvoir propre,
tout est protégé par Row Level Security.

La clé `service_role`, elle, ne doit **jamais** être renseignée ici. Elle contourne RLS : placée
dans une variable préfixée `VITE_`, elle exposerait les données de tous les clients à quiconque
ouvre les outils de développement du navigateur.

---

## 2. Vercel

*Add New → Project → Import* `nwodobe/fbms`, puis :

| Réglage | Valeur |
| --- | --- |
| Root Directory | `lba-control` |
| Framework Preset | Vite *(détecté)* |
| Build Command | `npm run build` *(depuis `vercel.json`)* |
| Output Directory | `dist` *(depuis `vercel.json`)* |
| Production Branch | `claude/lba-control-saas-architecture-5ctrf3` |

*Settings → Environment Variables* : les deux variables du §1, portée **Production** et **Preview**.

`vercel.json` fournit déjà la réécriture SPA et les en-têtes de sécurité : rien à saisir de ce
côté.

## 2 bis. Cloudflare Pages

*Workers & Pages → Create → Pages → Connect to Git* → `nwodobe/fbms`, puis :

| Réglage | Valeur |
| --- | --- |
| Production branch | `claude/lba-control-saas-architecture-5ctrf3` |
| Framework preset | Vite |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | `lba-control` |

Variables du §1 dans *Settings → Environment variables*, pour **Production** et **Preview**.

`public/_redirects` et `public/_headers` sont recopiés dans `dist/` par le build : la réécriture SPA
et les en-têtes s'appliquent sans réglage supplémentaire.

---

## 3. Supabase Authentication — URL de retour

*Authentication → URL Configuration*, en remplaçant `<votre-domaine>` par l'adresse rendue par
l'hébergeur.

**Site URL**

```
https://<votre-domaine>
```

**Redirect URLs** — les trois lignes, sans en omettre une :

```
https://<votre-domaine>/mot-de-passe
https://<votre-domaine>/invitation/*
https://<votre-domaine>/activation
```

À quoi sert chacune :

- `/mot-de-passe` reçoit le lien de réinitialisation. Sans elle, le lien reçu par courriel renvoie
  sur l'accueil et le mot de passe ne peut jamais être changé ;
- `/invitation/*` — l'astérisque est nécessaire : le jeton fait partie du chemin ;
- `/activation` reçoit les retours après confirmation d'adresse.

Une adresse absente de cette liste n'échoue pas bruyamment : Supabase redirige silencieusement vers
la Site URL. Le symptôme est un lien « qui ne fait rien », sans message.

---

## 4. Vérification, dans cet ordre

1. `https://<votre-domaine>/connexion` s'ouvre sans être connecté et affiche le formulaire ;
2. `https://<votre-domaine>/invitation/xxx` s'ouvre aussi — c'est le test de la réécriture SPA. Une
   404 ici signifie que le `_redirects` ou le `rewrites` n'a pas pris ;
3. connexion avec le compte administrateur de plateforme → la **console plateforme** doit s'ouvrir ;
4. si vous arrivez sur `/activation`, dépliez « Ce que porte votre jeton d'accès » :

| Affichage | Conclusion |
| --- | --- |
| rôle `super_admin` | Le déclencheur fonctionne |
| rôle `—`, base `aucune ligne` | Le déclencheur n'écrit rien : *Authentication → Hooks* n'est pas activé |

---

## Ce qui ne peut pas être fait depuis le dépôt

Trois choses demandent des accès que le code n'a pas, et aucune ne peut être automatisée ici :

| Action | Pourquoi |
| --- | --- |
| Créer le déploiement | Aucun compte ni jeton Vercel/Cloudflare ; l'environnement d'exécution n'atteint pas ces hôtes |
| Régler les URL Supabase | Configuration du tableau de bord, absente de la base et de l'API accessible |
| Créer un dépôt `lba-control` privé | L'intégration GitHub de cette session ne peut pas créer de dépôt (`403`) |
