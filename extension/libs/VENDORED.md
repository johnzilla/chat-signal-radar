# Vendored library provenance

Third-party code shipped inside the extension. Each entry records where the
file came from, its version, license, and a SHA-256 so the committed bytes are
tamper-evident and reproducible.

Verify all hashes at any time:

```bash
sha256sum extension/libs/dompurify/purify.min.js
```

| File | Version | License | Source | Reproducible via |
|------|---------|---------|--------|------------------|
| `dompurify/purify.min.js` | 3.3.1 | Apache-2.0 / MPL-2.0 | [cure53/DOMPurify](https://github.com/cure53/DOMPurify) (npm `dompurify@3.3.1`) | `scripts/vendor-dompurify.sh` |
| `transformers/` (git-ignored, generated) | `@huggingface/transformers` ^3.8.1 | Apache-2.0 | [huggingface/transformers.js](https://github.com/huggingface/transformers.js) | `scripts/vendor-transformers.sh` |
| `models/Xenova/all-MiniLM-L6-v2/` (git-ignored, generated) | commit `751bff37` | Apache-2.0 | [Xenova/all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2) | `scripts/vendor-minilm.sh` |

## SHA-256

```
9b494057fad6656fd9ce2089d0b6898df9632c10e45e4775a43073a46cffc8cb  extension/libs/dompurify/purify.min.js
```

`dompurify/purify.min.js` is byte-for-byte identical to the `dist/purify.min.js`
shipped in npm `dompurify@3.3.1` (verified), so it is fully pinned via
`package.json` + `package-lock.json`.

## Models — no runtime downloads

Both models the extension uses ship without any runtime network fetch:

- **MiniLM encoder** (`Xenova/all-MiniLM-L6-v2`, embeddings) is **bundled** under
  `extension/libs/models/`, vendored by `scripts/vendor-minilm.sh` at the commit
  pinned in `encoder-adapter.js` (`MODEL_REVISION`). Transformers.js loads it
  locally (`allowRemoteModels=false`, `localModelPath=libs/models/`), so the CSP
  `connect-src` is `'self'` only — HuggingFace host changes (e.g. the Xet/AWS-CDN
  migration) can no longer break the encoder. To rotate: bump `MODEL_REVISION`
  and re-run the vendor script.
- **Summarization/mood** runs on Chrome's built-in **Gemini Nano** (on-device,
  managed by the browser) — no bundled weights, no fetch surface of its own.

The model files are git-ignored (like the vendored Transformers.js runtime) and
re-created by the vendor scripts, which `scripts/package.sh` runs before zipping.
