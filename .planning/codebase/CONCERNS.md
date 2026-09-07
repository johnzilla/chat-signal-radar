# Codebase Concerns

**Analysis Date:** 2026-02-19 (updated 2026-09-06: HIGH-1 resolved, HIGH-2 partial)

## Security Review Findings (2026-04-02)

Full-repo code + security review conducted 2026-04-02. Entries below supersede/extend older items. **Verification same day: both HIGH findings remain OPEN** — the v2.3 export changes did not touch them.

### HIGH-1: LLM Prompt Injection Undermines Mood/Summary Integrity — RESOLVED 2026-09-06 (`bb5ea62`)
- **Issue:** Raw chat messages interpolated directly into prompts; `MOOD:` scan-anywhere parser; trivial `hasSummaryFormat`.
- **Files:** `extension/llm-adapter.js`
- **Resolution:** Layered mitigation shipped: `sanitizeChatSample()` (newline collapse, fence-marker strip, control-token neutralization, 200-char cap), `<<<CHAT>>>…<<<END>>>` data fences + anti-instruction system messages, last-match MOOD parser, `reconcileMoodWithSignals()` polarity cross-check vs WASM signals (contradiction → rule-based fallback), strict `hasSummaryFormat` (emoji/known-category prefix). +20 adversarial unit tests; 63/63 passing.
- **Residual (accepted):** Semantic instruction-injection reduced, not eliminated; a tastefully-formatted injected line (emoji + colon) can still pass summary validation, bounded by fallback layers.

### HIGH-2: Runtime Model Downloads Lack Integrity Pinning — RESOLVED (2026-09-07)
- **Resolved:** MiniLM encoder pinned to HF commit `751bff37182d3f1213fa05d7196b954e230abad9` via `MODEL_REVISION` on both WebGPU/WASM pipeline calls; rotation process documented in-code (commit `49052f1`). Revision verified to resolve against the live HF endpoint.
- **Resolved via teardown:** (1) `libs/web-llm/index.js` and (2) the WebLLM 400MB Qwen weight-pinning concern are gone — WebLLM/Qwen was removed in the Nano migration (Phase 16); Nano runs on-device with no download or fetch surface. (3) `package-lock.json` committed + `npm ci` in `package.sh`. (4) DOMPurify pinned `3.3.1`, verified byte-identical to npm, SHA-256 in `VENDORED.md`.
- **Remaining (optional):** (5) MiniLM bundling (~23MB, eliminates the one remaining always-on runtime fetch) — the encoder still downloads MiniLM from HF, pinned to a fixed revision.
- **Files:** `extension/sidebar/encoder-adapter.js` (done), `extension/llm-adapter.js` (open), `scripts/vendor-transformers.sh`, `.gitignore`
- **Files:** `extension/sidebar/encoder-adapter.js`, `extension/libs/VENDORED.md`, `package-lock.json`, `scripts/package.sh`, `scripts/vendor-dompurify.sh`

### MED-1: Message Relay — No Sender Validation, Cross-Tab Session Mixing
- **Issue:** `background.js` relays any CHAT_MESSAGES; sidebar re-broadcast reaches every extension context in every window; no `sender` checks. Two streams in two windows merge into one session.
- **Files:** `extension/background.js`, `extension/sidebar/sidebar.js` (onMessage listener ~L1050)
- **Fix approach:** Validate sender; port-based per-tab messaging (also fixes always-on observer CPU cost). Planned as Phase 15.

### MED-2: Validation Bypass Paths
- **Issue:** `chrome.storage.onChanged` listener merges settings without `validateSettings`; options-page AI toggle writes `aiSummariesEnabled: true` directly, bypassing consent disclosure + disk-space check.
- **Files:** `extension/sidebar/sidebar.js` (onChanged ~L340, checkAISettings), `extension/options/options.js` (AI toggle handler)
- **Fix approach:** Validate in onChanged; route options toggle through the same consent function as the modal. Planned as Phase 15.

### MED-3: GPU Scheduler SLM Path — RESOLVED (2026-09-07)
- **Resolution:** WebLLM removed in the Nano migration (Phase 16), so the dead 'slm' path is gone. `gpu-scheduler.js` is KEPT — it serializes the MiniLM encoder's WebGPU access (its real, in-use consumer). Dead `registerDevice` (zero callers) removed. Nano runs off the GPU queue entirely.
- **Files:** `extension/sidebar/modules/gpu-scheduler.js`, `extension/sidebar/encoder-adapter.js`

