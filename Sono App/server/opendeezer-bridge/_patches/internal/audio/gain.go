package audio

import "runtime"

// adjustGain : Deezer baisse souvent ses titres de 8 à 12 dB, ce qui sonne très bas sur Mac par rapport aux autres apps.
// On garde l’égalisation entre titres, 6 dB plus haut, sans jamais dépasser le niveau d’origine (donc sans saturation).
func adjustGain(db float64) float64 {
	if runtime.GOOS != "darwin" {
		return db
	}
	if db += 6; db > 0 {
		return 0
	}
	return db
}
