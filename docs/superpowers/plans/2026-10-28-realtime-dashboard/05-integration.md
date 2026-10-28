# Part 05 — Integration, docs, deploy (sequential)

Read `00-overview.md`. Runs on `feat/realtime-dashboard` after modules 02–04 report green.

---

### Task 5.1: Merge modules

- [ ] **Step 1:** `git merge --no-ff feat/wasm`, then `feat/worker`, then `feat/ui`. Ownership rules mean no conflicts; a conflict signals an ownership breach — resolve it and note it in `progress.md`.
- [ ] **Step 2: Run** `pnpm test:go`, `pnpm test -- --run`, `pnpm typecheck`, `pnpm build` — all exit 0.
- [ ] **Step 3:** Remove module worktrees (`git worktree remove …`), keep branches until 5.4 is done.
- [ ] **Step 4:** Tick 02, 03, 04 in `progress.md`. **Commit** — `git commit -am "chore: integrate wasm, worker and ui modules"`.

### Task 5.2: End-to-end check in the browser

- [ ] **Step 1:** `pnpm build` and inspect `dist/analog/public/index.html` and `settings/index.html`: toolbar links, headings and form labels present; dashboard shows the skeleton, not the table; no worker/wasm code in the main chunk (worker is its own chunk).
- [ ] **Step 1b:** `pnpm dev`, open `http://localhost:5173/` and confirm:
  - Toolbar is visible immediately; skeleton gives way to the table once the producer starts (throttle network in DevTools to see it).
  - 5 rows show `—` and `0`, status goes initializing → running, values update about once per second.
  - Prices drift gradually; spread ≥ $0.01; imbalance within −1…+1; volume only grows.
  - Pause freezes values, status paused; Resume continues from the same totals.
  - Settings: change instrument count to 10 — Dashboard unchanged until Apply; after Apply, 10 fresh rows and status running (also when applied from paused).
  - Navigate back and forth: still one worker (DevTools › Sources › Threads), run and paused state preserved.
  - 1000 updates / 50 ms: UI stays responsive.
  - Rename `public/producer.wasm` temporarily and reload: status shows the HTTP 404 error. Restore.
- [ ] **Step 2:** Any defect: write a failing spec in the owning module's files first, then fix (superpowers:systematic-debugging). **Commit** each fix.
- [ ] **Step 3:** Tick "05 Integration".

### Task 5.3: README and progress.md

- [ ] **Step 1:** README — replace the Analog boilerplate (keep "Blocked dependency builds"):
  - Prerequisites: Node ≥ 22.22.3, pnpm, Go 1.27.1.
  - Commands: `pnpm install`, `pnpm dev` (http://localhost:5173), `pnpm build` (output `dist/analog/public`), `pnpm test` (builds wasm, runs Vitest), `pnpm test:go`, `pnpm typecheck`.
  - Architecture: data-flow diagram; module boundaries (`WasmProducer`, `ToWorker`/`FromWorker`); where each metric is computed; **Wasm → worker memory model** (one Int32Array per run bound in `init`, Go-side byte view and why `CopyBytesToJS` needs it, one copy per batch, little-endian check), linked to the doc comments in `wasm-api.ts` and `wasm/main.go`; BigInt totals; `runId`; single service-owned worker; `environment` module (refresh rate, wasm URL); S&P 500 symbols sent in `ProducerConfig`.
  - Project layout (short file map).
- [ ] **Step 2:** progress.md — keep the author's analysis; tick "05 Docs"; add "Decisions" (one line each): Go standard toolchain, Int32Array transport, per-run reusable buffers, totals in worker, BigInt sums, 1 s refresh constant, runId, Angular Material, contract-first modules built in parallel.
- [ ] **Step 3: Verify** from a fresh clone in the scratchpad, following only the README: `pnpm install && pnpm test -- --run && pnpm test:go && pnpm build` — all exit 0.
- [ ] **Step 4: Commit** — `git commit -am "docs: readme and progress"`.

### Task 5.4: GitHub Pages auto-deploy

**Blocked on the author:** GitHub owner/repo name (base path `/<repo>/`) and who creates the repo and pushes.

**Files:** `.github/workflows/deploy.yml`, `vite.config.ts`, `README.md`

- [ ] **Step 1:** `vite.config.ts`: `base: process.env['BASE_PATH'] ?? '/'`. The `?worker` chunk URL and `environment.wasmUrl` both follow it; router `APP_BASE_HREF` comes from `<base href>` that Vite rewrites.
- [ ] **Step 2:** Workflow on `push` to the default branch + `workflow_dispatch`; permissions `pages: write`, `id-token: write`, `contents: read`; concurrency group `pages`. Steps: `actions/checkout`, `actions/setup-go` (`go-version-file: wasm/go.mod`), `pnpm/action-setup`, `actions/setup-node` (22, pnpm cache), `pnpm install --frozen-lockfile`, `pnpm test:go`, `pnpm test -- --run`, `BASE_PATH=/<repo>/ pnpm build` (prerender also emits `/404.html` with `nitro.routeRules['/404.html'] = { ssr: false }` as the SPA fallback, per Analog SSG docs — add both to `vite.config.ts` in this task), `actions/upload-pages-artifact` (`dist/analog/public`), `actions/deploy-pages`.
- [ ] **Step 3: Verify locally:** `BASE_PATH=/<repo>/ pnpm build`; serve `dist/analog/public` under `/<repo>/` — dashboard loads, worker and wasm return 200, `/<repo>/settings` deep link works.
- [ ] **Step 4:** Push with `git push -u origin HEAD`; set Pages source to "GitHub Actions"; confirm the run is green and the live URL updates. Add repo and demo links to README.
- [ ] **Step 5:** Tick "05 Deploy". **Commit** — `git commit -am "ci: deploy to github pages"`.
