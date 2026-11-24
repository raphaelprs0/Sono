package player

// Reset arrête la lecture et remet le lecteur à zéro sans fermer la sortie audio (réutilisable ensuite).
func (pl *Player) Reset() { pl.p.Reset() }
