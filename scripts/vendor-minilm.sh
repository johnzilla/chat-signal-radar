#!/bin/bash
set -e

# Vendor the MiniLM encoder model into the extension so it ships bundled and is
# never fetched from HuggingFace at runtime. Pinned to a specific commit; keep
# this in sync with MODEL_REVISION in extension/sidebar/encoder-adapter.js.
#
# Layout expected by Transformers.js (env.localModelPath = libs/models/):
#   extension/libs/models/Xenova/all-MiniLM-L6-v2/{config,tokenizer,...}.json
#   extension/libs/models/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx
#
# Run once (and after changing MODEL_REVISION):  ./scripts/vendor-minilm.sh

REV="751bff37182d3f1213fa05d7196b954e230abad9"
MODEL="Xenova/all-MiniLM-L6-v2"
DEST="extension/libs/models/$MODEL"
BASE="https://huggingface.co/$MODEL/resolve/$REV"

echo "📦 Vendoring $MODEL @ ${REV:0:12} into $DEST ..."
mkdir -p "$DEST/onnx"

# Metadata + tokenizer (small JSON files)
for f in config.json tokenizer.json tokenizer_config.json special_tokens_map.json; do
  echo "  ↓ $f"
  curl -fSL "$BASE/$f" -o "$DEST/$f"
done

# Quantized ONNX weights (q8) — the ~23MB file the runtime actually needs
echo "  ↓ onnx/model_quantized.onnx (~23MB)"
curl -fSL "$BASE/onnx/model_quantized.onnx" -o "$DEST/onnx/model_quantized.onnx"

echo "✅ MiniLM vendored to $DEST/"
du -sh "$DEST"
ls -lhR "$DEST"
