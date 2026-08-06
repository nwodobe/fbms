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
import sys, fnmatch, os
rel, deny = sys.argv[1], sys.argv[2]
rel = rel.lstrip("./")
pats = []
if os.path.exists(deny):
    for line in open(deny, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#"):
            pats.append(line)
else:
    pats = [".github/**",".claude/**","supabase/**","savoir-plus/**",
            "shared/auth-gate.js","**/.env","**/*.key","**/*.pem"]
def match(rel, pat):
    if fnmatch.fnmatch(rel, pat):
        return True
    # '**' -> couvre aussi les préfixes de répertoire (dir/** == dir + tout dessous)
    if pat.endswith("/**") and (rel == pat[:-3] or fnmatch.fnmatch(rel, pat[:-3] + "/*")):
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
