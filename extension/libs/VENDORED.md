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

## SHA-256

```
9b494057fad6656fd9ce2089d0b6898df9632c10e45e4775a43073a46cffc8cb  extension/libs/dompurify/purify.min.js
```

`dompurify/purify.min.js` is byte-for-byte identical to the `dist/purify.min.js`
shipped in npm `dompurify@3.3.1` (verified), so it is fully pinned via
`package.json` + `package-lock.json`.

## Runtime model download

The MiniLM encoder (`Xenova/all-MiniLM-L6-v2`) is fetched at runtime by
Transformers.js from HuggingFace, pinned to a fixed commit revision in
`extension/sidebar/encoder-adapter.js` (`MODEL_REVISION`). See that file for the
pinned SHA and rotation instructions. This is the only remaining runtime model
download; the WebLLM/Qwen summarizer was removed in the Gemini Nano migration
(summarization now runs on Chrome's built-in on-device model, no download or
fetch surface of its own).
