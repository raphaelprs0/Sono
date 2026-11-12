package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"runtime"
	"strings"
	"sync"

	dz "github.com/Cycl0o0/OpenDeezer/v3/sdk/deezer"
	"github.com/Cycl0o0/OpenDeezer/v3/sdk/player"
)

type config struct {
	ARL   string `json:"arl"`
	Token string `json:"token"`
}
type bridge struct {
	client  *dz.Client
	player  *player.Player
	token   string
	account dz.Account
	mu      sync.RWMutex
	track   *dz.Track
	next    *dz.Track // titre préchargé, enchaîné en fondu à la fin du titre en cours
}
type apiTrack struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	Artist     string `json:"artist"`
	Album      string `json:"album"`
	DurationMS int64  `json:"durationMs"`
	ArtworkURL string `json:"artworkUrl,omitempty"`
}
type searchTrack struct {
	ID       string       `json:"id"`
	Title    string       `json:"title"`
	Artist   searchArtist `json:"artist"`
	Album    searchAlbum  `json:"album"`
	Duration int64        `json:"duration"`
}
type searchArtist struct {
	Name string `json:"name"`
}
type searchAlbum struct {
	Title   string `json:"title"`
	CoverXL string `json:"cover_xl"`
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func (b *bridge) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-OpenDeezer-Token") != b.token {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Authentification du moteur refusée."})
			return
		}
		next(w, r)
	}
}
func toAPITrack(track *dz.Track) apiTrack {
	return apiTrack{ID: track.ID, Title: track.Name, Artist: track.ArtistLine(), Album: track.AlbumName, DurationMS: track.DurationMS, ArtworkURL: track.ArtworkURL}
}
func (b *bridge) status(w http.ResponseWriter, _ *http.Request) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	state := strings.ToLower(b.player.State().String())
	response := map[string]any{"state": state, "positionMs": b.player.PositionMS(), "durationMs": b.player.DurationMS(), "volume": b.player.Volume(), "format": b.player.Format()}
	if b.track != nil {
		response["track"] = toAPITrack(b.track)
	}
	if b.next != nil {
		response["preloaded"] = b.next.ID
	}
	if message := b.player.LastError(); message != "" {
		response["error"] = message
	}
	writeJSON(w, http.StatusOK, response)
}
func (b *bridge) search(w http.ResponseWriter, r *http.Request) {
	results, err := b.client.Search(r.URL.Query().Get("q"))
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	tracks := make([]searchTrack, 0, len(results.Tracks))
	for _, track := range results.Tracks {
		tracks = append(tracks, searchTrack{ID: track.ID, Title: track.Name, Artist: searchArtist{Name: track.ArtistLine()}, Album: searchAlbum{Title: track.AlbumName, CoverXL: track.ArtworkURL}, Duration: track.DurationMS / 1000})
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": tracks})
}

// prepare récupère en même temps les infos du titre et son flux audio (deux appels à Deezer en parallèle).
func (b *bridge) prepare(id string) (dz.Track, *dz.StreamPlan, error) {
	var (
		track    dz.Track
		trackErr error
		wg       sync.WaitGroup
	)
	wg.Add(1)
	go func() { defer wg.Done(); track, trackErr = b.client.Track(id) }()
	plan, err := b.client.PrepareStream(id)
	wg.Wait()
	if trackErr != nil {
		return track, nil, trackErr
	}
	return track, plan, err
}
func (b *bridge) play(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Méthode refusée."})
		return
	}
	id := r.URL.Query().Get("id")
	b.player.PrepareOutput()
	// Titre déjà préchargé : son audio est en mémoire, on passe dessus immédiatement.
	b.mu.RLock()
	preloaded := b.next
	b.mu.RUnlock()
	if preloaded != nil && preloaded.ID == id && b.player.SkipToNext() {
		b.mu.Lock()
		b.track = preloaded
		b.next = nil
		b.mu.Unlock()
		writeJSON(w, http.StatusOK, map[string]any{"playing": true, "instant": true, "format": b.player.Format()})
		return
	}
	track, plan, err := b.prepare(id)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	if err := b.player.Play(plan, track.DurationMS); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	b.mu.Lock()
	b.track = &track
	b.next = nil // Play remplace aussi le titre préchargé
	b.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"playing": true, "format": plan.Format})
}

// preload prépare le titre suivant : le moteur l’enchaîne seul, sans silence, à la fin du titre en cours.
func (b *bridge) preload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Méthode refusée."})
		return
	}
	id := r.URL.Query().Get("id")
	track, plan, err := b.prepare(id)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	b.player.Preload(plan, track.DurationMS)
	b.mu.Lock()
	b.next = &track
	b.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"preloaded": track.ID})
}

// seek place la lecture à une position précise du titre en cours (barre de progression).
func (b *bridge) seek(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Méthode refusée."})
		return
	}
	ms, err := strconv.ParseInt(r.URL.Query().Get("ms"), 10, 64)
	if err != nil || ms < 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Position invalide."})
		return
	}
	b.player.SeekMS(ms)
	b.player.FlushOutput()
	writeJSON(w, http.StatusOK, map[string]any{"positionMs": ms})
}

