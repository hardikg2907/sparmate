#!/bin/sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== Interview Room Container Setup ==="

# 1. Check for Podman or Docker
if command -v podman >/dev/null 2>&1; then
  ENGINE="podman"
elif command -v docker >/dev/null 2>&1; then
  ENGINE="docker"
else
  echo "Error: Neither podman nor docker was found in PATH." >&2
  echo "Please install Podman (recommended) or Docker Desktop." >&2
  exit 1
fi
echo "Using container engine: $ENGINE"

# 2. Build container image
IMAGE_NAME="${IMAGE_NAME:-interview-room:latest}"
echo "Building container image $IMAGE_NAME..."
$ENGINE build -t "$IMAGE_NAME" -f "$SCRIPT_DIR/Containerfile" "$APP_DIR"

# 3. Create named volumes
echo "Creating named volumes..."
$ENGINE volume create interview-room-data >/dev/null
$ENGINE volume create interview-room-kokoro >/dev/null
$ENGINE volume create interview-room-claude >/dev/null

# 4. Study folder path
DEFAULT_STUDY="$HOME/interview-prep"
if [ -n "$STUDY_PATH" ]; then
  STUDY_DIR="$STUDY_PATH"
elif [ -t 0 ] && [ "$NONINTERACTIVE" != "1" ]; then
  printf "Study folder path [%s]: " "$DEFAULT_STUDY"
  read -r input_path
  STUDY_DIR="${input_path:-$DEFAULT_STUDY}"
else
  STUDY_DIR="$DEFAULT_STUDY"
fi

# Expand tilde if present
case "$STUDY_DIR" in
  "~"*) STUDY_DIR="$HOME${STUDY_DIR#\~}" ;;
esac

mkdir -p "$STUDY_DIR"
echo "Study folder: $STUDY_DIR"

# 5. The app copies the study kit into an empty study folder on first start.

# 6. Download Kokoro neural TTS model files
KOKORO_MODEL_URL="https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx"
KOKORO_MODEL_SHA256="7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5"
KOKORO_VOICES_URL="https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"
KOKORO_VOICES_SHA256="bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d"

echo "Checking Kokoro neural TTS model files in volume..."
$ENGINE run --rm \
  -v interview-room-kokoro:/kokoro \
  "$IMAGE_NAME" sh -c "
    set -e
    check_model() {
      echo '$KOKORO_MODEL_SHA256  /kokoro/kokoro-v1.0.onnx' | sha256sum -c - >/dev/null 2>&1
    }
    check_voices() {
      echo '$KOKORO_VOICES_SHA256  /kokoro/voices-v1.0.bin' | sha256sum -c - >/dev/null 2>&1
    }
    if ! check_model; then
      echo 'Downloading kokoro-v1.0.onnx...'
      curl -fL -o /kokoro/kokoro-v1.0.onnx '$KOKORO_MODEL_URL'
      echo '$KOKORO_MODEL_SHA256  /kokoro/kokoro-v1.0.onnx' | sha256sum -c -
    fi
    if ! check_voices; then
      echo 'Downloading voices-v1.0.bin...'
      curl -fL -o /kokoro/voices-v1.0.bin '$KOKORO_VOICES_URL'
      echo '$KOKORO_VOICES_SHA256  /kokoro/voices-v1.0.bin' | sha256sum -c -
    fi
    echo 'Kokoro models verified.'
  "

# 7. Claude login guidance
if [ -n "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
  echo "Saving CLAUDE_CODE_OAUTH_TOKEN to credentials volume..."
  # Passed by name, so the token never appears in a command line or the process list.
  $ENGINE run --rm -e CLAUDE_CODE_OAUTH_TOKEN \
    -v interview-room-claude:/home/node/.claude \
    "$IMAGE_NAME" sh -c 'umask 077; printenv CLAUDE_CODE_OAUTH_TOKEN > /home/node/.claude/oauth_token'
elif [ -t 0 ] && [ "$NONINTERACTIVE" != "1" ]; then
  echo ""
  echo "Claude authentication options:"
  echo "1. If you ran 'claude setup-token' on another machine, paste the token below."
  echo "2. Or press Enter to start an interactive browser login in the container."
  printf "Paste OAuth token (or press Enter): "
  read -rs token_input
  echo ""
  if [ -n "$token_input" ]; then
    CLAUDE_CODE_OAUTH_TOKEN="$token_input" $ENGINE run --rm -e CLAUDE_CODE_OAUTH_TOKEN \
      -v interview-room-claude:/home/node/.claude \
      "$IMAGE_NAME" sh -c 'umask 077; printenv CLAUDE_CODE_OAUTH_TOKEN > /home/node/.claude/oauth_token'
    echo "Saved OAuth token."
  else
    echo "Starting interactive Claude login inside container..."
    $ENGINE run -it --rm \
      -v interview-room-claude:/home/node/.claude \
      "$IMAGE_NAME" claude login || true
  fi
fi

# 8. Save environment config for start/stop scripts
cat <<EOF > "$SCRIPT_DIR/.env"
STUDY_ROOT=$STUDY_DIR
PORT=${PORT:-4747}
IMAGE_NAME=$IMAGE_NAME
CONTAINER_ENGINE=$ENGINE
EOF

echo ""
echo "Setup complete!"
echo "To start the server, run: $SCRIPT_DIR/start.sh"
echo "The app will be available at: http://127.0.0.1:${PORT:-4747}"
