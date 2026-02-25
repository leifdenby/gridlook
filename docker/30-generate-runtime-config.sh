#!/bin/sh
set -eu

cat > /usr/share/nginx/html/runtime-config.js <<EOF
window.__GRIDLOOK_CONFIG__ = {
  defaultDatasetPath: "${GRIDLOOK_DEFAULT_DATASET_PATH:-${VITE_DEFAULT_DATASET_PATH:-static/index_mr_dpp0066.json}}",
  defaultVariableName: "${GRIDLOOK_DEFAULT_VARIABLE_NAME:-${VITE_DEFAULT_VARIABLE_NAME:-}}",
};
EOF
