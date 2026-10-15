# Publishing Full and Slim Editions

[Back to README](../README.en.md) · [简体中文](./releases.md)

One version, tag and Release contains the full edition and the fixed-profile WebGL2 / 128x128 DOM slim edition. The default npm/CDN package is the full edition. Slim fixes the ordinary-webpage recommendation, `browser-overlay + screen + dom-backdrop`, and retains clicks, trails, shards, Bloom and compositing references. Constructors accept host and callback options only; compositing settings, theme, scale, DPR cap and FX settings require a source rebuild. It has no alternate rendering backend fallback.

## Local Preparation and Acceptance

Synchronize package.json, the lockfile, Changelog, bilingual documentation and download links, then run:

```bash
npm ci
npm run check:release
npm run release:prepare
npm run test:browser:slim -- --release-assets
npm run test:browser:zopfli -- --release-assets
```

The complete gate retains runtime, type, browser, Worker, lifecycle and device coverage. Slim additionally checks lossless resource bytes, four scenes against the accepted 128x128 reference, input, multiple instances, initialization failure and WebGL context restoration. `npm run benchmark:custom` remains separate from default release acceptance.

`release:prepare` freshly builds both editions in `dist-release`, verifies ZIP contents and writes SHA256SUMS. `test:browser:slim -- --release-assets` checks the exact JS intended for upload. `build-info.json` records version, commit and working-tree state; tagged release sources must be committed and clean. Experiment reports are excluded from assets.

Full, slim and ordinary custom builds default to Zopfli (15 iterations), with bundled synchronous fflate decoding. Full retains 512x512 trails and all APIs/backends; slim retains its 128x128 profile. Build metadata records encoding, size and compression parameters. Preparation requires Zopfli, equal full/Worker modules, and complete licenses. Raw/gzip/Brotli reports show current bytes, byte deltas, and percentage deltas against SHA-256-verified v1.3.11 assets, without a size limit. `test:browser:zopfli` compares pixels byte for byte in four scenes using both exact upload modules and that independent baseline. Resource, type, pixel, and hash failures still fail acceptance; required checks may not be skipped.

Zopfli adds build time. Run `npm run benchmark:codecs` explicitly; it records cold build, decode, import and initialization separately, with local measurement limits. Before delivery, commit all changes and regenerate assets from a clean tree. Keep work on the experimental branch until the later merge/tag/publication stage; npm publication is separate.

## Assets

| Contents | Files |
|---|---|
| Existing full entries and declarations | `ba-click-fx.js`, `ba-click-fx.d.ts`, `config.js`, `config.d.ts`, `worker.js`, `worker.d.ts` |
| Slim module and declarations | `ba-click-fx.slim-webgl2-128.js`, `ba-click-fx.slim-webgl2-128.d.ts` |
| Full ZIP | `ba-click-fx-v<version>-full.zip` |
| Slim ZIP | `ba-click-fx-v<version>-slim-webgl2-128.zip` |
| SHA-256 of all ten files | `SHA256SUMS` |

ZIPs contain usage notes, build information, LICENSE and THIRD_PARTY_NOTICES.md. Slim also includes profile.json. Both editions and the npm package include the complete fflate license once. Full declarations describe package imports; npm is recommended for TypeScript. Slim declarations support relative ESM imports of the matching file. The script records gzip/Brotli sizes for comparison; separate compressed script assets are not published. GitHub Source code attachments are automatic source archives.

## Tag Publication

Merge into main and confirm Build CI passed for that commit. Create and push a tag only when actually publishing:

```bash
git tag -a v1.3.13 -m "发布v1.3.13：完整版与WebGL2精简版"
git push origin v1.3.13
```

The tag reruns the same workflow. Linux checks packaging and custom builds; Windows prepares assets and runs full browser and slim acceptance. After both pass, the publishing job checks version, commit and SHA256SUMS, creates a draft, uploads 11 assets, downloads them to verify their count and hashes, then publishes. A failure prevents formal publication; a verification failure after upload leaves a draft for diagnosis.
