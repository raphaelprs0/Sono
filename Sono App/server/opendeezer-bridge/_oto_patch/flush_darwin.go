package oto

import "github.com/ebitengine/purego"

// Ajout Sono : vide la file d’attente d’AudioQueue pour qu’un changement s’entende tout de suite.
var _AudioQueueReset func(inAQ _AudioQueueRef) uintptr

// Flush demande de jeter l’audio déjà envoyé au système. La file continue ensuite de tourner.
func (c *Context) Flush() {
	if _AudioQueueReset == nil {
		toolbox, err := purego.Dlopen("/System/Library/Frameworks/AudioToolbox.framework/AudioToolbox", purego.RTLD_LAZY|purego.RTLD_GLOBAL)
		if err != nil {
			return
		}
		purego.RegisterLibFunc(&_AudioQueueReset, toolbox, "AudioQueueReset")
	}
	c.context.cond.L.Lock()
	defer c.context.cond.L.Unlock()
	c.context.toFlush = true
	c.context.cond.Signal()
}
