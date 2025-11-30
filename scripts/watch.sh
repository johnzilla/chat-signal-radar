#!/bin/bash

echo "👀 Starting development watch mode..."
echo "Press Ctrl+C to stop"
echo ""

# Watch for Rust changes and rebuild
cd wasm-engine
cargo watch -s "wasm-pack build --target web --out-dir pkg && cp pkg/*.{js,wasm,ts} ../extension/wasm/"