### New Correctness Findings (v2.3 export + content extraction)
- Double-escaping: `safeCreateElement(tag, cls, escapeHtml(text))` renders entities literally via textContent — chat text with `&`/`<`/`>` displays wrong.
- Observer captures only first matching descendant per subtree — messages dropped in bursts; no removal handling for moderated messages; YouTube `<img>` emotes lose alt text.
- SPA nav: isolated-world `history.pushState` patch never catches page navigation — use YouTube `yt-navigate-finish` DOM event.
- `saveSession` read-modify-write race (auto-save vs manual click).
- v2.3 nits: revokeObjectURL-immediately-after-click race; platform not whitelisted in filename; export menu persists on backdrop-close; no tests for new export functions.

## Tech Debt (from 2026-02-19 analysis)

### 1. Large Bundled WebLLM Library — RESOLVED (2026-09-07)
- **Resolution:** The 6.5MB `extension/libs/web-llm/index.js` bundle was deleted in the Nano migration (Phase 16). Summarization now uses Chrome's built-in Gemini Nano — no bundled model, no shipped LLM blob. Extension package shrinks accordingly.

### 2. Repeated Sentiment Analysis Logic
- **Issue:** Sentiment analysis is implemented in two places: Rust WASM (`wasm-engine/src/lib.rs` lines 274-342) and JavaScript fallback (`extension/llm-adapter.js` lines 349-417)
- **Files:** `wasm-engine/src/lib.rs`, `extension/llm-adapter.js`
- **Impact:** Inconsistent behavior between WASM and fallback engines; bugs fixed in one place won't be reflected in the other
- **Fix approach:** Keep single source of truth in WASM, have JS only format/display results. Remove duplicate logic from `computeFallbackSentiment` or move entirely to Rust.

### 3. Duplicate HTML Escaping and Safe DOM Creation
- **Issue:** `DOMHelpers.js` provides `escapeHtml()` and safe creation functions, but these utilities are not consistently used throughout codebase. Sidebar uses mixture of safe and unsafe innerHTML patterns.
- **Files:** `extension/sidebar/utils/DOMHelpers.js`, `extension/sidebar/sidebar.js` (lines 360, 390, 417, 441, 521, 564, 585, 775, 795, 808, 826, 838, 853, 968, 1094, 1118)
- **Impact:** Increased risk of XSS vulnerabilities if chat messages or topics contain HTML-like content. Pattern matching in `safeSetHTML()` (lines 24-29 of DOMHelpers.js) is too restrictive and prevents legitimate safe usage.
- **Fix approach:** Replace all `innerHTML` assignments with consistent safe DOM building using `document.createElement`, `textContent`, and `appendChild`. Remove overly restrictive pattern validation. Use template literals with proper escaping only for dynamic content.

### 4. Global State in sidebar.js
- **Issue:** Multiple global variables tracking session state scattered throughout `extension/sidebar/sidebar.js` (lines 680-91): `allMessages`, `sessionStartTime`, `lastAnalysisResult`, `currentPlatform`, `currentMood`, `sessionQuestions`, `sessionSentiment`, `totalMessageCount`, `lastSentimentUpdate`, `currentStreamTitle`, `currentStreamUrl`
- **Files:** `extension/sidebar/sidebar.js` (lines 680-91)
- **Impact:** Hard to reason about state changes; prone to race conditions; difficult to test; multiple modules independently modify global state (sidebar.js, SessionManager.js, StateManager.js creating three parallel state systems)
- **Fix approach:** StateManager exists but isn't fully integrated into sidebar.js. Migrate all session/message state into StateManager exclusively. Remove parallel state variables from sidebar.js. Create clear ownership model.

### 5. Missing Error Boundaries in async/await Chains
- **Issue:** Multiple unhandled promise rejections in `initWasm()` (lines 206-232), `checkAISettings()` (lines 235-255), `startLLMInitialization()` (lines 258-272), and message processing pipeline
- **Files:** `extension/sidebar/sidebar.js`, `extension/llm-adapter.js`
- **Impact:** Silent failures; UI shows "Loading..." indefinitely; users don't know if service is stuck. WASM loading errors don't cascade properly to show fallback state.
- **Fix approach:** Wrap async initialization in proper try-catch with timeout guards. Add progress indicators that show errors. Implement retry logic with exponential backoff for network-dependent operations (LLM downloads).

## Known Bugs

