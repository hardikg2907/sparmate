/** The Kokoro model files and Python packages. The container scripts keep their own copy, and a test keeps both in step. */
export interface KokoroAsset {
  fileName: string;
  url: string;
  sha256: string;
}

export const KOKORO_ASSETS: readonly KokoroAsset[] = [
  {
    fileName: "kokoro-v1.0.onnx",
    url: "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx",
    sha256: "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5",
  },
  {
    fileName: "voices-v1.0.bin",
    url: "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin",
    sha256: "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
  },
];

export const KOKORO_PIP_PINS: readonly string[] = ["kokoro-onnx==0.4.7", "soundfile==0.13.1"];

/** The current onnxruntime wheels need this Python or newer. */
export const KOKORO_MIN_PYTHON = { major: 3, minor: 11 } as const;
