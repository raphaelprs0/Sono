package deezer

// PrepareStreamWithTrack renvoie les infos du titre et son flux audio avec un seul appel à Deezer
// (au lieu de Track puis PrepareStream) — correctif Sono.
func (cl *Client) PrepareStreamWithTrack(trackID string) (Track, *StreamPlan, error) {
	return cl.c.PrepareStreamWithTrack(trackID)
}

// SearchTracks ne cherche que les titres (une requête au lieu des quatre de Search) — correctif Sono.
func (cl *Client) SearchTracks(query string) ([]Track, error) {
	return cl.c.SearchTracksOnly(query)
}
