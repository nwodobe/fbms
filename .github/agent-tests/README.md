# Tests d'agents

Contrôles **exploratoires**, à distinguer des portes de `.github/scripts/`.

| | `.github/scripts/` | `.github/agent-tests/` (ici) |
|---|---|---|
| Rôle | Portes qualité | Parcours exploratoires |
| Bloque une fusion ? | **Oui** | **Non** — sortie toujours 0 |
| Mesure | L'état des pages au repos | Ce qui se passe quand on **agit** |
| Référentiel | Oui, pour séparer l'hérité du nouveau | Non |

Ce dossier est dans `.github/agent-policy/auto-merge-allowlist.txt` :
`auto-fix-agent` peut y ajouter un contrôle de non-régression sans qu'un humain
relise chaque ligne. C'est le seul endroit exécutable où cela lui est permis, et
c'est délibéré — un test qui échoue ne casse rien en production.

## `parcours-pratiques.mjs`

Rejoue, aux trois largeurs imposées (390×844, 768×1024, 1440×900), les gestes
qu'un utilisateur fait vraiment : suivre un lien, revenir en arrière,
actualiser, demander une URL qui n'existe pas, naviguer au clavier, soumettre un
formulaire vide, subir un réseau lent.

```bash
# Contre une copie locale
node /chemin/vers/serveur-statique.mjs . 4501 &
node .github/agent-tests/parcours-pratiques.mjs \
  --base http://127.0.0.1:4501 --preuves preuves/ --json parcours.json

# Contre la production
node .github/agent-tests/parcours-pratiques.mjs \
  --base https://nwodobe.github.io/fbms --preuves preuves/
```

Chaque constat porte l'un de trois statuts, et le troisième est le plus utile :

- `ok` — le parcours se déroule ;
- `defaut` — quelque chose ne va pas, avec la valeur mesurée ;
- `non-concluant` — le contrôle **n'a pas pu s'exécuter**. Par exemple : aucun
  `<form>` sur la page d'accueil publique, donc rien à valider.

Un `non-concluant` compté comme `ok` est un mensonge commode : il transforme
« je n'ai pas pu vérifier » en « j'ai vérifié, tout va bien ». C'est exactement
ce qui fait qu'on découvre un défaut en production alors que le rapport était
vert.
