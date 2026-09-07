# CLAUDE.md

This file provides guidance for Claude Code (or any AI assistant) when working with the chat-signal codebase.

## Project Overview

Chat Signal is a Chrome extension that analyzes YouTube and Twitch live chat in real-time using Rust + WebAssembly. It provides a real-time dashboard showing:

- **Message Clustering**: Questions, Issues/Bugs, Requests, and General Chat
- **Sentiment Analysis**: Overall chat mood (excited, positive, angry, negative, confused, neutral)
- **Topic Detection**: Trending words and emotes mentioned frequently

## Architecture

```
Content Script → Background Worker → Sidebar UI → WASM Engine
(DOM observer)    (message relay)    (display)    (analysis)
                                         ↓
                                    Encoder Adapter
                                  (MiniLM via Transformers.js)
                                         ↓
                                    Cosine Router
                                  (semantic clustering)
                                         ↓
                                    LLM Adapter
                                  (Gemini Nano / fallback)
```

- **wasm-engine/**: Rust WASM analysis engine
  - Message clustering (keyword-based, used as fallback)
  - Topic extraction (with stop word filtering)
  - Sentiment signal analysis (lexicon-based)
- **extension/**: Chrome Extension (Manifest V3)
  - `content-script.js`: DOM observer for YouTube/Twitch chat
  - `background.js`: Service worker for message relay
  - `llm-adapter.js`: Gemini Nano (Chrome built-in AI) with rule-based fallback
  - `settings-defaults.js`: Shared DEFAULT_SETTINGS (single source of truth)
  - `sidebar/`: UI components (HTML, JS, CSS with system theme support)
    - `encoder-adapter.js`: MiniLM encoder via Transformers.js (lazy-init, WebGPU with WASM fallback; model bundled locally — no runtime HF fetch)
    - `cosine-router.js`: Cosine similarity classification into 4 buckets
    - `routing-config.js`: Seed phrases, per-category thresholds, tuning config
    - `modules/`: Modular components (gpu-scheduler.js)
  - `wasm/`: Generated WASM artifacts (git-ignored)
- **docs/**: GitHub Pages site (privacy policy, CWS compliance docs, store assets)
  - Served at `chatsignal.dev` via GitHub Pages from `docs/` folder
  - `docs/store/`: CWS store listing assets (screenshots, promo image)
  - `docs/cws-store-listing.md`: Copy-paste reference for CWS dashboard
- **scripts/**: Build automation and asset generation
  - `scripts/promo-image.mjs`: Generate 440x280 promotional image via sharp
  - `scripts/screenshot.mjs`: Generate 1280x800 CWS screenshots via Playwright

## Build Commands

```bash
# Build WASM and copy to extension
./scripts/build.sh

# Development mode with auto-rebuild (requires cargo-watch)
./scripts/watch.sh

# Build WASM only
cd wasm-engine && wasm-pack build --target web --release
```

## Test Commands

```bash
# Run Rust unit tests
cd wasm-engine && cargo test
```

There are 18 unit tests in `wasm-engine/src/lib.rs` covering:
- Message clustering (5 tests)
- Topic extraction (4 tests)
- Sentiment analysis (4 tests)
- Spam/duplicate detection (4 tests)
- Combined analysis (1 test)

```bash
# Run JavaScript tests (content-script, sidebar, options, LLM adapter)
npm run test:js
```

There are 42 JS tests across 10 suites covering:
- Content-script extraction (3 tests)
- LLM fallback sentiment (3 tests)
- Options page settings (2 tests)
- Sidebar helpers (4 tests)
- Storage manager (9 tests: save, load, delete, clear, stats, MAX_SESSIONS cap)
- ValidationHelpers: validateMessages (6 tests)
- ValidationHelpers: validateAnalysisResult (5 tests)
- ValidationHelpers: validateSettings (6 tests)
- DOMHelpers: escapeHtml (3 tests)
- DOMHelpers: DOMPURIFY_CONFIG (1 test)

## Key Files

- `wasm-engine/src/lib.rs`: Core analysis engine with clustering, topic extraction, and sentiment analysis
- `wasm-engine/Cargo.toml`: Rust dependencies (wasm-bindgen, serde)
- `extension/manifest.json`: Extension permissions and configuration
- `extension/content-script.js`: Platform-specific chat extraction (YouTube/Twitch selectors)
- `extension/llm-adapter.js`: Gemini Nano (Prompt API) engine for AI-powered summaries + sentiment, with rule-based fallback
- `extension/sidebar/sidebar.js`: Main entry point, WASM loading, UI event handling
- `extension/settings-defaults.js`: Shared DEFAULT_SETTINGS (imported by sidebar.js, options.js, StateManager.js)
- `extension/sidebar/encoder-adapter.js`: MiniLM encoder pipeline (lazy-init, WebGPU/WASM backends, batched queue; loads the bundled model from `libs/models/`, no runtime download)
- `extension/sidebar/cosine-router.js`: Prototype vector computation, per-message cosine classification, mode state
- `extension/sidebar/routing-config.js`: Seed phrases per category, per-category thresholds, tuning constants
- `extension/sidebar/modules/`: Modular components
  - `gpu-scheduler.js`: WebGPU promise-chain mutex with priority scheduling
- `extension/sidebar/utils/`: Utility modules
  - `DOMHelpers.js`: Safe DOM manipulation with XSS protection
  - `ValidationHelpers.js`: Input validation and sanitization
  - `FormattingHelpers.js`: Text formatting and display utilities
- `extension/storage-manager.js`: Session history persistence using chrome.storage.local

## WASM Engine Functions

The Rust WASM engine exports these main functions:

### `cluster_messages(messages)`
Clusters messages into buckets (Questions, Issues/Bugs, Requests, General Chat).

### `analyze_chat(messages)`
Combined analysis returning:
- `buckets`: Clustered messages
- `topics`: Trending words/phrases (min 5 mentions)
- `sentiment_signals`: Positive/negative/confused/neutral counts + score

### `extract_topics(messages, min_count)`
Extracts frequently mentioned words, filtering stop words but preserving emotes.

### `analyze_sentiment_signals(messages)`
Analyzes sentiment using lexicon-based matching.

## Word Lists (in lib.rs)

- `STOP_WORDS`: Common English words filtered from topics
- `KNOWN_EMOTES`: Twitch/YouTube emotes preserved and flagged
- `POSITIVE_WORDS`: Positive sentiment indicators
- `NEGATIVE_WORDS`: Negative sentiment indicators
- `CONFUSED_INDICATORS`: Confusion/question indicators

## Coding Conventions

### Rust (wasm-engine)
- Use `#[derive(Serialize, Deserialize)]` for JSON-compatible structs
- Export functions to JS with `#[wasm_bindgen]`
- Return `Result<JsValue, JsValue>` for JS interop errors
- Keep functions unit-testable by separating internal logic from wasm_bindgen exports

### JavaScript (extension)
- Use ES6 modules with dynamic imports for WASM
- **Security-First**: Always use safe DOM helpers from `DOMHelpers.js` instead of `innerHTML`
- **Input Validation**: Validate all WASM output and user input with `ValidationHelpers.js`
- Structure messages with `type` field for chrome message passing
- Use `chrome.runtime.getURL()` for extension resource paths
- LLM calls should have fallback behavior for when Nano is unavailable
- Follow modular architecture: separate concerns into modules/ and utils/
- Browser-only imports (Transformers.js, chrome APIs) should be lazy-loaded via dynamic `import()` in encoder-adapter.js so the module can be imported in Node.js tests
- Settings defaults must come from `extension/settings-defaults.js` (single source of truth)

### CSS (sidebar)
- Use CSS variables for theming (defined in `:root`)
- Support system theme via `@media (prefers-color-scheme: dark)`
- Use `var(--variable-name)` for colors, not hardcoded values

## Sentiment Analysis Logic

The sentiment system uses a two-tier approach:

1. **WASM Engine** counts messages matching sentiment keywords (whole-word boundary matching):
   - Positive (checked first): "love", "great", "pog", "awesome", etc.
   - Negative (checked second): "hate", "bad", "boring", "trash", etc.
   - Confused (checked last): "?", "wait", "huh", "explain", etc.
   - Neutral: everything else
   - Priority order means "this is awesome?" counts as positive, not confused

2. **LLM Adapter** (Gemini Nano) determines mood from signals:
   - Ignores neutral messages when calculating mood
   - Requires at least 3 sentiment signals before declaring a non-neutral mood
   - Upgrades positive → excited when sentiment_score > 30
   - Upgrades negative → angry when sentiment_score < -30
   - Keyword-scan regex parser (`MOOD:`, `CONFIDENCE:`, `REASON:`) tolerates model preamble
   - Falls back to rule-based analysis if Nano unavailable or after repeated garbage output

## Data Flow

```
Messages (from content script)
    ↓
analyze_chat() [WASM]
    ↓
AnalysisResult {
  buckets: ClusterBucket[],       ← keyword-based (fallback)
  topics: TopicEntry[],           ← always active
  sentiment_signals: SentimentSignals  ← always active
}
    ↓
Encoder Adapter (if ready)
    ↓
MiniLM embeddings (384-dim, L2-normalized)
    ↓
Cosine Router (if semantic mode active)
    ↓
Overrides bucket assignments with cosine-classified buckets
    ↓
LLM Adapter (Gemini Nano, if ready)
    ↓
Receives pre-classified semantic buckets with sample messages
    ↓
Generates context-aware summaries + sentiment mood
(keyword-scan parser tolerates preamble; garbage → fallback)
    ↓
Sidebar renders:
  - Mood indicator (with optional LLM enhancement)
  - Trending topics cloud
  - Cluster buckets (semantic or keyword)
  - "Semantic"/"Keyword" badge
  - AI summary (if LLM available, or "Basic mode" indicator)
```

## Development Workflow

1. Make changes to Rust code in `wasm-engine/src/lib.rs`
2. Run `./scripts/build.sh` to compile and copy artifacts
3. Load/reload extension in Chrome (`chrome://extensions/` → Developer mode → Load unpacked → select `extension/` folder)
4. Open YouTube/Twitch live stream and click extension icon to test

## Dependencies

- Rust (latest stable)
- wasm-pack
- Chrome browser
- Optional: cargo-watch for development auto-rebuild
- Dev dependencies (npm): Playwright (screenshots), sharp (image generation)

## AI Summaries — Chrome Built-in AI (Gemini Nano)

AI-powered summaries and mood analysis run on **Chrome's built-in AI (Gemini
Nano)** via the Prompt API (`LanguageModel`). Everything is on-device — no model
download from the extension, no network fetch surface of its own. The feature
degrades permanently to a rule-based fallback on browsers/devices without Nano.

### User Consent Flow

On first run, users see a lightweight note: "AI summaries run on-device via
Chrome's built-in AI" with **Enable AI** / **Not now**.
- **Enable AI** — sets `aiSummariesEnabled: true`, initializes Nano.
- **Not now** — keeps `aiSummariesEnabled: false`, uses the rule-based fallback.

There is no download/disk disclosure (Nano is managed by Chrome, not the
extension). `aiSummariesEnabled` is the single source of truth (shared with the
Settings toggle); `aiConsentShown` tracks whether the note has been shown once.

### How it works

1. `initializeLLM()` calls `LanguageModel.availability()`; if usable it creates
   a base Nano session, else it falls back to the rule-based floor.
2. `NanoEngine` implements the same `{ chat.completions.create }` interface as
   the fallback, so every hardening layer is unchanged (sanitize → fenced
   signal-authoritative prompt → `parseSentimentResponse` w/ OOV coercion →
   `reconcileMoodWithSignals` → `hasSummaryFormat`).
3. **Pristine session per call** — the base session is never prompted; each call
   clones it and destroys the clone (sharing a stateful session bloated latency
   ~7x in the feasibility spike).
4. Sidebar displays AI-generated summaries alongside cluster buckets.

Feasibility spike + reusable dataset: `tests/fixtures/nano-batches.json`,
`scripts/nano-spike-oneshot.js` (see `.planning/ROADMAP.md` Phase 16).

### LLM Adapter API

```javascript
import { initializeLLM, summarizeBuckets, analyzeSentiment, isLLMReady, resetLLM, isInFallback, getActiveBackend, retryLLM } from './llm-adapter.js';

await initializeLLM(progressCallback);  // Initialize engine (Nano → fallback)
const summary = await summarizeBuckets(buckets);  // Generate summary
const sentiment = await analyzeSentiment(messages, signals);  // Analyze mood
isLLMReady();          // Check if ready
getActiveBackend();    // 'none' | 'nano' | 'fallback'
await resetLLM();      // Cleanup
isInFallback();        // Check if in rule-based fallback mode
await retryLLM();      // Re-initialize engine after fallback
```

## Roadmap

### Shipped (MVP)
- [x] Message clustering (Questions, Issues, Requests, General Chat)
- [x] Sentiment analysis with 6 moods
- [x] Trending topics with emote detection
- [x] Spam/duplicate filtering
- [x] User-configurable settings
- [x] Session summary with "End Session" button
- [x] Copy summary to clipboard
- [x] System theme support (dark/light)
- [x] First-run guidance
- [x] Extension icons

### Shipped (Post-MVP)
- [x] **WebLLM Consent UX**: Prompt user before downloading ~400MB AI model, with "Remember my choice" option
- [x] **Smart Session Detection**: Auto-detect when messages stop for 2+ minutes and prompt "Stream ended? Save your session summary"
- [x] **Session History**: Persist summaries to chrome.storage.local, "History" tab to view past sessions
- [x] **Session-wide Stats**: Accumulate questions, sentiment, and message counts across entire session (not just rolling window)

### Shipped (v1.0)
- [x] **Configurable Analysis Window**: User-adjustable analysis window size (50-500 messages) with dynamic windowing
- [x] **DOMPurify Integration**: Replaced regex-based sanitization with DOMPurify for XSS prevention
- [x] **Configurable Thresholds**: Inactivity timeout setting, input validation with Number.isFinite()

### Shipped (v1.1 — CWS Readiness)
- [x] **Privacy Policy**: Hosted at chatsignal.dev/privacy-policy, CWS dashboard compliance docs
- [x] **Manifest Audit**: unlimitedStorage, CSP audit, disk space warning in consent modal
- [x] **Store Listing Assets**: Three 1280x800 screenshots, 440x280 promotional image, trademark-compliant store copy

### Shipped (v2.0 — Semantic AI Pipeline)
- [x] **MiniLM Encoder**: In-browser embedding via Transformers.js (WebGPU with WASM fallback)
- [x] **GPU Scheduler**: Promise-chain mutex for single-pipeline GPU access
- [x] **Semantic Cosine Routing**: Messages classified by cosine similarity to prototype vectors, with per-category thresholds and automatic fallback to keyword mode
- [x] **Qwen SLM Swap**: Switched from Phi-2 to Qwen2.5-0.5B-Instruct with keyword-scan parser, semantic cluster context in prompts, and garbage-triggered fallback to rule-based mode
- [x] **Word-boundary matching**: Keyword clustering and sentiment use whole-word matching to reduce false positives
- [x] **Sentiment priority reorder**: Positive/negative signals checked before confused, so "this is awesome?" counts as positive
- [x] **Shared settings module**: Single DEFAULT_SETTINGS source of truth across sidebar, options, and state manager
- [x] **Security hardening**: Restricted web_accessible_resources, explicit DOMPurify config, LLM summary throttle

### Shipped (v2.1 — CWS Launch)
- [x] **Verification & Submission**: Incognito testing, clean ZIP build, CRXcavator scan, CWS submission and approval

### Shipped (v2.2 — Landing Page Polish)
- [x] **Landing Page**: Meta/OG tags, favicon, CWS install button, feature highlights for chatsignal.dev

### Shipped (v2.3 — Export Options)
- [x] **Export Options**: Download session data as JSON or Markdown files (implemented 2026-04-02; review nits tracked in `.planning/ROADMAP.md`)

### Next Up
- [ ] **v2.4 — Security Review Hardening** (from 2026-04-02 full-repo security review):
  - ✅ **Phase 13 (HIGH): LLM prompt-injection hardening** — DONE 2026-09-06 (`bb5ea62`): sample sanitization, untrusted-data fences, last-match parser, mood↔signal polarity reconciliation, strict summary validation, +20 adversarial tests
  - ✅ **Phase 14 (HIGH): Model supply-chain integrity** — MiniLM pinned to HF commit (`49052f1`); DOMPurify pinned + provenance/SHA-256 in `VENDORED.md`; `package-lock.json` committed + `npm ci` in packaging. WebLLM/Qwen provenance + weight-pinning items obsoleted by the Nano migration (Phase 16). MiniLM bundling remains an optional follow-up.
  - **Phase 15 (MED): Trust boundaries** — sender validation + per-tab messaging, validate settings in onChanged, unify AI consent across options/sidebar
  - ✅ **Phase 16 (ARCH): Gemini Nano migration** — spike PASSED, then migrated: Nano is the primary summary/mood backend (Prompt API, pristine-session-per-call) with a rule-based fallback; WebLLM/Qwen fully removed (bundle, gpu-scheduler SLM path, consent modal, `unlimitedStorage`, HF `raw.githubusercontent.com` CSP entry). All hardening layers retained.
- [ ] **v2.5 — Analytics/Telemetry**: Opt-in anonymous usage stats to inform roadmap priorities
- [ ] **v2.6 — Onboarding Improvements**: Guided first-run experience to reduce churn
- [ ] **v2.7 — Streamer/Viewer Mode Toggle**: Different default views and priorities per user role
- [ ] **v2.8 — Clip Context**: Capture surrounding messages during sentiment spikes as shareable moments

### Backlog
- **Platform Expansion**: Add support for additional streaming platforms
  - **Kick** - Best candidate, similar architecture to Twitch
  - **Rumble** - Simpler DOM structure, growing audience
  - *Note: X Spaces investigated but tabled due to audio-first model and Shadow DOM complexity*
- **Alerts**: Notify when sentiment spikes (positive or negative)
- **Historical Trends**: Graphs showing sentiment/engagement over time during a stream
- User-configurable sentiment keywords
- Threshold calibration for semantic clustering per-category
- Moderator-specific features (flagging, quick actions)
- Multi-stream monitoring
- API/webhook integration for external tools

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
