# Custom build size experiments

[中文](./size-experiments.md) · [Custom build guide](./custom-build.en.md)

These tools compare source-built custom bundles, cold loading, and visual changes. They reuse the compiler and browser fixture and write all output to the ignored `test-results/size-experiments` directory. Ordinary builds, production profile fields, npm package contents, and production rendering retain their behavior.

## Run

Requires Node.js >=24 and Chrome/Edge. Run `npm ci` first. Set `BACLICKFX_CHROMIUM_PATH` if browser discovery fails.

```bash
npm run experiment:size
# Rebuild and compare every strategy for one profile
npm run experiment:size -- --profile=webgl2-dom
# Compare one strategy, automatically including the baseline
npm run experiment:size -- --profile=webgl2-dom --strategy=trail-128
# Build sizes only, without browser evaluation
npm run experiment:size -- --build-only --profile=native-click-dom
```

A complete run compares 9 profiles and 7 strategies: 63 builds covering six backends, DOM/manual Canvas/real Dedicated Worker integration, click-only, and trail-only configurations. Each invocation rebuilds the selected cases from current source; old files never substitute for acceptance.

## Strategies

| Name | Change | Visual requirement |
|---|---|---|
| `baseline` | Current custom build | Reference |
| `minified` | Further whitespace minification | Byte-identical pixels |
| `lossless-deflate` | Paeth + DEFLATE, synchronous decoding, removable resource initialization, final minification | Byte-identical pixels |
| `trail-256` | Average-downsampled 256² trail, otherwise the lossless strategy | Record actual differences |
| `trail-128` | Average-downsampled 128² trail, otherwise the lossless strategy | Record actual differences |
| `procedural` | Deterministic functions generate Trail, Circle, and Ring3 | Record actual differences |
| `external-deflate` | Original-size trail in a separate `trail.bin`, loaded during module import | Byte-identical pixels |

The procedural strategy retains the rendering pipeline, parameters, motion algorithms, and triangle texture. It is not a complete Lite renderer. Generation consumes no particle-system random numbers, preserving motion for identical input.

The external strategy uses top-level await and targets ES2022. Construction remains synchronous, but import waits for an additional request; a failed resource request rejects module import. The binary currently contains RGB and Coverage streams together. Native/Software totals include unused streams because this prototype does not yet split resources by consumer.

`fflate` is an experiment-only development dependency. Outputs that use its decoder retain its MIT license in `THIRD_PARTY_NOTICES.md`.

## Reports and acceptance

A successful run generates:

- `results.json`: actual file inventories, raw/gzip/Brotli byte counts, and browser results.
- `browser-results.json`: pixel equality, differences, timings, and fault checks for each profile/strategy.
- `report.md` and `report.html`: tables and interactive comparisons of profiles, strategies, frames, and dark/white/checkerboard backgrounds.
- `early`, `late`, `active-trail`, and `reference` PNGs and four-times difference images in each build directory. Irrelevant trail/reference cases are omitted.

Each profile uses identical random numbers, input, logical time, backend, and integration. Lossless strategies require matching pixel hashes. Lossy strategies record full-frame and active-region RGBA MAE, changed pixels, and maximum channel error without updating existing golden data or weakening lossless acceptance. Empty pixels dilute full-frame MAE; it is not an overall visual-fidelity percentage.

All strategies reuse multi-instance, pause, resize/DPR, clearing, and repeated-destruction checks. Worker cases also cover initialization failure, WebGL context restoration, WebGPU destruction during initialization, device loss, and Standard output fallback. Unavailable or skipped devices fail the run.

Cold import and initialization each use three separate browser contexts. CPU frame times use 90 samples and report p50/p95. They include update/submission, not GPU memory or physical display FPS. Headless Extended output does not establish physical HDR display acceptance.

Sizes cover deployment JS and actual external assets, compressed individually before summation. Declarations, licenses, and HTTP headers are separate. Compare both entry JS and combined asset totals for the external strategy.

## Recorded results

The full-feature WebGL2 DOM profile on source version 1.3.9 produced these gzip totals. See the local report for other profiles and images.

| Strategy | Total JS + assets, KiB |
|---|---:|
| Current custom build | 198.5 |
| Final minification | 195.2 |
| Lossless DEFLATE | 145.1 |
| 256² trail | 108.9 |
| 128² trail | 83.8 |
| Procedural textures | 43.9 |
| External DEFLATE | 143.9 |

Lossless encoding is the first candidate for adoption. Downsampling requires review of active trails, known backgrounds, and later dissolution. Procedural generation offers the greatest reduction but changes disk contours, texture detail, and dissolution patterns. External loading primarily reduces entry JS while adding a request; this prototype provides little combined transfer reduction.

These strategies belong to the experiment command and are not production profile options. This branch evaluates choices rather than replacing a release.
