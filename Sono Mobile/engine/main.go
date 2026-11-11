package main

// #include <stdlib.h>
import "C"

import (
	"unsafe"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"runtime/debug"
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
// Moteur Deezer de Sono Mobile : même API HTTP locale que sur ordinateur, mais lancé dans l’app (iOS interdit les programmes séparés).
var engine struct {
	sync.Mutex
	started bool
	reply   string
	stop    func()
}

func start(arl, token string) (map[string]any, error) {
	if len(strings.TrimSpace(arl)) < 20 || token == "" {
		return nil, errors.New("ARL ou protection du moteur manquant.")
	}
	client := dz.New(strings.TrimSpace(arl))
	if err := client.Login(); err != nil {
		if errors.Is(err, dz.ErrARLExpired) {
			return nil, errors.New("ARL expiré ou invalide. Reconnectez-vous à Deezer.")
		}
		return nil, fmt.Errorf("Connexion à Deezer impossible : %v", err)
	}
	if client.Account().CanHQ {
		client.SetQuality(dz.QualityHigh)
	}
	audio, err := player.NewPlayer()
	if err != nil {
		return nil, fmt.Errorf("Aucune sortie audio disponible : %v", err)
	}
	audio.SetCrossfadeMS(3000)
	// Moins de mémoire au repos, et une limite pour que le système ne ferme pas l’app écran verrouillé.
	debug.SetGCPercent(60)
	debug.SetMemoryLimit(250 << 20)
	audio.SetReplayGain(true)
	audio.SetVolume(0.85)
	bridge := &bridge{client: client, player: audio, token: token, account: client.Account()}
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
		writeJSON(w, http.StatusOK, map[string]any{"name": bridge.account.Name, "offer": bridge.account.Offer})
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
		return nil, err
	}
	go http.Serve(listener, mux)
	engine.stop = func() {
		listener.Close()
		audio.Close()
	}
	return map[string]any{"ready": true, "port": listener.Addr().(*net.TCPAddr).Port, "account": bridge.account}, nil
}

// SonoEngineStart démarre le moteur et renvoie un JSON { ready, port, account } ou { error }. À libérer avec free().
//
//export SonoEngineStart
func SonoEngineStart(arl, token *C.char) *C.char {
	engine.Lock()
	defer engine.Unlock()
	if engine.started {
		return C.CString(engine.reply)
	}
	result, err := start(C.GoString(arl), C.GoString(token))
	if err != nil {
		result = map[string]any{"error": err.Error()}
	}
	data, _ := json.Marshal(result)
	if err == nil {
		engine.started, engine.reply = true, string(data)
	}
	return C.CString(string(data))
}

// SonoEngineStop arrête le moteur (déconnexion du compte Deezer).
//
//export SonoEngineStop
func SonoEngineStop() {
	engine.Lock()
	defer engine.Unlock()
	if engine.stop != nil {
		engine.stop()
	}
	engine.started, engine.reply, engine.stop = false, "", nil
}

// SonoFree libère une réponse du moteur.
//
//export SonoFree
func SonoFree(p *C.char) { C.free(unsafe.Pointer(p)) }

func main() {}
