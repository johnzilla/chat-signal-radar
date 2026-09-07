# Roadmap: Chat Signal

## Milestones

- ✅ **v1.0 Short-Term Improvements** — Phases 1-3 (shipped 2026-02-19)
- ✅ **v1.1 CWS Readiness** — Phases 4-6 (shipped 2026-02-20, Phase 7 deferred)
- ✅ **v1.2 Semantic AI Pipeline** — Phases 8-12 (shipped 2026-02-21)
- ✅ **v2.1 CWS Launch / v2.2 Landing Page** — shipped out-of-band (git log; see CLAUDE.md)
- ✅ **v2.3 Session Export** — shipped: nits fixed, export tests added, committed
- 🚧 **v2.4 Security Review Hardening** — Phases 13-16 (Phase 13 complete, Phase 14 partial)

## Phases

<details>
<summary>✅ v1.0 Short-Term Improvements (Phases 1-3) — SHIPPED 2026-02-19</summary>

- [x] Phase 1: Analysis Window (2/2 plans) — completed 2026-02-19
- [x] Phase 2: DOMPurify Integration (2/2 plans) — completed 2026-02-19
- [x] Phase 3: Configurable Thresholds (3/3 plans) — completed 2026-02-19

</details>

<details>
<summary>✅ v1.1 CWS Readiness (Phases 4-6) — SHIPPED 2026-02-20</summary>

- [x] Phase 4: Privacy and Dashboard Compliance (2/2 plans) — completed 2026-02-20
- [x] Phase 5: Manifest Audit and Disclosure UI (2/2 plans) — completed 2026-02-20
- [x] Phase 6: Store Listing Assets (2/2 plans) — completed 2026-02-20
- [ ] Phase 7: Verification and Submission — deferred (VERIF-01, VERIF-02 pending)

</details>

<details>
<summary>✅ v1.2 Semantic AI Pipeline (Phases 8-12) — SHIPPED 2026-02-21</summary>

- [x] Phase 8: Encoder Foundation (2/2 plans) — completed 2026-02-20
- [x] Phase 9: GPU Scheduler (1/1 plan) — completed 2026-02-20
- [x] Phase 10: Semantic Cosine Routing (2/2 plans) — completed 2026-02-20
- [x] Phase 11: Qwen SLM Swap (2/2 plans) — completed 2026-02-20
- [x] Phase 12: Integration and Hardening (2/2 plans) — completed 2026-02-21

</details>

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Analysis Window | v1.0 | 2/2 | Complete | 2026-02-19 |
| 2. DOMPurify Integration | v1.0 | 2/2 | Complete | 2026-02-19 |
| 3. Configurable Thresholds | v1.0 | 3/3 | Complete | 2026-02-19 |
| 4. Privacy and Dashboard Compliance | v1.1 | 2/2 | Complete | 2026-02-20 |
| 5. Manifest Audit and Disclosure UI | v1.1 | 2/2 | Complete | 2026-02-20 |
| 6. Store Listing Assets | v1.1 | 2/2 | Complete | 2026-02-20 |
| 7. Verification and Submission | v1.1 | 0/? | Deferred | - |
| 8. Encoder Foundation | v1.2 | 2/2 | Complete | 2026-02-20 |
| 9. GPU Scheduler | v1.2 | 1/1 | Complete | 2026-02-20 |
| 10. Semantic Cosine Routing | v1.2 | 2/2 | Complete | 2026-02-20 |
| 11. Qwen SLM Swap | v1.2 | 2/2 | Complete | 2026-02-20 |
| 12. Integration and Hardening | v1.2 | 2/2 | Complete | 2026-02-21 |

## Post-v1.2 Work (tracked per CLAUDE.md roadmap)

### v2.3 Session Export — IMPLEMENTED 2026-04-02 (uncommitted)

Files: `extension/sidebar/sidebar.js`, `sidebar.html`, `sidebar.css` (+173 lines).

- [x] Export session as JSON (blob download, `exportSession`)
- [x] Export session as Markdown (`generateSessionMarkdown`)
- [x] Export dropdown UI in summary modal; `currentDetailSession` bridging live + history views
- [x] Unit tests for `generateSessionMarkdown` + pure export helpers (`sanitizePlatform`, `buildExportFilename`, `pickDisplayBuckets`) — 5 tests, 68/68 passing
- [x] Fix review nits: (a) defer `URL.revokeObjectURL` past `a.click()`; (b) whitelist `session.platform` in filename via `sanitizePlatform`; (c) hide export menu on backdrop-dismiss + new session; (d) capture semantic buckets (`lastSemanticBuckets`) so export/save reflect what was displayed
- [x] Commit

