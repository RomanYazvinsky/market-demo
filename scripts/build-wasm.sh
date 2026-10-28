#!/bin/sh
# Builds the Go market generator to public/producer.wasm and copies the matching
# wasm_exec.js (Go's JS glue) next to the worker sources. Both outputs are gitignored.
set -e
cd "$(dirname "$0")/../wasm"
GOOS=js GOARCH=wasm go build -o ../public/producer.wasm .
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" ../src/app/producer/wasm_exec.js
