#!/bin/sh
# Builds the Go market generator to public/producer.wasm and copies the matching
# wasm_exec.js (Go's JS glue) next to the worker sources. Both outputs are gitignored.
#
# wasm/prebuilt/ holds a committed copy of both files. With Go installed it is refreshed
# from the fresh build (the build is reproducible: -trimpath, -buildvcs=false, so it only
# changes when the Go sources or the Go version change). Without Go, build/test/serve use it.
set -e
cd "$(dirname "$0")/.."
prebuilt=wasm/prebuilt

if command -v go >/dev/null 2>&1; then
  (cd wasm && GOOS=js GOARCH=wasm go build -trimpath -buildvcs=false -o ../public/producer.wasm .)
  cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" src/app/producer/wasm_exec.js
  mkdir -p "$prebuilt"
  cp public/producer.wasm src/app/producer/wasm_exec.js "$prebuilt/"
  go env GOVERSION > "$prebuilt/GO_VERSION"
else
  echo "build-wasm: Go not found, using the prebuilt module from $prebuilt/ ($(cat "$prebuilt/GO_VERSION"))" >&2
  cp "$prebuilt/producer.wasm" public/producer.wasm
  cp "$prebuilt/wasm_exec.js" src/app/producer/wasm_exec.js
fi
