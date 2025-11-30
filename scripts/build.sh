#!/bin/bash
set -e

echo "🦀 Building Rust WASM module..."
cd wasm-engine
wasm-pack build --target web --out-dir pkg

echo "📦 Copying WASM artifacts to extension..."
cd ..
mkdir -p extension/wasm
cp wasm-engine/pkg/wasm_engine.js extension/wasm/
cp wasm-engine/pkg/wasm_engine_bg.wasm extension/wasm/
cp wasm-engine/pkg/wasm_engine.d.ts extension/wasm/

echo "✅ Build complete!"
echo ""
echo "📂 Extension is ready at: ./extension/"
echo ""
echo "To load in Chrome:"
echo "  1. Open chrome://extensions/"
echo "  2. Enable 'Developer mode'"
echo "  3. Click 'Load unpacked'"
echo "  4. Select the 'extension' folder"
