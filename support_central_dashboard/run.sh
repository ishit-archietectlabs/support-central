#!/bin/bash
set -e

# ============================================================
# Support Central Dashboard — Entrypoint
# ============================================================

# Read options from /data/options.json using jq
export ASTERISK_WS_URL=$(jq --raw-output '.asterisk_ws_url' /data/options.json)
export SIP_USERNAME=$(jq --raw-output '.sip_username' /data/options.json)
export SIP_PASSWORD=$(jq --raw-output '.sip_password' /data/options.json)
export SIP_DOMAIN=$(jq --raw-output '.sip_domain' /data/options.json)

# Determine ingress path if possible
# export INGRESS_PATH=$(bashio::addon.ingress_entry 2>/dev/null || echo "")

echo "[INFO] Starting Support Central Dashboard..."
cd /app
exec node server.js
