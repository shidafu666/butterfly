#!/bin/sh
set -e

if [ -z "$MQTT_USERNAME" ] || [ -z "$MQTT_PASSWORD" ]; then
  echo "ERROR: MQTT_USERNAME and MQTT_PASSWORD must be set" >&2
  exit 1
fi

PASSWD_FILE=/mosquitto/data/passwd

# Remove any stale files from a previous crashed run
rm -f "${PASSWD_FILE}" "${PASSWD_FILE}.tmp"

mosquitto_passwd -b -c "$PASSWD_FILE" "$MQTT_USERNAME" "$MQTT_PASSWORD"
chown mosquitto:mosquitto "$PASSWD_FILE"
chmod 600 "$PASSWD_FILE"
echo "[mosquitto] Password file created for user: $MQTT_USERNAME"

exec mosquitto -c /mosquitto/config/mosquitto.conf
