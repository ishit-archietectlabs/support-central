#!/usr/bin/env bash
set -e

CONFIG_PATH=/data/options.json

export ASTERISK_WS_URL=$(jq -r '.asterisk_ws_url' $CONFIG_PATH)
export SIP_USERNAME=$(jq -r '.sip_username' $CONFIG_PATH)
export SIP_PASSWORD=$(jq -r '.sip_password' $CONFIG_PATH)
export SIP_DOMAIN=$(jq -r '.sip_domain' $CONFIG_PATH)
export INGRESS_PATH=$(bashio::addon.ingress_entry 2>/dev/null || echo "")

echo "[INFO] Starting Support Central Dashboard..."
cd /app
exec node server.js
