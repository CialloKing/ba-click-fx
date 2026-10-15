# Lossless texture compression experiments

[中文](texture-codec-experiments.md)

These experiments compare texture encoding in the full release and the fixed WebGL2 / 128² slim release. Each group retains its existing dimensions, parameters, features, and pixel bytes. Sizes include the required decoder. The experiment scripts run independently of normal builds and Releases; official profiles retain their existing encoding options.

## Reproduction

Use the project's required Node.js 24 or later, `npm ci`, and Chromium discoverable by the project:

```sh
# Build, verify eight resource arrays, and check browser pixels and lifecycle
npm run experiment:codecs

# Add cold import, initialization, and decoder measurements
npm run experiment:codecs -- --benchmark

# Build and verify resources only; filtering retains the relevant release baseline
npm run experiment:codecs -- --build-only --edition=full --codec=zstd
```

`--edition` accepts `full` and `slim`; `--codec` accepts `original`, `deflate`, `zopfli`, `brotli`, and `zstd`. `original` is only a full-edition baseline.

Each run rebuilds the selected artifacts and replaces the previous success state. Output is under `test-results/codec-experiments/`: `results.json`, `report.md`, `browser-results.json`, and each variant's `ba-click-fx.js`, `build-info.json`, verification module, four scene PNGs, and difference images. Verification modules and reports are not deployment resources and are excluded from JS size.

## Method

The official Paeth, Circle symmetry/RLE, Ring3 prediction/4-bit residuals, and mesh serialization are reused directly. Only the outer compression of six blocks changes: trail RGB, coverage, Circle RLE, Ring3 alpha, ring vertices, and indices. Triangle textures retain their current encoding.

For comparable codec measurements, experiments explicitly retain both audited Trail RGB and Coverage assets instead of enabling the Coverage reconstruction used by production 512x512 GPU builds. The historical measurements below also use both assets. Experimental sizes are not current release sizes; reconstruction savings require a separate comparison with the same codec and configuration.

| Variant | Build-time compression | Synchronous runtime decoder |
|---|---|---|
| `original` | Current full-edition LZ4 and other resource encodings | Current resource decoders |
| `deflate` | Node raw DEFLATE, level 9 | fflate 0.8.3 |
| `zopfli` | @gfx/zopfli 1.0.15, 15 iterations, raw DEFLATE output | fflate 0.8.3 |
| `brotli` | Node Brotli, quality 11 | brotli 2.1.0 JS decoder |
| `zstd` | Node Zstandard, level 22 | fzstd 0.1.1 |

Zopfli's WebAssembly runs only during the build. Normal execution decodes resources during module import and reuses the resulting arrays for rendering. Repeated decoding is used only for the decoder benchmark.

## Measurements on 2026-10-12

The source baseline is v1.3.11; Node 24.16.0, Windows, and local Chromium 149.0.4022.69. Both baseline JS files match the v1.3.11 release attachments byte for byte. KiB means 1024 bytes; gzip/Brotli columns compress the entire JS file for transfer.

| Edition | Encoding | JS raw KiB | gzip KiB | Brotli KiB |
|---|---|---:|---:|---:|
| Full | Current encoding | 655.8 | 248.5 | 217.3 |
| Full | DEFLATE | 518.6 | 195.3 | 170.6 |
| Full | Zopfli | 505.3 | 185.3 | 160.7 |
| Full | Brotli JS | 588.4 | 235.9 | 209.8 |
| Full | Zstandard | 506.9 | 184.5 | 159.7 |
| Slim | Current DEFLATE | 193.9 | 78.6 | 70.0 |
| Slim | Zopfli | 190.7 | 76.2 | 67.5 |
| Slim | Brotli JS | 272.8 | 131.9 | 121.1 |
| Slim | Zstandard | 194.4 | 77.9 | 69.2 |

| Edition | Encoding | Six-block decode median / p95 ms | Cold import median ms |
|---|---|---:|---:|
| Full | Current encoding | Not measured separately | 136.7 |
| Full | DEFLATE | 9.3 / 11.8 | 139.4 |
| Full | Zopfli | 8.3 / 10.0 | 155.1 |
| Full | Brotli JS | 9.7 / 13.2 | 243.2 |
| Full | Zstandard | 4.5 / 5.5 | 246.2 |
| Slim | Current DEFLATE | 2.3 / 2.9 | 56.7 |
| Slim | Zopfli | 2.2 / 3.1 | 51.5 |
| Slim | Brotli JS | 3.9 / 5.8 | 86.8 |
| Slim | Zstandard | 1.5 / 1.7 | 60.9 |

Decoder measurements warm up for five rounds and sample 25 rounds, excluding Base64, Paeth reconstruction, network access, and GPU uploads. Cold import and initialization use three separate browser contexts each. Cold import includes local server requests, parsing, and complete resource initialization. These are different performance measurements. Samples describe this machine's headless browser and do not establish a startup ranking across devices. The raw JSON preserves startup minimum, median, and maximum values.

## Acceptance and conclusions

All 72 byte checks passed across eight resource arrays in nine builds: both trail arrays, Circle, Ring3, triangle RGBA/coverage, and mesh float/index bit patterns. All 36 WebGL2 scenes, covering early, late, sustained trails, and compositing references, match their respective baselines byte for byte. The four slim variants also pass initialization failure, context restoration, input, multiple instances, pause, size/DPR, and repeated destruction checks. The existing `test:browser:slim` passes too.

Full artifacts retain every backend, but this experiment exercises WebGL2 pixels only. Other backends have no new browser pixel acceptance here. GPU memory, physical display frame rate, and physical HDR are outside these measurements.

Zopfli is a suitable integration candidate: full raw size falls by about 23% and gzip by about 25%; slim raw size falls by 3312 bytes while retaining the existing synchronous decoder. Zstandard has a slight advantage in full transfer size and decoder speed, but its cold import was slower in this run and needs further measurement before integration. Brotli's smaller data blocks do not offset the tested JS decoder sufficiently, especially in the slim edition.

This Chromium supports `DecompressionStream('deflate-raw')` but rejects `brotli` and `zstd`; asynchronous native decoding is not counted as an accepted candidate. Changing compression also does not shrink decoded texture arrays or GPU texture storage.
