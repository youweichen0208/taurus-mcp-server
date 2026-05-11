#!/usr/bin/env bash

# Source this file to force-enable CES-backed metrics collection for TaurusDB.
# Example:
#   source scripts/enable-ces-env.sh

export TAURUSDB_CLOUD_ENABLE_CES=true
export TAURUSDB_METRICS_SOURCE_CES_ENABLED=true

printf 'CES enabled in current shell.\n'
printf 'TAURUSDB_CLOUD_ENABLE_CES=%s\n' "${TAURUSDB_CLOUD_ENABLE_CES}"
printf 'TAURUSDB_METRICS_SOURCE_CES_ENABLED=%s\n' "${TAURUSDB_METRICS_SOURCE_CES_ENABLED}"

missing_vars=()

for required_var in \
  TAURUSDB_CLOUD_REGION \
  TAURUSDB_CLOUD_ACCESS_KEY_ID \
  TAURUSDB_CLOUD_SECRET_ACCESS_KEY
do
  if [ -z "$(printenv "${required_var}")" ]; then
    missing_vars+=("${required_var}")
  fi
done

if [ "${#missing_vars[@]}" -gt 0 ]; then
  printf 'Missing cloud env: %s\n' "${missing_vars[*]}"
  printf 'CES is enabled, but validation will still fail until those vars are set.\n'
fi
