# findev-test — Realtime Fintech Dashboard

An [AnalogJS](https://analogjs.org) (Angular 22) app that shows a live market dashboard. A Go WebAssembly library simulates an order-driven market inside a Web Worker. The worker computes the metrics and the UI renders them once per second.

Functionality:

- **Dashboard (`/`):** one row per instrument (real S&P 500 tickers) with last price, bid–ask spread, volume, VWAP and order-book imbalance. Columns can be sorted, and rows can be searched by name.
- **Run control:** a status bar with the producer status, the run time and a Start / Pause / Resume button.
- **Settings (`/settings`):** a validated form for instrument count, updates per batch and batch interval. Apply starts a new run with cleared totals.
- **Instrument page (`/instrument/:symbol`, off by default):** price and spread charts and the last 100 updates of one ticker, used to debug and tune the generator.

## Documentation

Read in this order:

1. [TASK.md](TASK.md): the task statement.
2. [docs/requirements.md](docs/requirements.md): the task split into numbered requirements for the Wasm, worker and UI modules, each linked to its tests.
3. [docs/implementation.md](docs/implementation.md): architecture, the market update generator with an example, the Go GC issue, performance, error handling and the instrument page.

## Prerequisites

- Node ≥ 22.22.3 and pnpm.
- Go 1.27.1, optional. It is needed to rebuild the Wasm module and to run `pnpm test:go`. Without Go, the committed prebuilt module is used (see below).

## Run

```sh
pnpm install
pnpm dev          # http://localhost:5173
```

| Command | What it does |
|---|---|
| `pnpm dev` | Prepares the Wasm module, then starts the dev server at http://localhost:5173 |
| `pnpm build` | Prepares the Wasm module, then builds the app. The prerendered static output is in `dist/analog/public` |
| `pnpm test -- --run` | Prepares the Wasm module, then runs all Vitest specs once (`pnpm test` watches) |
| `pnpm test:go` | Go unit tests of the market model (`wasm/generator`) |
| `pnpm typecheck` | TypeScript check of the app and the specs |
| `pnpm build:wasm` | Only prepares the Wasm module and its JS glue |

### Wasm module and glue

`dev`, `build` and `test` run `pnpm build:wasm` (`scripts/build-wasm.sh`) first. It produces two files, both gitignored:

- `public/producer.wasm`: the compiled Go generator, served as a static file and fetched by the worker.
- `src/app/producer/wasm_exec.js`: Go's JS glue (the `Go` class that runs the module), bundled into the worker. It must come from the same Go version as the module.

With Go installed, the script builds the module (`GOOS=js GOARCH=wasm`, reproducible with `-trimpath -buildvcs=false`), copies `wasm_exec.js` from the Go installation, and refreshes the committed copy in `wasm/prebuilt/` (both files plus `GO_VERSION`).

Without Go, it copies both files from `wasm/prebuilt/`. So the app builds and runs on a machine without Go. Because the build is reproducible, `wasm/prebuilt/` changes only with the Go sources or the Go version; commit it together with Go changes.

## Deployment (GitHub Pages)

`.github/workflows/pages.yml` deploys every push to `master` to https://romanyazvinsky.github.io/market-demo/ (one-time setup: repo Settings → Pages → Source: GitHub Actions). It runs the Go and Vitest suites, checks that `wasm/prebuilt/` matches the Go sources, and builds with `BASE_PATH=/<repo>/`:

- `BASE_PATH` becomes Vite's `base` (asset, Wasm and instrument-list URLs) and, through `environment.baseUrl`, Angular's `APP_BASE_HREF` (router links), as Analog documents for a URL prefix.
- `index.html` is copied to `404.html`, so a deep link to a page that is not prerendered still loads the app.

A local preview under the prefix: `BASE_PATH=/market-demo/ pnpm build`, then serve a folder that contains `dist/analog/public` as `market-demo/`.

## Blocked dependency builds

Because of recent supply-chain attacks through published npm packages, this project uses pnpm and runs no install/postinstall scripts of dependencies. The packages that ship such scripts have them explicitly disabled with `allowBuilds: false` in `pnpm-workspace.yaml`:

- `@parcel/watcher`
- `esbuild`
- `lmdb`
- `msgpackr-extract`

The packages are still installed; pnpm just does not run their build scripts, and the app builds and tests without them. Use pnpm for installation so this policy is applied.

If a dependency ever needs its build script, review the script first, set that package's `allowBuilds` entry to `true`, and run `pnpm rebuild <package>` (for example `pnpm rebuild esbuild`).
