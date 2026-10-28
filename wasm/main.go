//go:build js && wasm

// Command producer is the JS bridge of the market generator. It registers
// `globalThis.producer` = {init, nextBatch}, the WasmProducer contract in
// src/app/producer/wasm-api.ts. syscall/js is used only in this file; all randomness
// and price logic lives in package generator.
//
// # Data layout
//
// One update is 7 int32 values (generator.FieldsPerUpdate), 28 bytes (generator.BytesPerUpdate):
//
//	[instrumentIndex, priceCents, tradeQuantity, bidCents, askCents, bidQuantity, askQuantity]
//
// A batch of k updates occupies the first k * 7 elements of the run's Int32Array.
//
// # Memory model: how a batch gets from Go into the worker
//
//  1. The worker allocates ONE Int32Array per run (length updatesPerBatch * 7) and hands
//     it to init.
//  2. Go keeps a reference to it for the whole run. Go's own memory (the Wasm linear memory)
//     and JS memory (the Int32Array's ArrayBuffer) are separate, so Go cannot write into the
//     Int32Array directly. The only bulk copy primitive syscall/js offers is
//     js.CopyBytesToJS(dst js.Value, src []byte), and it accepts only a Uint8Array (or
//     Uint8ClampedArray) destination. Therefore init creates
//     new Uint8Array(dst.buffer, dst.byteOffset, updatesPerBatch * 28): a second *view* over
//     the same memory as the first updatesPerBatch * 7 elements of dst. It allocates no new
//     memory and copies nothing. Because it starts at dst.byteOffset and spans exactly one
//     batch, a subarray dst works and the copy never writes past the batch. The view is
//     created once per init, not per batch, because dst and the batch size are fixed for the
//     run; that keeps nextBatch free of JS allocations. JS only ever sees the Int32Array.
//  3. nextBatch generates the updates into ups (a reused Go []MarketUpdate), encodes them
//     into buf (a reused Go []byte) as little-endian int32, and performs exactly one
//     CopyBytesToJS(out, buf). After it returns, the worker reads the values through its
//     Int32Array. Per batch: one bulk copy (max 1000 * 28 bytes = 28 KB), zero allocations
//     on either side.
//  4. Byte order: Encode writes little-endian, the byte order Wasm itself uses. The
//     Int32Array reads those bytes in the platform's byte order. Every supported browser
//     platform is little-endian; the worker checks this at load time (loadWasmProducer
//     rejects on a big-endian platform) instead of assuming it.
//
// Rejected alternatives: writing element by element via dst.SetIndex (7,000 JS calls per
// batch); reading Go's linear memory from JS by pointer (depends on wasm_exec.js internals,
// and that view detaches whenever Go's memory grows).
package main

import (
	"fmt"
	"syscall/js"

	"findev-test/wasm/generator"
)

// Run state. It is replaced only by a fully successful init, so a rejected init leaves the
// previous run (generator and bound buffer) untouched.
var (
	// gen is the current run's generator; nil until the first successful init.
	gen *generator.Generator
	// ups holds one batch of generated updates (len updatesPerBatch), reused every batch.
	ups []generator.MarketUpdate
	// buf holds ups encoded as little-endian int32 (len updatesPerBatch * 28), reused every
	// batch; it is the source of the single CopyBytesToJS per batch.
	buf []byte
	// out is the Uint8Array byte view over the bound Int32Array's batch bytes
	// (dst.buffer, from dst.byteOffset, updatesPerBatch * 28 bytes); the copy destination.
	out js.Value
)

func main() {
	js.Global().Set("producer", js.ValueOf(map[string]any{
		"init":      js.FuncOf(initRun),
		"nextBatch": js.FuncOf(nextBatch),
	}))
	select {}
}

// initRun implements producer.init(seed, instrumentCount, updatesPerBatch, dst).
// It returns null on success, otherwise a readable error string.
func initRun(_ js.Value, args []js.Value) (result any) {
	// Bad arguments (wrong types, missing args) make syscall/js panic; turn that into an
	// error string instead of killing the Go runtime.
	defer func() {
		if r := recover(); r != nil {
			result = fmt.Sprint("producer.init: invalid arguments: ", r)
		}
	}()
	if len(args) != 4 {
		return fmt.Sprintf("producer.init expects 4 arguments, got %d", len(args))
	}
	seed, count, batch, dst := args[0].Int(), args[1].Int(), args[2].Int(), args[3]

	if err := generator.ValidateBatchSize(batch); err != nil {
		return err.Error()
	}
	minLen := batch * generator.FieldsPerUpdate
	if !dst.InstanceOf(js.Global().Get("Int32Array")) || dst.Get("length").Int() < minLen {
		return fmt.Sprintf("dst must be an Int32Array of at least %d elements", minLen)
	}
	g, err := generator.New(uint64(seed), count, generator.DefaultModelConfig())
	if err != nil {
		return err.Error()
	}

	gen = g
	ups = make([]generator.MarketUpdate, batch)
	buf = make([]byte, batch*generator.BytesPerUpdate)
	out = js.Global().Get("Uint8Array").New(dst.Get("buffer"), dst.Get("byteOffset"), len(buf))
	return nil
}

// nextBatch implements producer.nextBatch(): one batch into the bound Int32Array.
func nextBatch(_ js.Value, _ []js.Value) any {
	if gen == nil {
		return nil
	}
	gen.NextBatch(ups)
	generator.Encode(buf, ups)
	js.CopyBytesToJS(out, buf)
	return nil
}
