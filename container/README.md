# Sparmate Container

Run Sparmate in a local container on Linux, Windows, or macOS.
The server runs inside the container while your browser stays on your host machine.

## Requirements

- **Linux or macOS:** Podman or Docker installed and running.
- **Windows:** Windows 10/11 with WSL 2 and Podman or Docker Desktop.
- Claude Code account or an OAuth token from `claude setup-token`.

## Setup

Run the setup script for your platform:

**Linux / macOS:**
```bash
./setup.sh
```

**Windows (PowerShell):**
```powershell
.\setup.ps1
```

The script performs the following actions:
1. Verifies Podman or Docker is installed and running.
2. Builds the container image.
3. Creates persistent data and model volumes.
4. Downloads Kokoro TTS neural voice models.
5. Creates the study folder. The app fills it with the starter kit on first start when it is empty.
6. Configures Claude authentication.
7. Starts the container on `http://127.0.0.1:4747`.

## Daily Use

Start the container:
```bash
./start.sh        # Linux / macOS
.\start.ps1       # Windows PowerShell
```

Open `http://127.0.0.1:4747` in your browser.

Stop the container:
```bash
./stop.sh         # Linux / macOS
.\stop.ps1        # Windows PowerShell
```

## Where Files Live

- **Study Folder:** Mounted from your host machine (default: `~/interview-prep`).
  Contains `TRACKER.md`, `REVIEW.md`, `TEACHING.md`, `notes/`, and `lld/`.
  You can edit these files directly with any editor.
- **App Data:** Stored in the `sparmate-data` volume.
  Contains session logs, settings, and generated custom problems.
- **Claude Config:** Stored in the `sparmate-claude` volume.
  Contains your Claude authentication session.
- **TTS Models:** Stored in the `sparmate-kokoro` volume.
  Contains the offline Kokoro ONNX model weights.

## Updating

Pull the latest code changes in this repository and re-run setup:
```bash
./setup.sh        # Linux / macOS
.\setup.ps1       # Windows PowerShell
```

## Uninstalling

Remove the container, image, and persistent volumes:

```bash
# Stop and remove the container
podman rm -f sparmate 2>/dev/null || docker rm -f sparmate 2>/dev/null

# Remove the container image
podman rmi sparmate:latest 2>/dev/null || docker rmi sparmate:latest 2>/dev/null

# Remove named volumes (leaves host study files intact)
podman volume rm sparmate-data sparmate-claude sparmate-kokoro 2>/dev/null || \
docker volume rm sparmate-data sparmate-claude sparmate-kokoro 2>/dev/null
```

Your host study files in `~/interview-prep` are preserved.

## Troubleshooting

- **Port in use:** Make sure port 4747 is free on your machine before starting.
- **Claude authentication:** If your Claude session expires, re-run `./setup.sh` or supply `CLAUDE_CODE_OAUTH_TOKEN` in your environment.
- **C++ runner:** Sandboxing uses Bubblewrap on Linux. No privileged mode is needed.
