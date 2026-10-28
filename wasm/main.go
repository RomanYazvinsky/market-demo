package main

import "syscall/js"

func main() {
	js.Global().Set("goAdd", js.FuncOf(func(this js.Value, args []js.Value) any {
		return args[0].Int() + args[1].Int()
	}))
	select {}
}

func ApplySettings()
