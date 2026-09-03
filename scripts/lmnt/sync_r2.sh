#!/usr/bin/env bash
# Заливка ассетов LMNT™ в R2 (бакет apedroidz, домен assets.apedroidz.com).
#
#   ./scripts/lmnt/sync_r2.sh              весь каталог LMNT
#   ./scripts/lmnt/sync_r2.sh snkrs_01     только один дроп
#
# Раскладка: папка LMNT лежит на одном уровне с apedroidz, внутри папка на дроп,
# внутри неё папка на вещь. Имя папки вещи — это её slug в src/lib/lmnt.ts, и
# менять его в одном месте без другого нельзя: метаданные складывают адрес
# картинки из drop + slug.
#
#   LMNT/snkrs_01/element/image.webp        2048px, поле image в метаданных
#   LMNT/snkrs_01/element/preview.webp      512px, сетка инвентаря
#   LMNT/snkrs_01/element_super/…
#
# ВАЖНО про кэш. На зоне стоит Cache Rule с TTL в год, и права на очистку у
# нашего токена нет. Перезалив поверх того же адреса оставит в кэше старую
# картинку — у нас, у маркетплейсов и у всех, кто её уже видел. Поэтому
# поменялся арт — поднимаем ASSET_VERSION в src/lib/lmnt.ts, а не надеемся, что
# протухнет само.
set -euo pipefail
cd "$(dirname "$0")/../.."

SRC="R2/LMNT"
DST="r2:apedroidz/LMNT"
WHAT="${1:-}"

if [ -n "$WHAT" ]; then
  SRC="$SRC/$WHAT"
  DST="$DST/$WHAT"
fi

[ -d "$SRC" ] || { echo "нет каталога $SRC"; exit 1; }

echo "-- $SRC -> $DST"
rclone copy "$SRC" "$DST" \
  --include "*.webp" --transfers 8 --progress \
  --header-upload "Content-Type: image/webp"

echo
echo "проверка:"
echo "  curl -sI https://assets.apedroidz.com/LMNT/snkrs_01/element/image.webp | head -5"
