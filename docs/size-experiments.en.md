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

## Live pages for manual review

```bash
npm run experiment:live
```

This command rebuilds baseline, lossless, 128² trail, and procedural variants for WebGL2, WebGPU, and Native: 12 outputs. It then starts a local server and prints URLs for a light article, dark dashboard, and colorful illustration page. Keep the process running during browser review; Ctrl+C stops it.

Each page keeps the baseline on the left and allows other variants on the right. Click, drag, or scroll either side to mirror input. Controls provide looping gestures, pause, clear, and separate full-page links for each version. Unavailable backends display failure without switching. Isolated pages share a random seed while retaining normal clocks and RAF. Messages and frame scheduling introduce small differences, so manual observation does not replace fixed-time byte equality acceptance.

Review pages use the [official Dark Reader page lock](https://github.com/darkreader/darkreader/blob/main/CONTRIBUTING.md#disabling-dark-reader-on-your-site) to retain their colors and prevent text selection so recoloring and selection popups do not alter the background comparison.

## Strategies

| Name | Change | Visual requirement |
|---|---|---|
| `baseline` | Current custom build | Reference |
| `minified` | Further code optimization, variable mangling, and whitespace removal | Byte-identical pixels |
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

Repeated active-trail runs of the same Software artifact produced two hashes differing by two levels in one channel. Native/Software image comparisons therefore explicitly use Canvas2D contexts with `willReadFrequently: true`; lossless acceptance still requires byte equality. Performance is measured separately with default contexts to exclude the comparison rasterization policy from optimization benefits.

Cold import and initialization each use three separate browser contexts. CPU frame times use 90 samples and report p50/p95. They include update/submission, not GPU memory or physical display FPS. Headless Extended output does not establish physical HDR display acceptance.

Sizes cover deployment JS and actual external assets, compressed individually before summation. Declarations, licenses, and HTTP headers are separate. Compare both entry JS and combined asset totals for the external strategy.

## Recorded results

The full-feature WebGL2 DOM profile on source version 1.3.9 produced these results. Raw size measures the deployment files; gzip measures compressed transfer size. Both include actual external assets. See the local report for other profiles and images.

| Strategy | Total raw KiB | Total gzip KiB | gzip reduction |
|---|---:|---:|---:|
| Current custom build | 440.5 | 198.5 | — |
| Final minification | 412.3 | 195.2 | 1.7% |
| Lossless DEFLATE | 299.5 | 145.1 | 26.9% |
| 256² trail | 251.0 | 108.9 | 45.1% |
| 128² trail | 217.7 | 83.8 | 57.8% |
| Procedural textures | 153.6 | 43.9 | 77.9% |
| External DEFLATE | 274.7 | 143.9 | 27.5% |

Lossless full-feature Native/Software profiles drop from 194.7/203.6 KiB gzip to 95.4/104.0 KiB, reducing size by 51.0%/48.9%. These gains also include removing Coverage resource initialization unused by those backends; one backend's reduction cannot be applied to others. The click-only Native procedural strategy drops from 52.7 KiB to 23.7 KiB gzip.

Lossless encoding is the first candidate for adoption. Downsampling requires review of active trails, known backgrounds, and later dissolution. Procedural generation offers the greatest reduction but changes disk contours, texture detail, and dissolution patterns. External loading primarily reduces entry JS while adding a request; this prototype provides little combined transfer reduction.

Current image comparisons use 320×240 readback scenes. Their difference metrics do not establish visual changes for every DPR, trail width, or user parameter.

This run completed all 63 experiment builds, 231 image samples, and 42 Worker fault checks on Edge 149.0.4022.69 without device skips. The lossless trail's RGB, Coverage, and RGBA decoded arrays total 2 MiB and match source bytes. All six external-resource rejection checks passed for 404, short headers, and invalid lengths in DOM/real Workers. `npm run check` and the existing `npm run test:custom:release` passed; all 67 browser custom cases matched pixels without skips. Interactive report selectors, image loading, and background switching were checked.

These strategies belong to the experiment command and are not production profile options. This branch evaluates choices rather than replacing a release.
