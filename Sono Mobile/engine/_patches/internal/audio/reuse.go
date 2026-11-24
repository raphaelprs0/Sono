package audio

// Reset arrête la lecture et remet le lecteur dans l’état d’un lecteur neuf (position, durée,
// format, erreur, rappel de fin), sans fermer la sortie audio : sur iPhone, oto ne permet de la
// créer qu’une fois par processus, donc le même lecteur sert d’une connexion Deezer à l’autre.
func (p *Player) Reset() {
	p.Stop()
	p.SetOnFinish(nil)
	p.played.Store(0)
	p.totalMS.Store(0)
	p.format.Store("")
	p.lastErr.Store("")
}