### v2.4 Security Review Hardening — IN PROGRESS (started 2026-09-06)

Full-repo security review conducted 2026-04-02. Re-verification 2026-09-06: commits `bb5ea62` + `49052f1` landed on main.

- [x] Phase 13: LLM Prompt-Injection Hardening (HIGH-1) — COMPLETE 2026-09-06 (commit `bb5ea62`, +20 adversarial tests, 63/63 passing)
  - [x] `sanitizeChatSample()`: newline collapse, fence-marker strip, control-token neutralization (MOOD/CONFIDENCE/REASON/SYSTEM/ASSISTANT/USER), code-fence strip, 200-char cap — applied to all chat samples
  - [x] Untrusted-data fence (`<<<CHAT>>>…<<<END>>>`) + anti-instruction wording in both prompts and system messages
  - [x] `reconcileMoodWithSignals()`: LLM mood cross-checked against WASM lexicon polarity majority; contradiction → rule-based fallback
  - [x] Parser prefers LAST `MOOD:` (real answer beats echoed preamble); null-guarded
  - [x] `hasSummaryFormat` requires emoji/known-category prefix — injected prose can't render
  - Residual: tastefully-formatted injected lines (emoji + colon) can still pass validation; semantic instruction-following is reduced, not eliminated — acceptable given fallback layers
- [ ] Phase 14: Model Supply-Chain Integrity (HIGH-2) — PARTIAL (2026-09-06)
  - [x] MiniLM pinned to revision `751bff37182d3f1213fa05d7196b954e230abad9` on both pipeline calls; rotation documented in-code (commit `49052f1`) — verified SHA resolves on HF
  - [x] Dependabot group configured; `sharp` bumped (commit `6981a52`)
  - [ ] Record provenance + SHA-256 for `libs/web-llm/index.js` (upstream version/URL still unrecorded) + vendored DOMPurify; verify in script
  - [ ] Un-ignore `package-lock.json`, use `npm ci` in `scripts/package.sh`
  - [ ] Verify WebLLM weight-fetch pinning for the 400MB Qwen model (MLC registry pinning status unconfirmed)
  - [ ] Evaluate bundling MiniLM (~23MB) in the extension package (eliminates the always-on runtime fetch; commit scopes this as follow-up)
- [ ] Phase 15: Trust-Boundary Mediums
  - Sender validation + per-tab port routing (multi-window session mixing)
  - Validate settings in `chrome.storage.onChanged` listener (still bypasses `validateSettings`)
  - Unify AI consent: options-page AI toggle still bypasses disclosure + disk-space check
- [ ] Phase 16: Architecture Decisions
  - GPU scheduler never serializes SLM access; `registerDevice` has zero callers — wire WebLLM through it or delete (revisit if WebLLM replaced)
  - **Gemini Nano feasibility spike (Prompt API) — PASSED (2026-09-07).** Gate-2 replay of 72-batch fixture through live Nano, scored with the extension's own machinery (tests/fixtures/nano-batches.json + scripts/nano-spike-oneshot.js). Results: mood garbage/OOV 0%, summary hasFormat 100%, injection flips 0/8, mood p95 4.8s (<10s), summary p95 5.6s (<30s), reconcile agreement ~96% (caught 2-3 injection baits/run). Design rules learned: (1) clone a pristine session per call — sharing one stateful session across calls bloated latency 7x (30-57s); (2) keep the signal-authoritative fenced prompt (kept Nano on-enum + injection-resistant); (3) parseSentimentResponse + reconcileMoodWithSignals are load-bearing — Nano's own injection resistance is only ~60-75%.
  - **Decision pending:** adopt Nano as primary mood/summary backend with WebLLM→rule-based fallback (Nano is Chrome-only + hardware-gated, so it cannot be the only path). Adopting removes the 400MB Qwen download, the web-llm/index.js provenance gap, and the Qwen weight-pinning task from HIGH-2.

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 13. LLM Prompt-Injection Hardening | v2.4 | 2/2 | **Complete** | 2026-09-06 (`bb5ea62`, +20 adversarial tests, 63/63 pass) |
| 14. Model Supply-Chain Integrity | v2.4 | ~40% | In Progress | MiniLM pin 2026-09-06 (`49052f1`); sharp bump (`6981a52`) |
| 15. Trust-Boundary Mediums | v2.4 | 0/? | Planned | - |
| 16. Architecture Decisions | v2.4 | 0/? | Planned | - |