// eq lit (GET) ou règle (POST {"gains": [10 valeurs en dB], "preampDb": n}) l’égaliseur 10 bandes.
// Il s’active dès qu’une bande n’est pas à zéro.
func (b *bridge) eq(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		var body struct {
			Gains    []float64 `json:"gains"`
			PreampDB float64   `json:"preampDb"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Réglages du son illisibles."})
			return
		}
		if err := b.player.SetEQGains(body.Gains); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		b.player.SetEQPreamp(body.PreampDB)
		active := false
		for _, gain := range body.Gains {
			active = active || gain != 0
		}
		b.player.SetEQEnabled(active)
	}
	writeJSON(w, http.StatusOK, map[string]any{"enabled": b.player.EQEnabled(), "gains": b.player.EQGains(), "preampDb": b.player.EQPreampDB(), "bands": b.player.EQBands()})
}

// setPaused met en pause ou relance sans dépendre de l’état connu : aucune lecture préalable, donc aucun délai.
func (b *bridge) setPaused(paused bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Méthode refusée."})
			return
		}
		if paused {
			b.player.PauseNow()
		} else {
			b.player.ResumeNow()
		}
		writeJSON(w, http.StatusOK, map[string]any{"state": strings.ToLower(b.player.State().String())})
	}
}

func (b *bridge) pause(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Méthode refusée."})
		return
	}
	b.player.TogglePause()
	writeJSON(w, http.StatusOK, map[string]any{"state": strings.ToLower(b.player.State().String())})
}
func fatal(message string) {
	_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"ready": false, "error": message})
	os.Exit(1)
}
func main() {
	var cfg config
	input := bufio.NewReader(os.Stdin)
	if err := json.NewDecoder(input).Decode(&cfg); err != nil {
		fatal("Configuration du moteur illisible.")
	}
	// Sono garde l’entrée standard ouverte tant qu’il tourne : quand elle se ferme (Sono quitté,
	// planté ou arrêté de force), le moteur s’arrête aussi et la musique avec.
	go func() {
		_, _ = io.Copy(io.Discard, input)
		os.Exit(0)
	}()
	if len(strings.TrimSpace(cfg.ARL)) < 20 || cfg.Token == "" {
		fatal("ARL ou protection du moteur manquant.")
	}
	client := dz.New(strings.TrimSpace(cfg.ARL))
	if err := client.Login(); err != nil {
		if errors.Is(err, dz.ErrARLExpired) {
			fatal("ARL expiré ou invalide. Reconnectez-vous à Deezer.")
		}
		fatal(fmt.Sprintf("Connexion à Deezer impossible : %v", err))
	}
	// Qualité la plus haute permise par l’abonnement : FLAC sans perte (Deezer Premium et HiFi), sinon MP3 320 kb/s ;
	// Deezer redescend seul (320 puis 128 kb/s) si le compte ou le titre ne la permet pas.
	if client.Account().CanHiFi {
		client.SetQuality(dz.QualityLossless)
	} else if client.Account().CanHQ {
		client.SetQuality(dz.QualityHigh)
	}
	audio, err := player.NewPlayer()
	if err != nil {
		fatal(fmt.Sprintf("Aucune sortie audio disponible : %v", err))
	}
	defer audio.Close()
	// Fondu enchaîné : les 3 dernières secondes d’un titre se mélangent au début du suivant (préchargé).
	audio.SetCrossfadeMS(3000)
	// Normalisation du volume (ReplayGain) et un peu de marge : les titres trop forts sont ramenés au niveau commun.
	audio.SetReplayGain(true)
	// Sur Mac, le niveau de Deezer sortait bien plus bas que les autres apps : pas de marge supplémentaire (voir adjustGain).
	if runtime.GOOS == "darwin" {
		audio.SetVolume(1)
	} else {
		audio.SetVolume(0.85)
	}
	bridge := &bridge{client: client, player: audio, token: cfg.Token, account: client.Account()}
	// Fin de titre : si un titre était préchargé, le moteur vient de passer dessus sans blanc.
	audio.SetOnFinish(func() {
		bridge.mu.Lock()
		if bridge.next != nil {
			bridge.track = bridge.next
			bridge.next = nil
		}
		bridge.mu.Unlock()
	})
	mux := http.NewServeMux()
	mux.HandleFunc("/whoami", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"name": bridge.account.Name, "offer": bridge.account.Offer, "auth": "token", "client": "sono-opendeezer-bridge"})
	})
	mux.HandleFunc("/status", bridge.auth(bridge.status))
	mux.HandleFunc("/search", bridge.auth(bridge.search))
	mux.HandleFunc("/play/track", bridge.auth(bridge.play))
	mux.HandleFunc("/preload/track", bridge.auth(bridge.preload))
	mux.HandleFunc("/playpause", bridge.auth(bridge.pause))
	mux.HandleFunc("/pause", bridge.auth(bridge.setPaused(true)))
	mux.HandleFunc("/resume", bridge.auth(bridge.setPaused(false)))
	mux.HandleFunc("/seek", bridge.auth(bridge.seek))
	mux.HandleFunc("/eq", bridge.auth(bridge.eq))
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		fatal(err.Error())
	}
	port := listener.Addr().(*net.TCPAddr).Port
	_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"ready": true, "port": port, "account": bridge.account})
	if err := http.Serve(listener, mux); err != nil {
		fatal(err.Error())
	}
}
