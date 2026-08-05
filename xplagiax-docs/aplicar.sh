#!/usr/bin/env bash
# Aplica los cambios sobre UryxSoft/xplagiax_webextension.
# Uso:  bash aplicar.sh /ruta/al/repo
set -euo pipefail

REPO="${1:-.}"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAMA="claude/ai-content-detection-platform-k3pa7d"
BASE="9588f53"

cd "$REPO"
git rev-parse --git-dir >/dev/null 2>&1 || { echo "ERROR: $REPO no es un repositorio git"; exit 1; }

if ! git cat-file -e "$BASE^{commit}" 2>/dev/null; then
  echo "ERROR: no encuentro el commit base $BASE. Ejecuta: git fetch origin main"; exit 1
fi

[ -z "$(git status --porcelain)" ] || { echo "ERROR: hay cambios sin confirmar. Haz commit o stash primero."; exit 1; }

echo "==> Creando rama $RAMA desde $BASE"
git checkout -B "$RAMA" "$BASE"

echo "==> Aplicando el parche"
git am --3way < "$AQUI/cambios.patch"

echo
echo "OK. Resultado:"
git log --oneline -2
echo
echo "Comprobacion de estructura:"
for p in docs/00-resumen-ejecutivo.md docs/adr/ADR-010-extinction-gpl.md README.md .gitignore; do
  [ -e "$p" ] && echo "  ok   $p" || echo "  FALTA $p"
done
for p in pkg cambios_extension.tar.gz; do
  [ -e "$p" ] && echo "  AUN EXISTE (deberia haberse borrado): $p" || echo "  ok   $p eliminado"
done
echo
echo "Si todo esta correcto:  git push -u origin $RAMA"
