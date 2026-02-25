#!/bin/sh
set -eu

BASE_URL="${BASE_URL:-https://harmonie-zarr.s3.amazonaws.com/dini/control}"
ENV_FILE="${ENV_FILE:-/workspace/.env.prod}"
COMPOSE_FILE="${COMPOSE_FILE:-/workspace/docker-compose.prod.yml}"
MAX_LOOKBACK_HOURS="${MAX_LOOKBACK_HOURS:-48}"
MIN_LAG_HOURS="${MIN_LAG_HOURS:-3}"
STEP_HOURS="${STEP_HOURS:-3}"

if [ ! -f "$ENV_FILE" ]; then
  echo "[$(date -u '+%F %T')] Missing env file: $ENV_FILE" >&2
  exit 1
fi

latest_ts="$(python3 - <<'PY'
from datetime import datetime, timedelta, timezone

min_lag = int(__import__('os').environ.get('MIN_LAG_HOURS', '3'))
step = int(__import__('os').environ.get('STEP_HOURS', '3'))

now = datetime.now(timezone.utc)
ref = now - timedelta(hours=min_lag)
slot_hour = (ref.hour // step) * step
slot = ref.replace(hour=slot_hour, minute=0, second=0, microsecond=0)
print(slot.strftime('%Y-%m-%dT%H0000Z'))
PY
)"

chosen_path=""
lookback="$MIN_LAG_HOURS"
while [ "$lookback" -le "$MAX_LOOKBACK_HOURS" ]; do
  ts="$(python3 - <<PY
from datetime import datetime, timedelta, timezone
base = datetime.strptime("$latest_ts", "%Y-%m-%dT%H%M%SZ").replace(tzinfo=timezone.utc)
print((base - timedelta(hours=$((lookback - MIN_LAG_HOURS)))).strftime('%Y-%m-%dT%H0000Z'))
PY
)"
  candidate="${BASE_URL}/${ts}/single_levels.zarr"
  if curl -fsI "${candidate}/.zmetadata" >/dev/null 2>&1; then
    chosen_path="$candidate"
    break
  fi
  lookback=$((lookback + STEP_HOURS))
done

if [ -z "$chosen_path" ]; then
  echo "[$(date -u '+%F %T')] No available dataset found in last ${MAX_LOOKBACK_HOURS}h" >&2
  exit 1
fi

if grep -q '^GRIDLOOK_DEFAULT_DATASET_PATH=' "$ENV_FILE"; then
  sed -i "s|^GRIDLOOK_DEFAULT_DATASET_PATH=.*$|GRIDLOOK_DEFAULT_DATASET_PATH=${chosen_path}|" "$ENV_FILE"
else
  printf '\nGRIDLOOK_DEFAULT_DATASET_PATH=%s\n' "$chosen_path" >> "$ENV_FILE"
fi

# Recreate app so runtime env is reloaded and runtime-config.js is regenerated.
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --force-recreate app

echo "[$(date -u '+%F %T')] Updated GRIDLOOK_DEFAULT_DATASET_PATH=${chosen_path}"