### 1. Container Monitoring Race Condition in Content Script
- **Symptoms:** Chat observer stops working after container is detached and reattached (e.g., user hides/shows chat or navigates between streams)
- **Files:** `extension/content-script.js` (lines 94-110, 150-177)
- **Trigger:** In `startContainerMonitor()` at 5-second intervals, if chat container detaches but `resetObserver()` race condition occurs, observer may not reattach properly
- **Root cause:** Between checking `stillPresent` and calling `resetObserver()`, container can be attached to new parent, creating orphaned observer
- **Workaround:** User can reload extension or switch tabs
- **Fix:** Use MutationObserver on parent container instead of polling, or add debounce to prevent rapid attach/detach cycles

### 2. WebLLM Initialization Hang on Slow Networks
- **Symptoms:** UI stuck at "Loading AI: XX%" for extended periods; sidebar unresponsive
- **Files:** `extension/llm-adapter.js` (lines 14-70), `extension/sidebar/sidebar.js` (lines 258-272)
- **Trigger:** Slow network during first-time model download (~400MB); no timeout mechanism
- **Root cause:** `initializeLLM()` has no timeout; WebLLM's internal progress callbacks may stall
- **Workaround:** Close and reopen sidebar, or disable AI and skip consent
- **Fix:** Add 30-60 second timeout with user abort option; implement download progress with pause/resume

### 3. Session Data Loss on Rapid Stream Switches
- **Symptoms:** Previous session data lost when user switches between streams or tabs quickly
- **Files:** `extension/sidebar/sidebar.js` (lines 717-731), `extension/sidebar/modules/StateManager.js` (line 110-126)
- **Trigger:** `processMessages()` called for new stream before `endSession()` completes; `allMessages` array cleared (line 947) before storage write
- **Root cause:** Async storage operations don't block state resets; inactivity detection (120-second timeout) is too long to catch rapid switches
- **Workaround:** Keep sidebar open while monitoring single stream; don't switch streams quickly
- **Fix:** Queue session-end operations; add mutex/semaphore to prevent concurrent session operations

## Security Considerations

### 1. Content Security Policy - WASM Execution
- **Risk:** `wasm-unsafe-eval` directive in `extension/manifest.json` (line 49) is required for WASM but is powerful escape hatch
- **Files:** `extension/manifest.json`
- **Current mitigation:** WASM binary is fetched from extension's own resources only (`chrome.runtime.getURL()`), not from network
- **Recommendations:**
  - Document why `wasm-unsafe-eval` is required (WASM needs runtime code generation)
  - Audit WASM output validation in `processMessages()` (lines 299-312 of sidebar.js) to ensure no injection vectors
  - Consider code-signing WASM binaries if distribution expands beyond Chrome Web Store

### 2. Chat Message Content Injection via innerHTML
- **Risk:** Multiple `innerHTML` assignments with user-generated chat content could enable XSS if escaping fails
- **Files:** `extension/sidebar/sidebar.js` (lines 360, 390, 441, 521, 564, 585, 775, 795, 808, 826, 838, 853, 1118)
- **Current mitigation:** `escapeHtml()` utility used in some places (lines 379, 386, 442, 524)
- **Recommendations:**
  - Audit all 18 innerHTML assignments; ensure each either: (a) uses `textContent`, or (b) uses `escapeHtml()` for all dynamic content
  - Replace innerHTML with `appendChild(document.createElement())` pattern throughout
  - Add CSP violation monitoring to detect injection attempts

### 3. Storage Access without Consent Model
- **Risk:** Extension stores chat message summaries, sentiment, stream titles in `chrome.storage.local` without explicit privacy notice
- **Files:** `extension/storage-manager.js` (entire file), `extension/sidebar/sidebar.js` (session saving, lines 1000-1040)
- **Current mitigation:** Data stored locally only, not transmitted; user can clear history via UI
- **Recommendations:**
  - Add privacy policy link in options page explicitly stating what's stored
  - Implement "auto-delete" option for sessions older than N days
  - Show data size warning when approaching storage limits (Chrome storage is limited to 10MB per extension)

### 4. LLM Model Download - Integrity Verification
- **Risk:** WebLLM downloads ~400MB model from HuggingFace CDN on first use; no integrity checking
- **Files:** `extension/llm-adapter.js` (lines 27-47), `extension/manifest.json` (line 49 allows `https://cdn-lfs.huggingface.co`)
- **Current mitigation:** HTTPS provides transport security; WebLLM library handles download
- **Recommendations:**
  - Verify WebLLM's hash verification for downloaded models
  - Document in setup that first AI use requires ~400MB download
  - Consider bundling quantized version if file size is critical

## Performance Bottlenecks

