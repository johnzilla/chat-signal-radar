# WebLLM Setup for MV3 Extension

## Current Status

The extension **works with a fallback summarizer** by default. WebLLM integration is optional but provides better AI summaries.

## To Add Real WebLLM (Optional)

### Option 1: Manual Bundle (Recommended for v0)

1. **Download pre-built WebLLM:**
   ```bash
   cd extension
   mkdir -p libs/web-llm
   curl -L https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@latest/lib/index.js -o libs/web-llm/index.js
   curl -L https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@latest/lib/tvmjs.bundle.js -o libs/web-llm/tvmjs.bundle.js
   ```

2. **Reload extension** - WebLLM will auto-download model (~400MB) on first run

### Option 2: Build from Source (Advanced)

```bash
cd extension
npm init -y
npm install @mlc-ai/web-llm

# Create build script (build-webllm.js)
cat > build-webllm.js << 'EOF'
import esbuild from 'esbuild';

esbuild.build({
  entryPoints: ['node_modules/@mlc-ai/web-llm/lib/index.js'],
  bundle: true,
  format: 'esm',
  outfile: 'libs/web-llm/index.js',
  external: []
}).catch(() => process.exit(1));
EOF

npm install -D esbuild
node build-webllm.js
```

### Option 3: Use Fallback Only

Do nothing! The extension works without WebLLM using rule-based summaries.

## Model Storage

- Models are cached in IndexedDB (managed by WebLLM)
- First load downloads ~400MB (Phi-2-q4f16_1)
- Subsequent loads are instant

## Switching Models

Edit `llm-adapter.js` line 24:
```javascript
engine = await CreateMLCEngine('Llama-3.2-1B-Instruct-q4f16_1-MLC', { // Change model here
```

Available models: https://github.com/mlc-ai/web-llm#supported-models

## Troubleshooting

**"WebLLM bundle not found"** - Normal! Using fallback mode. Add bundle to enable WebLLM.

**CSP errors** - Ensure `connect-src` includes HuggingFace and raw.githubusercontent.com

**Model won't download** - Check browser console, ensure network access to HuggingFace

**Out of memory** - Use smaller model like Phi-2 instead of Llama-3
