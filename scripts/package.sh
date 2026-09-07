#!/bin/bash
set -e

ZIP_NAME="chat-signal.zip"

echo "🏗️  Building Chat Signal for CWS submission..."
echo ""

# 1. Install locked dev deps (reproducible: uses package-lock.json exactly)
echo "Step 1/5: Installing locked dependencies (npm ci)..."
npm ci --ignore-scripts

# 2. Build WASM
echo ""
echo "Step 2/5: Building WASM engine..."
./scripts/build.sh

# 3. Vendor Transformers.js + the bundled MiniLM model
echo ""
echo "Step 3/5: Vendoring Transformers.js..."
./scripts/vendor-transformers.sh

echo ""
echo "Step 4/5: Vendoring MiniLM model..."
./scripts/vendor-minilm.sh

# 5. Create ZIP
echo ""
echo "Step 5/5: Packaging extension..."

# Remove old ZIP if it exists
rm -f "$ZIP_NAME"

cd extension
zip -r "../$ZIP_NAME" . \
  -x "*.DS_Store" \
  -x "__MACOSX/*" \
  -x "wasm/*.d.ts"
cd ..

echo ""
echo "✅ Package ready: $ZIP_NAME"
echo ""
echo "Upload this file to the Chrome Web Store developer dashboard."

# Show size
ls -lh "$ZIP_NAME"
