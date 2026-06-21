#!/usr/bin/env bash
#
# Bring pgvector to >= 0.8.0 on the Maestro VM and rebuild HNSW indexes.
#
# pgvector 0.8.0 introduced the `hnsw.iterative_scan` GUC that referenceRepo's
# scoped retrieval sets per query. Older installs reject that statement and abort
# the search transaction (the "Failed query: SET LOCAL hnsw.iterative_scan ..."
# error). This script installs a new-enough pgvector (via apt, or builds from
# source if apt is too old), upgrades the extension in-place, and rebuilds the
# HNSW index(es) so the new version's on-disk format is used.
#
# Safe to run by hand on the VM:
#   bash /opt/maestro/scripts/upgrade_pgvector.sh
#
# Requirements: apt-installed PostgreSQL and passwordless sudo for `postgres`/apt.
set -euo pipefail

DB="${PGDATABASE:-maestronexus}"
MIN_VERSION="0.8.0"

# True when $1 >= $2 (semantic version compare).
ver_ge() { [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n1)" = "$2" ]; }

psql_val() { sudo -u postgres psql -d "$DB" -tAc "$1" | tr -d '[:space:]'; }
current_version() { psql_val "SELECT extversion FROM pg_extension WHERE extname='vector';"; }
avail_max() { psql_val "SELECT max(version) FROM pg_available_extension_versions WHERE name='vector';"; }

PG_MAJOR="$(ls /usr/lib/postgresql 2>/dev/null | sort -n | tail -1)"
echo "[pgvector] PostgreSQL major: ${PG_MAJOR:-unknown}"
echo "[pgvector] installed extension version: $(current_version || echo none)"
echo "[pgvector] max available on disk:        $(avail_max || echo none)"

# 1) Ensure a pgvector >= MIN_VERSION control file is available for this PG major.
AVAIL="$(avail_max || true)"
if [ -z "$AVAIL" ] || ! ver_ge "$AVAIL" "$MIN_VERSION"; then
  echo "[pgvector] need pgvector >= $MIN_VERSION on disk; resolving via apt ..."
  sudo apt-get update -y
  CAND="$(apt-cache policy "postgresql-${PG_MAJOR}-pgvector" 2>/dev/null | awk '/Candidate:/{print $2}')"
  CAND_NUM="$(printf '%s' "${CAND:-}" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
  echo "[pgvector] apt candidate for postgresql-${PG_MAJOR}-pgvector: ${CAND:-none}"
  if [ -n "$CAND_NUM" ] && ver_ge "$CAND_NUM" "$MIN_VERSION"; then
    sudo apt-get install -y "postgresql-${PG_MAJOR}-pgvector"
  else
    echo "[pgvector] apt too old; building v${MIN_VERSION} from source"
    sudo apt-get install -y build-essential git "postgresql-server-dev-${PG_MAJOR}"
    tmp="$(mktemp -d)"
    git clone --depth 1 --branch "v${MIN_VERSION}" https://github.com/pgvector/pgvector.git "$tmp/pgvector"
    make -C "$tmp/pgvector"
    sudo make -C "$tmp/pgvector" install
    rm -rf "$tmp"
  fi
  echo "[pgvector] max available after install: $(avail_max || echo none)"
fi

# 2) Upgrade the extension in the live DB to the newest available version.
echo "[pgvector] ALTER EXTENSION vector UPDATE ..."
sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -c "ALTER EXTENSION vector UPDATE;"
NEW="$(current_version || true)"
echo "[pgvector] extension version now: ${NEW:-none}"
if ! ver_ge "$NEW" "$MIN_VERSION"; then
  echo "[pgvector] FATAL: still < $MIN_VERSION after update"; exit 1
fi

# 3) Rebuild every HNSW index (bumped maintenance_work_mem speeds the build).
echo "[pgvector] rebuilding HNSW indexes ..."
mapfile -t IDX < <(sudo -u postgres psql -d "$DB" -tAc \
  "SELECT n.nspname||'.'||c.relname \
     FROM pg_index i \
     JOIN pg_class c ON c.oid = i.indexrelid \
     JOIN pg_am am ON am.oid = c.relam \
     JOIN pg_namespace n ON n.oid = c.relnamespace \
    WHERE am.amname = 'hnsw';")
if [ "${#IDX[@]}" -eq 0 ] || [ -z "${IDX[0]:-}" ]; then
  echo "[pgvector] no HNSW indexes found (nothing to rebuild)"
else
  for ix in "${IDX[@]}"; do
    [ -z "$ix" ] && continue
    echo "[pgvector]   REINDEX $ix"
    sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 \
      -c "SET maintenance_work_mem='512MB'; REINDEX INDEX ${ix};"
  done
fi

echo "[pgvector] done. version=${NEW}"
