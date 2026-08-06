#!/usr/bin/env bash
# ============================================================================
# FBMS — Hook PreToolUse : bloque toute écriture (Edit/Write/MultiEdit) sur un
# chemin protégé par la denylist des agents.
#
# Protocole Claude Code : le hook reçoit l'appel d'outil en JSON sur stdin.
# - sortie 0  => autorise l'action
# - sortie 2  => BLOQUE l'action, le message stderr est renvoyé à l'agent
#
# La denylist fait foi : .github/agent-policy/auto-merge-denylist.txt
# (fallback : liste minimale intégrée si le fichier est absent).
# ============================================================================
set -euo pipefail

INPUT="$(cat 2>/dev/null || true)"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
DENY="$ROOT/.github/agent-policy/auto-merge-denylist.txt"

# Extraire file_path de l'appel d'outil (Edit/Write/MultiEdit).
FILE="$(printf '%s' "$INPUT" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    print(""); sys.exit(0)
ti = d.get("tool_input", d)
print(ti.get("file_path") or ti.get("path") or "")
' 2>/dev/null || true)"

# Rien à vérifier -> autoriser.
[ -z "${FILE:-}" ] && exit 0

# Chemin relatif au dépôt.
REL="${FILE#"$ROOT"/}"

deny_hit() {
  python3 - "$REL" "$DENY" <<'PY'
import sys, os, re
rel, deny = sys.argv[1], sys.argv[2]
# `lstrip("./")` retirait TOUT caractère '.' ou '/' en tête, pas le préfixe :
# « .github/workflows/x.yml » devenait « github/workflows/x.yml », qui ne
# correspond plus à `.github/workflows/**`. Résultat : chaque répertoire
# commençant par un point — donc TOUTE l'infrastructure d'agents — échappait
# au garde-fou. On retire uniquement le préfixe « ./ ».
while rel.startswith("./"):
    rel = rel[2:]
pats = []
if os.path.exists(deny):
    for line in open(deny, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#"):
            pats.append(line)
else:
    pats = [".github/**",".claude/**","supabase/**","savoir-plus/**",
            "shared/auth-gate.js","**/.env","**/*.key","**/*.pem"]
# Traduction glob -> expression régulière, IDENTIQUE à celle de
# `.github/scripts/verifier-eligibilite-autofix.mjs`. C'est le point important :
# si le hook et la porte d'intégration continue n'interprètent pas les mêmes
# motifs de la même façon, la politique dit deux choses différentes selon
# l'endroit où on la lit — et c'est la lecture la plus permissive qui gagne.
#
# `fnmatch` était employé ici, mais son « * » traverse les « / » : le motif
# « .github/* », censé viser les fichiers posés directement dans .github/,
# bloquait aussi .github/agent-tests/**, que l'allowlist doit ouvrir.
def vers_regex(motif):
    corps = re.escape(motif)
    corps = corps.replace(r"\*\*", "\0")   # ** : traverse les séparateurs
    corps = corps.replace(r"\*", "[^/]*")  # *  : un seul segment
    corps = corps.replace(r"\?", ".")
    corps = corps.replace("\0", ".*")
    return re.compile("^" + corps + "$")

def match(rel, pat):
    if vers_regex(pat).match(rel):
        return True
    # « dir/** » couvre aussi le répertoire lui-même.
    if pat.endswith("/**") and rel == pat[:-3]:
        return True
    return False

sys.exit(0 if any(match(rel, p) for p in pats) else 1)
PY
}

if deny_hit; then
  echo "BLOQUÉ par la politique agents : '$REL' est dans auto-merge-denylist.txt." >&2
  echo "Zone sensible (CI, agents, auth, secrets, API, déploiement, savoir-plus)." >&2
  echo "Une modification ici exige le label 'human-review' et une intervention humaine." >&2
  exit 2
fi

exit 0
