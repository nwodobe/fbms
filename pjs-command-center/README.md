# PJS Command Center

**One Workspace. Every Project. Every AI.**

Poste de commande unique pour ANAGROCI / PJS Global : un tableau de bord
premium qui organise l'espace de travail `C:\PJS`, détecte les applications
installées sur le PC et les lance en un clic (ChatGPT, Claude, Excel, Outlook,
VS Code, GitHub Desktop…), avec un assistant qui exécute des séquences
complètes (« Analyse les achats », « Corrige RCN Trace »…).

## Architecture

```
                 PJS COMMAND CENTER (index.html)
                            │
              fenêtre application Edge (mode bureau)
                            │
                  PJS Bridge (PowerShell, localhost)
        ┌───────────────────┼───────────────────┐
   Lancement apps      Détection apps      Dossiers C:\PJS
   (liste blanche)     (registre + chemins)  (liste blanche)
```

- **Aucune dépendance** : pas de Node.js, pas d'Electron. Windows + Edge suffisent.
- **Sécurisé par conception** : le bridge n'écoute que sur la boucle locale (`localhost`), exige un
  jeton de session généré à chaque lancement, et n'exécute **que** des actions
  en liste blanche (aucune commande arbitraire, aucun chemin libre).
- **Deux modes** : ouvert depuis le raccourci Bureau → mode bureau complet ;
  ouvert depuis le site hébergé → mode web (liens uniquement).

## Installation (Windows)

1. Récupérer le dossier `pjs-command-center` sur le PC (via GitHub Desktop,
   `git clone`, ou GitHub → *Code* → *Download ZIP*).
2. Ouvrir **PowerShell** dans ce dossier :
   ```powershell
   cd "$HOME\Downloads\fbms\pjs-command-center"   # adapter le chemin
   ```
3. Autoriser les scripts locaux (une seule fois) :
   ```powershell
   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
   ```
4. Lancer l'installation :
   ```powershell
   .\Install-PJS-Command-Center.ps1
   ```

L'installateur :
- crée l'espace `C:\PJS` avec les 15 dossiers (`01 Dashboard` → `15 Secrets`) ;
- installe l'application dans `C:\PJS\01 Dashboard\App` ;
- crée le raccourci **PJS Command Center** sur le Bureau.

## Utilisation

Double-cliquer sur le raccourci **PJS Command Center** : le bridge démarre en
arrière-plan et le tableau de bord s'ouvre en fenêtre application.

- **Pastilles vertes** : application détectée sur le poste → bouton *Lancer*.
- **Pastilles orange** : application web → bouton *Web*.
- **Assistant** : taper une commande (« Prépare le rapport de Bouaké ») ou
  cliquer une suggestion ; la séquence d'outils s'ouvre étape par étape.
- **Espace PJS** : ouvre directement les dossiers de `C:\PJS`.

## Configuration

`pjs.config.json` (dans `C:\PJS\01 Dashboard\App`) :

```json
{
  "userName":  "Monsieur KOUASSI",
  "workspace": "C:\\PJS",
  "siteUrl":   "https://nwodobe.github.io/fbms/",
  "githubRepo":  "https://github.com/nwodobe/fbms",
  "supabaseUrl": "https://supabase.com/dashboard"
}
```

## Feuille de route

| Phase | Contenu | Statut |
|---|---|---|
| 1 | Architecture, espace `C:\PJS`, installateur | ✅ v1 |
| 2 | Interface graphique premium | ✅ v1 |
| 3 | Lanceur d'applications Windows (bridge sécurisé) | ✅ v1 |
| 4 | Gestionnaire de projets (FBMS, RCN Trace…) | ✅ v1 (lancement) |
| 5 | Tableau de bord KPI (données FBMS/Supabase) | ⏳ |
| 6 | Connexion GitHub & Supabase (statuts, sync) | ⏳ |
| 7 | Centre documentaire (Excel, Word, PowerPoint) | ⏳ |
| 8 | Agent IA avec exécution de tâches validées | ⏳ (v1 : workflows d'ouverture) |
| 9 | Automatisations & workflows | ⏳ |
| 10 | Déploiement & maintenance | ⏳ |

## Principes de sécurité

Le Command Center est un **orchestrateur** : il ne donne jamais à une IA le
contrôle direct du PC. Toute action passe par la liste blanche du bridge, et
les opérations sensibles (envoi d'e-mails, suppression, publication de code)
resteront soumises à validation humaine dans les phases suivantes.
