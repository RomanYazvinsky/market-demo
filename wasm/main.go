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
// A batch of updatesPerBatch updates occupies the first updatesPerBatch * 7 elements of the run's Int32Array.
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
//  3. nextBatch generates the updates into updates (a reused Go []MarketUpdate), encodes them
//     into encoded (a reused Go []byte) as little-endian int32, and performs exactly one
//     CopyBytesToJS(batchView, encoded). After it returns, the worker reads the values through its
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
	// runGenerator is the current run's generator; nil until the first successful init.
	runGenerator *generator.Generator
	// updates holds one batch of generated updates (len updatesPerBatch), reused every batch.
	updates []generator.MarketUpdate
	// encoded holds updates encoded as little-endian int32 (len updatesPerBatch * 28), reused
	// every batch; it is the source of the single CopyBytesToJS per batch.
	encoded []byte
	// batchView is the Uint8Array byte view over the bound Int32Array's batch bytes
	// (dst.buffer, from dst.byteOffset, updatesPerBatch * 28 bytes); the copy destination.
	batchView js.Value
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
		if recovered := recover(); recovered != nil {
			result = fmt.Sprint("producer.init: invalid arguments: ", recovered)
		}
	}()
	parsed, err := parseInitArgs(args)
	if err != nil {
		return err.Error()
	}
	created, err := generator.New(parsed.seed, parsed.instrumentCount, generator.DefaultModelConfig())
	if err != nil {
		return err.Error()
	}

	runGenerator = created
	updates = make([]generator.MarketUpdate, parsed.updatesPerBatch)
	encoded = make([]byte, parsed.updatesPerBatch*generator.BytesPerUpdate)
	batchView = js.Global().Get("Uint8Array").New(parsed.dst.Get("buffer"), parsed.dst.Get("byteOffset"), len(encoded))
	return nil
}

// initArgs are the arguments of producer.init after validation.
type initArgs struct {
	seed            uint64
	instrumentCount int
	updatesPerBatch int
	dst             js.Value
}

// parseInitArgs checks the argument count, the batch size and the output buffer. The instrument
// count is checked by generator.New. Arguments of the wrong JS type make syscall/js panic,
// which initRun recovers.
func parseInitArgs(args []js.Value) (initArgs, error) {
	if len(args) != 4 {
		return initArgs{}, fmt.Errorf("producer.init expects 4 arguments, got %d", len(args))
	}
	parsed := initArgs{
		seed:            uint64(args[0].Int()),
		instrumentCount: args[1].Int(),
		updatesPerBatch: args[2].Int(),
		dst:             args[3],
	}
	if err := generator.ValidateBatchSize(parsed.updatesPerBatch); err != nil {
		return initArgs{}, err
	}
	minLength := parsed.updatesPerBatch * generator.FieldsPerUpdate
	if !parsed.dst.InstanceOf(js.Global().Get("Int32Array")) || parsed.dst.Get("length").Int() < minLength {
		return initArgs{}, fmt.Errorf("dst must be an Int32Array of at least %d elements", minLength)
	}
	return parsed, nil
}

// nextBatch implements producer.nextBatch(): one batch into the bound Int32Array.
func nextBatch(_ js.Value, _ []js.Value) any {
	if runGenerator == nil {
		return nil
	}
	runGenerator.NextBatch(updates)
	generator.Encode(encoded, updates)
	js.CopyBytesToJS(batchView, encoded)
	return nil
}
