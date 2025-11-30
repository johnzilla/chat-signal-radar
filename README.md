# 📡 Chat Signal Radar

A Chrome extension that uses Rust + WebAssembly to analyze YouTube and Twitch live chat in real-time, clustering messages into actionable categories: **Questions**, **Issues/Bugs**, **Requests**, and **General Chat**.

## 🏗️ Architecture

- **Rust WASM Engine** (`wasm-engine/`): Message clustering logic compiled to WebAssembly
- **Chrome Extension** (`extension/`): Manifest V3 extension with content script and sidebar UI
- **Build Scripts** (`scripts/`): Automated build pipeline from Rust → WASM → Extension

## 🚀 Quick Start

### Prerequisites

- [Rust](https://rustup.rs/) (latest stable)
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/) (`cargo install wasm-pack`)
- Chrome/Chromium browser

### Build & Install

1. **Build the WASM module:**
   ```bash
   chmod +x scripts/build.sh
   ./scripts/build.sh
   ```

2. **Load extension in Chrome:**
   - Open `chrome://extensions/`
   - Enable **Developer mode** (top-right toggle)
   - Click **Load unpacked**
   - Select the `extension/` folder

3. **Test it:**
   - Navigate to a YouTube live stream or Twitch channel with active chat
   - Click the extension icon to open the sidebar
   - Watch messages cluster in real-time! 📊

## 📁 Project Structure

```
chat-signal-radar/
├── wasm-engine/           # Rust → WASM clustering engine
│   ├── Cargo.toml
│   └── src/lib.rs
├── extension/             # Chrome extension (Manifest V3)
│   ├── manifest.json
│   ├── background.js
│   ├── content-script.js
│   ├── sidebar/
│   │   ├── sidebar.html
│   │   ├── sidebar.css
│   │   └── sidebar.js
│   └── wasm/              # (generated) WASM artifacts
└── scripts/
    ├── build.sh           # Build Rust → WASM → Extension
    └── watch.sh           # Dev mode with auto-rebuild
```

## 🛠️ Development

### Dev Workflow

1. **Start watch mode:**
   ```bash
   chmod +x scripts/watch.sh
   ./scripts/watch.sh
   ```

2. **Open a test stream** (YouTube live or Twitch with active chat)

3. **After code changes:**
   - Watch mode auto-rebuilds WASM
   - Go to `chrome://extensions/`
   - Click reload icon on Chat Signal Radar extension
   - Refresh the stream page

### Watch Mode (Auto-rebuild)

Requires [cargo-watch](https://github.com/watchexec/cargo-watch):
```bash
cargo install cargo-watch
```

### Modifying the Clustering Logic

Edit `wasm-engine/src/lib.rs` and rebuild. Current v0 implementation uses simple keyword matching. Future improvements could include:
- TF-IDF or embedding-based similarity
- Language-specific NLP models
- User-configurable categories

### Run Tests

```bash
cd wasm-engine
cargo test
```

## 🎯 How It Works

1. **Content Script** observes YouTube/Twitch chat DOM
2. Batches messages every 5 seconds
3. Sends batch to **Sidebar** via `chrome.runtime`
4. **WASM module** clusters messages by keywords
5. **Sidebar UI** displays categorized results

## 📝 License

MIT

## 🤝 Contributing

PRs welcome! This is a v0 prototype — lots of room for improvement.
