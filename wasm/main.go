//go:build js && wasm

package main

import "syscall/js"

func main() {
	js.Global().Set("producer", js.ValueOf(map[string]any{
		"init": js.FuncOf(func(this js.Value, args []js.Value) any {
			return "not implemented"
		}),
		"nextBatch": js.FuncOf(func(this js.Value, args []js.Value) any {
			return nil
		}),
	}))
	select {}
}
