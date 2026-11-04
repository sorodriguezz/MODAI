#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
DEST="${1:-backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
COMPOSE="docker compose ${COMPOSE_FILES:--f deploy/compose.yaml}"
mkdir -p "$DEST"

$COMPOSE exec -T --user node server node -e "
const Database = require('better-sqlite3');
const db = new Database(process.env.MODAI_DATABASE_PATH);
db.backup('/app/data/.modai-backup.db').then(() => db.close()).catch(error => { console.error(error.message); process.exit(1); });
"
$COMPOSE cp server:/app/data/.modai-backup.db "$DEST/modai-$STAMP.db"
$COMPOSE exec -T --user node server rm -f /app/data/.modai-backup.db
ARTIFACTS="$($COMPOSE exec -T server printenv MODAI_ARTIFACT_DIR | tr -d '\r')"
$COMPOSE exec -T --user node server tar -C "$(dirname "$ARTIFACTS")" -czf - "$(basename "$ARTIFACTS")" > "$DEST/modai-artifacts-$STAMP.tgz"
echo "Respaldo listo: $DEST/modai-$STAMP.db y $DEST/modai-artifacts-$STAMP.tgz"
echo "Restaurar: detén el servidor, copia el .db como MODAI_DATABASE_PATH y extrae los artefactos en su carpeta."
