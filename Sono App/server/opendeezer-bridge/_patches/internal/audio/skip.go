package audio

import (
	"math"
	"sync"
	"time"
)

// SkipToNext passe tout de suite au titre préchargé, dont l’audio est déjà téléchargé et décodé :
// pas de nouvel appel à Deezer, le changement de titre est immédiat. Renvoie false s’il n’y a
// pas de titre préchargé utilisable (l’appelant lance alors le titre normalement).
func (p *Player) SkipToNext() bool {
	next := p.next.Load()
	if next == nil || next.lastErr() != "" {
		return false
	}
	p.fadeOutAndWait() // coupe le titre en cours sans clic
	if !p.next.CompareAndSwap(next, nil) {
		p.endFadeOut()
		return false
	}
	if old := p.cur.Swap(next); old != nil {
		old.kill()
	}
	// Un fondu enchaîné a pu déjà jouer le début du titre : on reprend à cet endroit.
	p.played.Store(next.xfadeConsumed.Load())
	p.totalMS.Store(next.durMS)
	p.format.Store(next.format)
	if p.rgOn.Load() && next.plan != nil {
		p.gainFac.Store(math.Float64bits(dbToFactor(next.plan.GainDB)))
	} else {
		p.gainFac.Store(math.Float64bits(1))
	}
	p.lastErr.Store("")
	p.endFadeOut()
	p.fadeLeft.Store(fadeInFrames)
	// Le gestionnaire passe en lecture dès que la mémoire tampon est prête (déjà le cas en général).
	p.state.Store(int32(Loading))
	return true
}

// Pause et reprise instantanées : la sortie audio s’arrête net et repart exactement au même endroit.
// Après une courte pause, la sortie reprend en silence, pour que l’app reste active écran verrouillé.
var instant struct {
	sync.Mutex
	suspended bool
	rewind    bool // l’audio en attente a été jeté : à la reprise, on revient au dernier instant entendu
	timer     *time.Timer
}

const instantHold = 2 * time.Second

func (p *Player) flushOutput() {
	if out, ok := p.out.(interface{ flush() }); ok {
		out.flush()
	}
}

func (p *Player) PauseNow() {
	if _, ok := p.out.(interface{ flush() }); !ok {
		p.Pause()
		return
	}
	if state := p.State(); state != Playing && state != Loading {
		return
	}
	p.state.Store(int32(Paused))
	instant.Lock()
	defer instant.Unlock()
	if instant.suspended {
		return
	}
	instant.suspended = true
	_ = p.out.suspend(true)
	instant.timer = time.AfterFunc(instantHold, func() {
		instant.Lock()
		defer instant.Unlock()
		if !instant.suspended || p.State() != Paused {
			return
		}
		instant.suspended = false
		instant.rewind = true
		p.flushOutput()
		_ = p.out.suspend(false)
	})
}

func (p *Player) ResumeNow() {
	instant.Lock()
	wasSuspended := instant.suspended
	rewind := instant.rewind
	instant.suspended = false
	instant.rewind = false
	if instant.timer != nil {
		instant.timer.Stop()
	}
	instant.Unlock()
	if rewind && p.State() == Paused {
		p.SeekMS((p.played.Load() - bytesPerSec*640/1000) * 1000 / bytesPerSec)
	}
	p.Resume()
	if wasSuspended {
		_ = p.out.suspend(false)
	}
}

// PrepareOutput coupe ce qui reste du titre précédent avant d’en lancer un autre.
func (p *Player) PrepareOutput() {
	instant.Lock()
	defer instant.Unlock()
	wasSuspended := instant.suspended
	instant.suspended = false
	instant.rewind = false
	if instant.timer != nil {
		instant.timer.Stop()
	}
	p.flushOutput()
	if wasSuspended {
		_ = p.out.suspend(false)
	}
}

// FlushOutput jette l’audio en attente sans changer l’état (déplacement dans le titre).
func (p *Player) FlushOutput() {
	instant.Lock()
	defer instant.Unlock()
	p.flushOutput()
}
