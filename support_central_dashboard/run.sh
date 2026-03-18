#!/usr/bin/with-contenv bashio
set -e

# ============================================================
# Support Central Dashboard — Entrypoint
# ============================================================

export ASTERISK_WS_URL=$(bashio::config 'asterisk_ws_url')
export SIP_USERNAME=$(bashio::config 'sip_username')
export SIP_PASSWORD=$(bashio::config 'sip_password')
export SIP_DOMAIN=$(bashio::config 'sip_domain')

# Determine ingress path if possible
export INGRESS_PATH=$(bashio::addon.ingress_entry 2>/dev/null || echo "")

bashio::log.info "Starting Support Central Dashboard..."
cd /app
exec node server.js
