#!/usr/bin/env python3
import base64
import io
import json
import sys

def main() -> None:
    if len(sys.argv) < 3:
        sys.stderr.write("Usage: kokoro_worker.py <onnx_path> <voices_path>\n")
        sys.stderr.flush()
        sys.exit(1)

    onnx_path = sys.argv[1]
    voices_path = sys.argv[2]

    try:
        from kokoro_onnx import Kokoro
        import soundfile as sf
    except Exception as exc:
        sys.stderr.write(f"Failed to import Kokoro dependencies: {exc}\n")
        sys.stderr.flush()
        sys.exit(1)

    try:
        kokoro = Kokoro(onnx_path, voices_path)
    except Exception as exc:
        sys.stderr.write(f"Failed to load Kokoro model: {exc}\n")
        sys.stderr.flush()
        sys.exit(1)

    # Process JSON requests line-by-line from standard input to avoid exposing speech text in argv.
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            text = str(req.get("text", ""))
            voice = str(req.get("voice", "bm_george"))
            speed = float(req.get("speed", 0.95))
            lang = str(req.get("lang", "en-gb"))

            samples, rate = kokoro.create(text, voice=voice, speed=speed, lang=lang)
            buf = io.BytesIO()
            sf.write(buf, samples, rate, format="WAV", subtype="PCM_16")
            wav_b64 = base64.b64encode(buf.getvalue()).decode("ascii")

            reply = {"id": req_id, "ok": True, "wavBase64": wav_b64}
        except Exception as exc:
            reply = {"id": req_id, "ok": False, "error": str(exc)}

        sys.stdout.write(json.dumps(reply) + "\n")
        sys.stdout.flush()

if __name__ == "__main__":
    main()
