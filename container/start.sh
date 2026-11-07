#!/bin/sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -f "$SCRIPT_DIR/.env" ]; then
  . "$SCRIPT_DIR/.env"
fi

ENGINE="${CONTAINER_ENGINE:-}"
if [ -z "$ENGINE" ]; then
  if command -v podman >/dev/null 2>&1; then
    ENGINE="podman"
  elif command -v docker >/dev/null 2>&1; then
    ENGINE="docker"
  else
    echo "Error: Neither podman nor docker found." >&2
    exit 1
  fi
fi

IMAGE_NAME="${IMAGE_NAME:-interview-room:latest}"
PORT="${PORT:-4747}"
STUDY_DIR="${STUDY_ROOT:-$HOME/interview-prep}"

case "$STUDY_DIR" in
  "~"*) STUDY_DIR="$HOME${STUDY_DIR#\~}" ;;
esac

CONTAINER_NAME="${CONTAINER_NAME:-interview-room}"

# Stop any existing container with the same name
$ENGINE rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

echo "Starting $CONTAINER_NAME on http://127.0.0.1:$PORT..."

$ENGINE run -d \
  --name "$CONTAINER_NAME" \
  -p "127.0.0.1:$PORT:$PORT" \
  -e PORT="$PORT" \
  -e IR_IN_CONTAINER=1 \
  -e IR_FAKE_AGENT="${IR_FAKE_AGENT:-}" \
  -v "$STUDY_DIR:/study:Z" \
  -v interview-room-data:/data:Z \
  -v interview-room-kokoro:/kokoro:Z \
  -v interview-room-claude:/home/node/.claude:Z \
  "$IMAGE_NAME" >/dev/null

echo "Interview Room is running at http://127.0.0.1:$PORT"
