# Tests de charge — mode d'emploi et précautions

## 1. À lire avant toute exécution contre la production

**ANAGROCI FBMS n'a qu'un seul environnement : la production.**

Il n'y a ni instance de développement, ni préproduction, ni base de test. Le dépôt est publié
directement par GitHub Pages depuis `main`, et toutes les pages pointent vers le **même projet
Supabase** (`jmbdgpdthzpszfnddwzi`). Un test d'écriture lancé contre cette cible crée des lignes
réelles dans la base qui sert la campagne RCN en cours.

Conséquence pratique :

| Scénario | Écrit-il en base ? | Peut-on le lancer contre la production ? |
|---|---|---|
| `04-statique.js` | Non — télécharge des fichiers publics | **Oui, sans réserve** |
| `01-paliers.js` avec `-e ECRITURE=0` | Non | Oui, sous réserve du §2 |
| `02-montee.js` avec `-e ECRITURE=0` | Non | Oui, sous réserve du §2 |
| `03-pic.js` | Non (lecture seule par construction) | Oui, sous réserve du §2 |
| `01-paliers.js` / `02-montee.js` en mode écriture | **Oui** | **Non — voir §3** |
| `05-concurrence.js` | **Oui, et il modifie volontairement la même fiche village** | **Non — jamais** |

## 2. Même en lecture seule, une charge reste une charge

Cent utilisateurs virtuels qui lisent en boucle consomment le quota, le pool de connexions et
la bande passante du projet Supabase, aux dépens des agents réellement sur le terrain.

- Ne jamais lancer pendant les heures de collecte.
- Prévenir le Branch Manager avant.
- Commencer par `04-statique.js`, puis les paliers dans l'ordre croissant, en s'arrêtant au
  premier palier qui dégrade le service.
- Ne pas dépasser 100 utilisateurs sans accord explicite.

## 3. Écriture : ce qu'il faut mettre en place d'abord

Aucun test d'écriture n'a été exécuté contre la production pendant cette campagne, et il ne
faut pas le faire en l'état. Deux voies, par ordre de préférence :

### Voie A — un projet Supabase de test (recommandée)

1. Créer un second projet Supabase.
2. Y rejouer, dans l'ordre, `supabase/rls.sql`, `supabase/achats.sql`, `supabase/cash.sql`,
   `supabase/sacs.sql`, `supabase/rcntrace.sql` et les migrations `supabase/2026*.sql`.
3. Créer les cinq comptes de test (§4).
4. Charger un jeu de données de volume comparable à la production — c'est le point qui décide
   de la valeur du test : une base de 40 villages ne dira rien d'une base de 5 000.
5. Lancer la campagne complète, écriture comprise.

C'est aussi ce qui manque au projet en dehors des tests de charge : il n'existe aujourd'hui
aucun endroit où essayer une migration avant de la passer sur les données réelles.

### Voie B — branche Supabase éphémère

Si l'offre du projet le permet, une branche Supabase donne une copie du schéma sans toucher
aux données. Vérifier que la branche contient bien un volume représentatif.

### Ce qu'il ne faut pas faire

Lancer les scénarios d'écriture contre la production en se disant que les lignes
`TEST_LOAD_*` seront supprimées ensuite. Elles polluent les cumuls, les tableaux de bord et les
exports entre-temps, et `05-concurrence.js` **modifie une fiche village existante**.

## 4. Comptes de test attendus

Les scripts utilisent cinq comptes, un par rôle réel du projet :

| Rôle `profils.role` | Adresse |
|---|---|
| `Branch Manager` | `test.load.bm@example.invalid` |
| `Supervisor` | `test.load.sup@example.invalid` |
| `Agent Recenseur` | `test.load.agent@example.invalid` |
| `Consultation uniquement` | `test.load.dir@example.invalid` |
| `Agent Recenseur`, **inactif** | `test.load.off@example.invalid` |

Le domaine `.invalid` est réservé par la RFC 2606 : ces adresses ne peuvent joindre personne.

Le préfixe se change avec `-e COMPTE_PREFIXE=…`, le mot de passe commun avec
`-e MOT_DE_PASSE=…`. **Ne jamais écrire un mot de passe dans un fichier commis ni dans un
journal d'exécution.**

## 5. Exécution

### Contre l'émulateur local (défaut — aucun risque)

```bash
node tests/load/executer.mjs                      # campagne complète
node tests/load/executer.mjs --paliers 1,5,10     # sous-ensemble
node tests/load/executer.mjs --latence 150        # latence serveur simulée
node tests/load/executer.mjs --plafond 40         # pool de connexions simulé
```

Le lanceur démarre lui-même le serveur statique, l'émulateur Supabase et le jeu de données.
Résultats : `tests/reports/donnees/04-charge.json` et un fichier k6 par exécution.

### Contre une cible réelle

```bash
# 1. Toujours commencer par la couche statique — lecture seule
k6 run -e SITE=https://nwodobe.github.io/fbms tests/load/04-statique.js

# 2. Puis les paliers en lecture seule
k6 run -e SUPABASE_URL=https://<projet>.supabase.co \
       -e SUPABASE_KEY=<clé publiable> \
       -e MOT_DE_PASSE=<mot de passe des comptes de test> \
       -e ECRITURE=0 -e VUS=10 -e DUREE=60s \
       tests/load/01-paliers.js

# 3. Écriture : uniquement sur le projet de test (§3)
k6 run -e SUPABASE_URL=https://<projet-de-test>.supabase.co … tests/load/01-paliers.js
```

## 6. Prérequis

```bash
# k6 (non installé par défaut)
curl -sSL -o k6.tar.gz https://github.com/grafana/k6/releases/download/v0.55.0/k6-v0.55.0-linux-amd64.tar.gz
tar xzf k6.tar.gz && sudo cp k6-v0.55.0-linux-amd64/k6 /usr/local/bin/

# Playwright et le SDK Supabase, pour le banc et les tests navigateur
npm install --no-save playwright@1.49.1 @supabase/supabase-js@2.47.10
```

Aucun `package.json` n'est ajouté à la racine : `CLAUDE.md` §1 rappelle que ce dépôt n'a ni
construction ni gestionnaire de paquets, et rien ici ne le change. `node_modules/` est déjà
ignoré par `.gitignore`.

## 7. Nettoyage après un test d'écriture

Toutes les données produites portent le préfixe `TEST_LOAD_`.

```sql
-- À exécuter UNIQUEMENT sur le projet de test.
delete from public.achats            where local_id like 'TEST_LOAD%' or numero_recu like 'TEST_LOAD%';
delete from public.avances           where local_id like 'TEST_LOAD%';
delete from public.reconciliations   where local_id like 'TEST_LOAD%';
delete from public.villages          where village like 'TEST_LOAD%';
delete from public.producteurs       where code like 'TEST_LOAD%';
delete from public.rt                where id::text like 'TEST_LOAD%';
delete from public.audit_log         where details::text like '%TEST_LOAD%';
```

`05-concurrence.js` **modifie** la fiche village `00000000-0000-4000-8000-100000000001` au lieu
d'en créer une : sur une base réelle, cette fiche serait une vraie fiche. Raison de plus pour
ne jamais lancer ce scénario ailleurs que sur un projet de test.
