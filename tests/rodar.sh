#!/usr/bin/env bash
# Roda a suíte completa. Sobe um servidor temporário e o derruba no final.
#
#   ./tests/rodar.sh [porta]
set -euo pipefail

cd "$(dirname "$0")/.."
PORTA="${1:-8123}"
BASE="http://localhost:${PORTA}/"

echo "== gerando dados sintéticos"
python3 tests/gerar_sinteticos.py
python3 tests/gerar_sintaxes.py
python3 tests/gerar_pixels.py

echo "== subindo servidor em ${BASE}"
python3 scripts/serve.py "$PORTA" >/dev/null 2>&1 &
SERVIDOR=$!
trap 'kill "$SERVIDOR" 2>/dev/null || true' EXIT
sleep 2

falhas=0

echo
echo "== tests/verificar_recortes.py"
python3 tests/verificar_recortes.py || falhas=$((falhas + 1))

for teste in tests/test_orientacao.mjs tests/test_convencao.mjs \
             tests/test_sintaxes.mjs tests/test_pixels.mjs \
             tests/test_seguranca.mjs tests/test_ponteiro.mjs; do
  echo
  echo "== $teste"
  node "$teste" "$BASE" || falhas=$((falhas + 1))
done

echo
if [ "$falhas" -eq 0 ]; then
  echo "tudo certo"
else
  echo "$falhas arquivo(s) de teste com falha"
fi
exit "$falhas"