### 1. Message Processing Every 5 Seconds on 100 Message Window
- **Problem:** Content script batches messages every 5 seconds (line 4 of `content-script.js`) and analyzes all 100 retained messages via WASM
- **Files:** `extension/content-script.js` (line 4: `BATCH_INTERVAL = 5000`), `extension/sidebar/sidebar.js` (line 681: `MAX_MESSAGES = 100`)
- **Cause:** For high-volume chats (100+ msg/sec), this means full re-analysis of same messages repeatedly
- **Current threshold:** With 100 message window, a single sentiment analysis of 100 messages takes negligible time in WASM, but repeated clustering is wasteful
- **Improvement path:**
  - Track last-analyzed-message-count; only run clustering on delta (new messages since last analysis)
  - Increase batch interval to 10 seconds for chats below 50 msg/sec
  - Implement incremental sentiment updates instead of full re-analysis
  - Consider moving to event-driven (message-received) vs time-driven batching

### 2. Inline LLM Calls Block UI During Sentiment Analysis
- **Problem:** `updateMoodIndicator()` (lines 451-493) awaits LLM sentiment analysis on main thread during message processing
- **Files:** `extension/sidebar/sidebar.js` (line 459: `await analyzeSentiment(messages, sentimentSignals)`)
- **Cause:** LLM inference for sentiment takes 500ms-2s; UI is frozen during this time
- **Improvement path:**
  - Debounce sentiment analysis to every 10+ seconds instead of per-batch
  - Run sentiment analysis in background/deferred task
  - Implement local cache: reuse sentiment result if chat sentiment signals unchanged
  - Show stale sentiment while computing new one (optimistic update)

