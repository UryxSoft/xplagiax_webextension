#!/usr/bin/env bash
# Aplica el detector de texto IA sobre el repositorio.
#
# Copia ficheros; no usa `git am`. Es deliberado: los parches chocaban una y
# otra vez porque main se movía entre entregas, y porque main lleva marcas de
# conflicto commiteadas que ningún merge a tres bandas resuelve solo. Copiar es
# idempotente: se puede repetir sin romper nada.
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(git rev-parse --show-toplevel)"

echo "→ repositorio: $RAIZ"

if [ -d "$RAIZ/.git/rebase-apply" ]; then
  echo "→ hay un 'git am' a medias; abortándolo"
  git -C "$RAIZ" am --abort || true
fi

echo "→ copiando $(find "$AQUI/ficheros" -type f | wc -l) ficheros"
cp -r "$AQUI/ficheros/." "$RAIZ/"

# El paquete de entrega no es código y no debe acabar commiteado. Ya pasó.
rm -rf "$RAIZ/cambios" "$RAIZ/cambios.tar.gz" "$RAIZ/parches" "$RAIZ/parches.tar.gz"
git -C "$RAIZ" rm -r -q --cached cambios cambios.tar.gz parches parches.tar.gz 2>/dev/null || true

echo "→ comprobando que no quedan marcas de conflicto"
if grep -rIl --exclude-dir=node_modules --exclude-dir=.git \
     --exclude-dir=distil-ai-slop-detector-main \
     -E '^<<<<<<< |^>>>>>>> ' "$RAIZ" 2>/dev/null; then
  echo "  ✗ quedan marcas en los ficheros de arriba"
  exit 1
fi
echo "  ✓ ninguna"

echo "→ pnpm install"
(cd "$RAIZ" && pnpm install)

cat <<'FIN'

Listo. Verifica y construye:

  pnpm exec vitest run                        # 339 tests
  pnpm -r typecheck                           # 8 paquetes
  pnpm --filter @xpx/extension build:chrome   # → chrome_extension/
  pnpm --filter @xpx/extension zip            # → .output/*.zip

Para PROBAR el detector de texto:
  1. chrome://extensions → recarga la extensión (importante: hay código nuevo)
  2. Abre una página con texto EN INGLÉS
  3. Pulsa el icono → "Análisis profundo"
  4. La primera vez descarga 253 MB. Puede tardar varios minutos.
FIN
