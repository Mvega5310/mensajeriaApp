#!/usr/bin/env bash
# Corre TODAS las pruebas del backend contra una base Postgres propia y desechable.
#
#   npm run test:all            (equivale a: bash scripts/test-db.sh)
#   bash scripts/test-db.sh -- --test-name-pattern=E3   (args extra van a node --test)
#
# Qué hace:
#   1. Crea la base `puertaya_test_<pid>` (una por ejecución; nunca se comparte).
#   2. Aplica el esquema con `prisma migrate deploy` (las 6 migraciones aplican
#      limpio en base vacía; es la misma vía que usa `npm start` en Railway).
#   3. Exporta DATABASE_URL (localhost) y corre `node --test`.
#   4. Destruye la base al terminar, también si las pruebas fallan o se interrumpe.
#
# Administración de Postgres (para crear/borrar la base):
#   - Si TEST_DB_ADMIN_URL está definida (p. ej. postgresql://postgres:pw@localhost:5432/postgres),
#     se usa con psql.
#   - Si no, y se corre como root, se usa `su postgres -c psql` (socket local).
#   - Si no, psql con el usuario actual (peer/trust local).
# El rol de las pruebas (puertaya_test) se crea si no existe. Host/puerto: TEST_DB_HOST
# (127.0.0.1) y TEST_DB_PORT (5432). La contraseña es solo de pruebas locales.
set -euo pipefail

cd "$(dirname "$0")/.."

DB_HOST="${TEST_DB_HOST:-127.0.0.1}"
DB_PORT="${TEST_DB_PORT:-5432}"
DB_ROL="puertaya_test"
DB_PASS="puertaya_test"
DB_NAME="puertaya_test_$$"

# El SQL entra por stdin para no pelear con el quoting de `su -c`.
admin_sql() {
  if [ -n "${TEST_DB_ADMIN_URL:-}" ]; then
    printf '%s\n' "$1" | psql "$TEST_DB_ADMIN_URL" -v ON_ERROR_STOP=1 -q
  elif [ "$(id -u)" = "0" ]; then
    printf '%s\n' "$1" | su postgres -c "psql -p $DB_PORT -d postgres -v ON_ERROR_STOP=1 -q"
  else
    printf '%s\n' "$1" | psql -p "$DB_PORT" -d postgres -v ON_ERROR_STOP=1 -q
  fi
}

BASE_CREADA=0
limpiar() {
  if [ "$BASE_CREADA" = "1" ]; then
    admin_sql "DROP DATABASE IF EXISTS \"$DB_NAME\" WITH (FORCE)" >/dev/null 2>&1 \
      || echo "[test-db] AVISO: no pude borrar la base $DB_NAME; bórrala a mano." >&2
  fi
}
trap limpiar EXIT
trap 'exit 130' INT TERM

if ! command -v psql >/dev/null 2>&1; then
  echo "[test-db] ERROR: psql no está instalado." >&2; exit 1
fi

admin_sql "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='$DB_ROL') THEN CREATE ROLE $DB_ROL LOGIN CREATEDB PASSWORD '$DB_PASS'; END IF; END \$\$;" \
  || { echo "[test-db] ERROR: ¿está Postgres encendido en el puerto $DB_PORT? (pg_ctlcluster 16 main start)" >&2; exit 1; }
admin_sql "CREATE DATABASE \"$DB_NAME\" OWNER $DB_ROL"
BASE_CREADA=1

export DATABASE_URL="postgresql://$DB_ROL:$DB_PASS@$DB_HOST:$DB_PORT/$DB_NAME"
export JWT_SECRET="${JWT_SECRET:-secreto-solo-de-pruebas}"
echo "[test-db] base $DB_NAME lista; aplicando migraciones..."
npx prisma migrate deploy >/dev/null

# Las pruebas de integración comparten esta única base y borran/crean datos:
# se corren de a un archivo a la vez (concurrencia 1) para que no se pisen.
[ "${1:-}" = "--" ] && shift
set +e
node --test --test-concurrency=1 "$@"
CODIGO=$?
set -e
exit "$CODIGO"
