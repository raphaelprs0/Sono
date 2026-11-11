package player

// SkipToNext passe immédiatement au titre préchargé avec Preload. Renvoie false s’il n’y en a pas.
func (pl *Player) SkipToNext() bool { return pl.p.SkipToNext() }

// PauseNow, ResumeNow, PrepareOutput et FlushOutput : commandes qui s’entendent tout de suite.
func (pl *Player) PauseNow()      { pl.p.PauseNow() }
func (pl *Player) ResumeNow()     { pl.p.ResumeNow() }
func (pl *Player) PrepareOutput() { pl.p.PrepareOutput() }
func (pl *Player) FlushOutput()   { pl.p.FlushOutput() }