### 3. Session Summary Rendering Creates Full DOM on Every Switch
- **Problem:** `renderSummaryModal()` (lines 760-860) and `renderHistoryList()` (lines 1088-1230) rebuild entire DOM from scratch every time view switches
- **Files:** `extension/sidebar/sidebar.js` (lines 760-860, 1088-1230)
- **Cause:** Use `innerHTML = ''` to clear then rebuild; no virtual DOM or diffing
- **Improvement path:**
  - For session list: implement pagination (show 5-10 per page) instead of all 50
  - Cache rendered history view; update only changed elements
  - Lazy-load session details (don't fetch all data until user clicks session)

## Fragile Areas

### 1. Sentiment Sample Display Logic
- **Files:** `extension/sidebar/sidebar.js` (lines 496-526)
- **Why fragile:** Complex conditional logic based on mood determines which samples to show. If sentiment signals array structure changes in WASM, UI breaks silently
- **Safe modification:** Add defensive checks: `if (!signals || !signals.negative_samples) { return; }` before each sample access. Add unit tests for each mood path.
- **Test coverage gaps:** No tests for `updateSentimentSamples()` mood display logic with missing/malformed signals

### 2. Container Detection for YouTube and Twitch
- **Files:** `extension/content-script.js` (lines 127-148)
- **Why fragile:** DOM selectors are hardcoded (`#chatframe`, `#items` for YouTube; `.chat-scrollable-area__message-container` for Twitch). YouTube and Twitch redesigns break selectors without warning
- **Safe modification:**
  - Create a selector registry with fallback chains: try primary selector, if not found try secondary, etc.
  - Add tolerance for iframe access failures (YouTube iframe sometimes blocks access)
  - Test monthly against live sites or use headless testing
- **Test coverage gaps:** Integration tests against live YouTube/Twitch streams are missing

### 3. Inactivity Detection Timeout
- **Files:** `extension/sidebar/modules/SessionManager.js` (lines 128-145), `extension/sidebar/sidebar.js` (line 111: `INACTIVITY_TIMEOUT = 120000`)
- **Why fragile:** 2-minute timeout is hardcoded and applies globally. Doesn't account for:
  - Moderators in dead chats (should not trigger "stream ended" prompt after 2 min of inactivity)
  - Live streams that go quiet for 2+ minutes (should not end session)
  - Extension being backgrounded (timer still runs, wastes CPU)
- **Safe modification:** Make configurable in settings. Only trigger prompt if user explicitly clicks "End Session" or after inactivity threshold. Pause timer when window is not in focus.
- **Test coverage gaps:** No tests for inactivity detection edge cases (backgrounding, clock changes)

## Scaling Limits

### 1. Session History Storage Limit
- **Current capacity:** `MAX_SESSIONS = 50` (line 5 of `storage-manager.js`)
- **Limit:** Chrome `storage.local` has 10MB limit per extension; with full cluster/sentiment data, ~150-200 sessions before quota exceeded
- **Scaling path:**
  - Implement data compression (ZIP session summaries)
  - Implement archival system (export to local file, clear from storage)
  - Reduce stored detail (store only summary stats, not full sample messages)

### 2. Message Window for Analysis
- **Current capacity:** `MAX_MESSAGES = 100` messages processed per analysis batch
- **Limit:** Hyper-active chats (1000+ msg/min) will miss 90% of messages; analysis becomes stale
- **Scaling path:**
  - Track cumulative sentiment across entire session in StateManager (already implemented, lines 101-106 of sidebar.js)
  - Implement sliding window analysis: keep last 200 messages, analyze every 100 new messages
  - Add sampling: for chats >1000 msg/min, analyze every Nth message

### 3. Topics List Size
- **Current capacity:** Top 20 topics extracted from WASM (line 247 of `wasm-engine/src/lib.rs`)
- **Limit:** For 100-message window, effectively 20 max unique terms; high-variance chats will have poor topic quality
- **Scaling path:**
  - Increase to 50 topics; filter UI to show top 10
  - Implement N-gram topics (2-3 word phrases) in addition to unigrams
  - Add keyword normalization (stemming) to reduce duplicates

## Dependencies at Risk

### 1. WebLLM Library Version Lock
- **Risk:** `extension/libs/web-llm/index.js` is manually bundled; no way to update WebLLM without manual rebuild
- **Impact:** If WebLLM has security bug or model compatibility issue, extension cannot auto-update
- **Migration plan:**
  - Switch to npm-based WebLLM dependency with build step
  - Or: Remove WebLLM entirely, use simpler local NLP library (compromise: less accurate but smaller)
  - Document current WebLLM version in README

### 2. Manifest V3 API Dependency
- **Risk:** Extension built entirely on Manifest V3 (required for Chrome Web Store publication)
- **Impact:** Manifest V4 when released may require rewrite; service workers have different lifecycle than background pages
- **Migration plan:**
  - No immediate action (Manifest V2 deprecation timeline pushed back)
  - Monitor Chrome extensions API roadmap quarterly
  - Use abstraction layer for background messaging if adding new APIs

## Missing Critical Features

### 1. Error Recovery UI
- **Problem:** When WASM loading fails, UI shows generic error with no recovery option. User must manually reload extension.
- **Blocks:** Extension unusable without WASM
- **Solution:** Add "Reload Engine" button, implement retry logic with exponential backoff, show last-known-good state while retrying

### 2. Network Error Handling for LLM Downloads
- **Problem:** If user loses internet while LLM model is downloading (400MB), download restarts from zero on reconnect
- **Blocks:** Users on slower connections can't reliably enable AI
- **Solution:** Implement pause/resume for downloads, save partial downloads, verify checksums

### 3. Duplicate Platform Support Testing
- **Problem:** Code has Twitch/YouTube selectors, but Kick/Rumble roadmap items (CLAUDE.md) are not implemented
- **Blocks:** Can't expand to new platforms without major rework
- **Solution:** Implement platform plugin system: abstract chat selectors and message extraction into pluggable modules

## Test Coverage Gaps

### 1. WASM Output Validation
- **What's not tested:** Edge cases in cluster validation (lines 369-371 of sidebar.js) - what happens with malformed bucket shapes?
- **Files:** `extension/sidebar/sidebar.js` (lines 299-312)
- **Risk:** Bad WASM output could crash UI rendering
- **Priority:** High - add schema validation tests in integration suite

### 2. LLM Adapter Fallback Paths
- **What's not tested:** `computeFallbackSentiment()` with edge cases (0 messages, all neutral, mismatched signal counts)
- **Files:** `extension/llm-adapter.js` (lines 349-417)
- **Risk:** Fallback mode breaks silently if signals object structure unexpected
- **Priority:** High - add unit tests for all mood classification paths

### 3. Session Persistence Edge Cases
- **What's not tested:** Concurrent saves (two sessions saved simultaneously), storage quota exceeded, session data corruption recovery
- **Files:** `extension/storage-manager.js`
- **Risk:** User loses session history if quota exceeded; no recovery mechanism
- **Priority:** Medium - add storage error handling tests

### 4. Content Script Multi-Platform
- **What's not tested:** Extract message functions with malformed YouTube/Twitch DOM; nested message elements; hidden/removed chat containers
- **Files:** `extension/content-script.js` (lines 18-42)
- **Risk:** Partial message extraction or crashes if platform changes selectors
- **Priority:** Medium - add headless integration tests against mock DOM

---

*Concerns audit: 2026-02-19*
