// Parties réservées à l’hôte (connexions, apparence, paramètres, activité, mode TV, QR codes) :
// chargées seulement quand l’hôte ouvre son tableau de bord, jamais sur la page des invités.
import { Activity, Check, ChevronRight, CircleAlert, Copy, Disc3, Languages, Link2, ListMusic, LoaderCircle, Music2, Palette, Pause, Play, QrCode, Search, Settings, ShieldCheck, SkipBack, SkipForward, Trash2, Tv, UsersRound, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { tx, txServer, locale, lang, setLang } from './i18n.js';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import appleMusicLogo from './assets/apple-music.webp';
import { createPortal } from 'react-dom';
import deezerLogo from './assets/deezer-logo.webp';
import { ACCENTS, ActivityIcon, ApprovalSwitch, Avatar, BACKGROUNDS, DEFAULT_APPEARANCE, Equalizer, FALLBACK_TYPES, FadeCover, IconButton, Modal, ParticipantList, ProviderLogo, SwapText, TV_ZOOM, Toast, activityTime, apiRequest, coverAt, getAppleMusic, readStorage, reducedMotion, trackKey, useImageMeasure, writeStorage } from './App.jsx';

const TV_WIDGETS = [
  { id: 'cover', label: tx("Pochette"), description: tx("La pochette du titre en cours.") },
  { id: 'info', label: tx("Titre et artiste"), description: tx("Avec « Proposé par » si quelqu’un l’a ajouté.") },
  { id: 'player', label: tx("Lecture"), description: tx("Barre de progression avec précédent, pause et suivant (les boutons apparaissent quand la souris bouge).") },
  { id: 'next', label: tx("Titre suivant"), description: tx("La ligne « Ensuite ».") },
  { id: 'qr', label: tx("Code QR"), description: tx("Pour que les invités ajoutent leurs titres.") },
];

// Grille du mode TV : rangées et colonnes ; seules celles qui contiennent un élément prennent de la place.
const TV_ROWS = ['middle', 'bottom'];

const TV_COLS = ['left', 'center', 'right'];

const tvZoneName = (row, col) => (row === 'middle' ? col : col === 'center' ? row : `${row}-${col}`);

const TV_ZONES = [
  ['left', tx("À gauche")], ['center', tx("Au centre")], ['right', tx("À droite")],
  ['bottom-left', tx("En bas à gauche")], ['bottom', tx("En bas")], ['bottom-right', tx("En bas à droite")],
];

const WIDGETS = [
  { id: 'progress', area: 'Centre', label: tx("Barre de progression"), description: tx("Sous la lecture en cours, pour avancer ou reculer dans le titre.") },
  { id: 'invite', area: 'Droite', label: tx("Code QR d’invitation"), description: tx("QR code, code de session et choix Wi-Fi / Internet.") },
  { id: 'participants', area: 'Droite', label: tx("Dans la session"), description: tx("Les personnes présentes, avec le bouton pour retirer.") },
  { id: 'stats', area: 'Droite', label: tx("Statistiques"), description: tx("Invités connectés et durée proposée en attente.") },
  { id: 'activity', area: 'Droite', label: tx("Activité récente"), description: tx("Les dernières actions de la session.") },
];

async function getAppleStorefront(music) {
  const response = await music.api.music('/v1/me/storefront');
  const storefront = response.data?.data ? response.data : response;
  const storefrontId = storefront.data?.[0]?.id;
  if (!storefrontId) throw new Error(tx("Apple Music n’a pas confirmé la boutique du compte."));
  return storefrontId;
}

function ProviderIcon({ provider }) {
  return <span className="provider-icon"><img src={provider === 'Deezer' ? deezerLogo : appleMusicLogo} width={56} height={56} alt="" aria-hidden="true" /></span>;
}

function ActivityView({ activity, participants, guests, queue, onRemove, onToggleAdmin }) {
  return <section className="subpage">
    <div className="page-heading"><div><div className="eyebrow">SESSION</div><h1>{tx("Activité")}</h1></div></div>
    <div className="activity-stats">
      <div><span className="stat-icon"><UsersRound size={18} /></span><strong>{guests}</strong><span>{guests > 1 ? tx("invités connectés") : tx("invité connecté")}</span></div>
      <div><span className="stat-icon peach"><Music2 size={18} /></span><strong>{queue.length}</strong><span>{tx("titres à venir")}</span></div>
      <div><span className="stat-icon violet"><Activity size={18} /></span><strong>{activity.length}</strong><span>{tx("actions enregistrées")}</span></div>
    </div>
    <div className="activity-columns">
    <div className="activity-feed">
      <h2>{tx("Fil d’activité")}</h2>
      {activity.length ? <ol>{activity.map((item, index) => <li className="activity-item" key={item.at || index}><ActivityIcon icon={item.icon} /><div><strong>{txServer(item.text)}</strong><small>{activityTime(item)}</small></div></li>)}</ol> : <p className="feed-empty">{tx("Aucune activité enregistrée.")}</p>}
    </div>
    <div className="activity-feed people-card"><ParticipantList participants={participants} onRemove={onRemove} onToggleAdmin={onToggleAdmin} /></div>
    </div>
  </section>;
}

function IntegrationsView({ notify, hostToken, sessionCode, source, onSourceChange, onAppleLinked }) {
  const [open, setOpen] = useState(null);
  const [musicKitReady, setMusicKitReady] = useState(false);
  const [deezerMethod, setDeezerMethod] = useState('browser');
  const [deezerArl, setDeezerArl] = useState('');
  const [deezerUrl, setDeezerUrl] = useState(readStorage('sono-deezer-url', 'http://127.0.0.1:7654'));
  const [deezerToken, setDeezerToken] = useState('');
  const [connected, setConnected] = useState({ 'Apple Music': false, Deezer: false });
  const [proofs, setProofs] = useState({});
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(null);

  const showError = useCallback((service, message, withToast = true) => {
    setErrors((state) => ({ ...state, [service]: message }));
    if (withToast) notify(message, 'error');
  }, [notify]);
  const clearError = (service) => setErrors((state) => ({ ...state, [service]: '' }));
  const showAppleAccount = useCallback((storefrontId) => {
    setConnected((state) => ({ ...state, 'Apple Music': true }));
    setProofs((state) => ({ ...state, 'Apple Music': tx("Compte autorisé · boutique {0}", storefrontId) }));
    setMusicKitReady(true);
    clearError('Apple Music');
  }, []);
  const showDeezerProof = useCallback((data) => {
    setConnected((state) => ({ ...state, Deezer: true }));
    setProofs((state) => ({ ...state, Deezer: data.account.name || data.account.account || tx("Compte Deezer") }));
    writeStorage('sono-deezer-connected', 'true');
  }, []);


  useEffect(() => {
    const authenticate = async () => {
      try {
        const music = await getAppleMusic();
        onAppleLinked(music.isAuthorized);
        if (music.isAuthorized) showAppleAccount(await getAppleStorefront(music));
        else {
          setMusicKitReady(false);
          setConnected((state) => ({ ...state, 'Apple Music': false }));
        }
      } catch (error) {
        setMusicKitReady(false);
        setConnected((state) => ({ ...state, 'Apple Music': false }));
        showError('Apple Music', tx("Compte Apple Music indisponible : {0}", error.message), false);
      }
      // Le serveur garde la connexion Deezer : on lui demande directement son état.
      if (hostToken) {
        try {
          const data = await apiRequest(`/api/integrations/opendeezer/status?code=${encodeURIComponent(sessionCode)}`, { headers: { 'x-host-token': hostToken } });
          showDeezerProof(data);
        } catch {
          const wasConnected = readStorage('sono-deezer-connected') === 'true';
          writeStorage('sono-deezer-connected', null);
          setConnected((state) => ({ ...state, Deezer: false }));
          if (wasConnected) showError('Deezer', tx("Deezer est indisponible. Reconnectez votre compte."), false);
        }
      }
    };
    authenticate();
  }, []);

  const connectApplePlayback = async () => {
    clearError('Apple Music');
    setBusy('Apple Music');
    try {
      const music = await getAppleMusic();
      if (!music.isAuthorized) await music.authorize();
      const storefrontId = await getAppleStorefront(music);
      showAppleAccount(storefrontId);
      await onSourceChange('Apple Music', tx("Apple Music est connecté : la musique sera lancée sur Apple Music."));
    } catch {
      setMusicKitReady(false);
      setConnected((state) => ({ ...state, 'Apple Music': false }));
      showError('Apple Music', tx("Apple Music n’a pas pu autoriser le compte. Vérifiez votre abonnement et réessayez."));
    } finally { setBusy(null); }
  };
  const disconnectApple = async () => {
    clearError('Apple Music');
    setBusy('Apple Music');
    try {
      const music = await getAppleMusic();
      await music.unauthorize();
      onAppleLinked(false);
      setMusicKitReady(false);
      setConnected((state) => ({ ...state, 'Apple Music': false }));
      setProofs((state) => ({ ...state, 'Apple Music': '' }));
      if (source === 'Apple Music') await onSourceChange(connected.Deezer ? 'Deezer' : null);
      notify(tx("Apple Music a été déconnecté."));
    } catch (error) { showError('Apple Music', tx("Impossible de déconnecter Apple Music : {0}", error.message)); }
    finally { setBusy(null); }
  };
  const connectDeezer = async (method) => {
    if (method === 'arl' && deezerArl.trim().length < 20) return showError('Deezer', tx("Collez la valeur complète de votre ARL Deezer."));
    clearError('Deezer');
    setBusy('Deezer');
    try {
      const data = await apiRequest('/api/integrations/opendeezer/login', { method: 'POST', headers: { 'x-host-token': hostToken }, body: JSON.stringify({ code: sessionCode, method, arl: method === 'arl' ? deezerArl.trim() : undefined }) });
      showDeezerProof(data);
      setDeezerArl('');
      notify(tx("Deezer est connecté : la musique sera lancée sur Deezer."));
    } catch (error) { writeStorage('sono-deezer-connected', null); showError('Deezer', error.message); }
    finally { setBusy(null); }
  };
  const connectExternalDeezer = async () => {
    clearError('Deezer');
    setBusy('Deezer');
    try {
      const data = await apiRequest('/api/integrations/opendeezer/connect', { method: 'POST', headers: { 'x-host-token': hostToken }, body: JSON.stringify({ code: sessionCode, url: deezerUrl, token: deezerToken }) });
      showDeezerProof(data);
      writeStorage('sono-deezer-url', deezerUrl);
      notify(tx("Deezer est connecté : la musique sera lancée sur Deezer."));
    } catch (error) { writeStorage('sono-deezer-connected', null); showError('Deezer', error.message); }
    finally { setBusy(null); }
  };
  const disconnectDeezer = async () => {
    setBusy('Deezer');
    try {
      await apiRequest('/api/integrations/opendeezer', { method: 'DELETE', headers: { 'x-host-token': hostToken }, body: JSON.stringify({ code: sessionCode }) });
      writeStorage('sono-deezer-connected', null);
      setConnected((state) => ({ ...state, Deezer: false }));
      setProofs((state) => ({ ...state, Deezer: '' }));
      clearError('Deezer');
      if (connected['Apple Music']) await onSourceChange('Apple Music');
      notify(tx("Deezer a été déconnecté."));
    } catch (error) { showError('Deezer', error.message); }
    finally { setBusy(null); }
  };

  const appleBusy = busy === 'Apple Music';
  const deezerBusy = busy === 'Deezer';
  const services = [
    { name: 'Apple Music', description: tx("Connectez votre compte Apple Music pour lancer la lecture depuis Sono."), fields: <>
      <div className="form-actions">
        {musicKitReady || connected['Apple Music']
          ? <button className="button secondary disconnect-button" disabled={appleBusy} onClick={disconnectApple}>{tx("Déconnecter Apple Music")}</button>
          : <button className="button primary" disabled={appleBusy} onClick={connectApplePlayback}>{appleBusy ? <LoaderCircle className="spin" size={16} /> : <Link2 size={17} />}{tx("Se connecter avec Apple Music")}</button>}
      </div>
      {!(musicKitReady || connected['Apple Music']) && <p className="field-help">{tx("Un abonnement Apple Music actif est nécessaire. Apple vous demandera de vous identifier dans une fenêtre sécurisée : Sono ne voit jamais votre mot de passe.")}</p>}
    </> },
    { name: 'Deezer', description: tx("Connectez votre compte Deezer pour lancer la lecture depuis Sono."), fields: <>
      {/* Une fois Deezer connecté, seul le bouton Déconnecter reste. */}
      {!connected.Deezer && <>
      <div className="provider-tabs" aria-label={tx("Méthode de connexion Deezer")}>
        <button className={deezerMethod === 'browser' ? 'active' : ''} aria-pressed={deezerMethod === 'browser'} onClick={() => setDeezerMethod('browser')}>{tx("Compte Deezer")}</button>
        <button className={deezerMethod === 'arl' ? 'active' : ''} aria-pressed={deezerMethod === 'arl'} onClick={() => setDeezerMethod('arl')}>{tx("Mon ARL")}</button>
      </div>
      {deezerMethod === 'browser'
        ? <div className="form-actions"><button className="button primary" disabled={deezerBusy} onClick={() => connectDeezer('browser')}>{deezerBusy ? <LoaderCircle className="spin" size={17} /> : <Link2 size={17} />}{tx("Se connecter avec Deezer")}</button></div>
        : <><label>{tx("Votre ARL Deezer")}<input type="password" value={deezerArl} onChange={(e) => setDeezerArl(e.target.value)} placeholder={tx("Valeur complète du cookie arl")} autoComplete="off" /></label><div className="form-actions"><button className="button primary" disabled={deezerBusy} onClick={() => connectDeezer('arl')}>{deezerBusy ? <LoaderCircle className="spin" size={17} /> : <ShieldCheck size={17} />}{tx("Valider avec Deezer")}</button></div></>}
      {deezerBusy && deezerMethod === 'browser' && <p className="connection-progress" role="status">{tx("Terminez la connexion dans la fenêtre Deezer.")}</p>}
      </>}
      {connected.Deezer && <div className="form-actions"><button className="button secondary disconnect-button" disabled={deezerBusy} onClick={disconnectDeezer}>{tx("Déconnecter Deezer")}</button></div>}
      {!connected.Deezer && <details className="advanced-connection">
        <summary>{tx("Utiliser un moteur Deezer externe (avancé)")}</summary>
        <label>{tx("Adresse de l’API")}<input value={deezerUrl} onChange={(e) => setDeezerUrl(e.target.value)} placeholder="http://127.0.0.1:7654" /></label>
        <label>{tx("Jeton de contrôle")} <span>{tx("facultatif")}</span><input type="password" value={deezerToken} onChange={(e) => setDeezerToken(e.target.value)} placeholder={tx("Votre jeton local")} /></label>
        <div className="form-actions"><button className="button secondary" disabled={deezerBusy} onClick={connectExternalDeezer}><Link2 size={16} />{tx("Tester et connecter")}</button></div>
      </details>}
    </> },
  ];
  return <section className="subpage integrations-page">
    <div className="page-heading"><div><div className="eyebrow">{tx("SOURCES MUSICALES")}</div><h1>{tx("Connexions")}</h1><p>{tx("La musique est lancée uniquement sur l’app choisie ci-dessous. La recherche de vos invités passe aussi par elle.")}</p></div></div>
    <div className="integration-grid">{services.map((service) => {
      const isOpen = open === service.name;
      const isConnected = connected[service.name];
      return <article className={`integration-card ${isOpen ? 'expanded' : ''}`} key={service.name}>
        <div className="integration-card-head">
          <ProviderIcon provider={service.name} />
          <div><h2>{service.name}{isConnected && source === service.name && <span className="role-chip">{tx("App de lecture")}</span>}</h2><span className={isConnected ? 'status-label connected-label' : 'status-label'}><i />{isConnected ? tx("Connecté") : tx("Non connecté")}</span></div>
          <button className="button secondary" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : service.name)}>{isOpen ? tx("Fermer") : isConnected ? tx("Détails") : tx("Configurer")}</button>
        </div>
        <p>{service.description}</p>
        {proofs[service.name] && <div className="verification-proof"><Check size={15} />{proofs[service.name]}</div>}
        {isConnected && source !== service.name && <div className="form-actions"><button className="button secondary" onClick={() => onSourceChange(service.name, tx("La musique sera lancée sur {0}.", service.name))}><ProviderLogo provider={service.name} size={16} />{tx("Lancer la musique avec")} {service.name}</button></div>}
        {errors[service.name] && <div className="integration-error" role="alert"><CircleAlert size={16} /><span>{errors[service.name]}</span></div>}
        {isOpen && <div className="integration-form">{service.fields}</div>}
      </article>;
    })}</div>
  </section>;
}

function SwitchRow({ title, description, checked, onChange }) {
  return <label className="switch-row">
    <span><strong>{title}</strong>{description && <small>{description}</small>}</span>
    <input type="checkbox" role="switch" aria-label={title} checked={checked} onChange={(event) => onChange(event.target.checked)} />
  </label>;
}

// Aperçu de l’écran TV : on y glisse chaque élément dans la zone voulue, et un simple clic ouvre le mode TV.
const TV_WIDGET_ICONS = { cover: Disc3, info: Music2, player: Play, next: ListMusic, qr: QrCode };

function TvLayoutEditor({ placement, onMove, onOpen }) {
  const [drag, setDrag] = useState(null);
  const previewRef = useRef(null);
  // Après un déplacement, le clic qui suit le relâchement ne doit pas ouvrir le mode TV.
  const quietUntil = useRef(0);
  const stopRef = useRef(null);
  useEffect(() => () => stopRef.current?.(), []);
  // Zone sous le pointeur ; lâché entre deux zones (ou juste à côté de l’aperçu), l’élément va dans la plus proche.
  const zoneAt = (x, y) => {
    const preview = previewRef.current;
    if (!preview) return null;
    const area = preview.getBoundingClientRect();
    if (x < area.left - 48 || x > area.right + 48 || y < area.top - 48 || y > area.bottom + 48) return null;
    let best = null;
    let bestDistance = Infinity;
    for (const zone of preview.querySelectorAll('[data-drop-zone]')) {
      const rect = zone.getBoundingClientRect();
      const distance = Math.hypot(Math.max(rect.left - x, 0, x - rect.right), Math.max(rect.top - y, 0, y - rect.bottom));
      if (distance < bestDistance) { bestDistance = distance; best = zone.dataset.dropZone; }
    }
    return best;
  };
  // Le geste est suivi sur toute la fenêtre (pas seulement sur la capsule) : le relâchement est toujours vu,
  // même si la souris ou le trackpad quitte la capsule en route.
  const onPointerDown = (event, id) => {
    if (event.button !== 0) return;
    event.preventDefault();
    stopRef.current?.();
    // La capsule garde l’endroit exact où on l’a attrapée : elle suit la souris sans sauter.
    const rect = event.currentTarget.getBoundingClientRect();
    const start = { id, x: event.clientX, y: event.clientY, dx: event.clientX - rect.left, dy: event.clientY - rect.top, width: rect.width, moved: false, over: null };
    const move = (moveEvent) => {
      if (!start.moved && Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) < 4) return;
      start.moved = true;
      start.over = zoneAt(moveEvent.clientX, moveEvent.clientY);
      setDrag({ id, left: moveEvent.clientX - start.dx, top: moveEvent.clientY - start.dy, width: start.width, over: start.over });
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      stopRef.current = null;
    };
    const up = (upEvent) => {
      stop();
      if (!start.moved) return;
      quietUntil.current = performance.now() + 400;
      const zone = zoneAt(upEvent.clientX, upEvent.clientY);
      if (zone) onMove(id, zone);
      setDrag(null);
    };
    // Glissement interrompu (fenêtre quittée…) : rien ne bouge.
    const cancel = () => { stop(); if (start.moved) quietUntil.current = performance.now() + 400; setDrag(null); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    stopRef.current = stop;
  };
  const dragged = drag && TV_WIDGETS.find((item) => item.id === drag.id);
  const DragIcon = drag && TV_WIDGET_ICONS[drag.id];
  return <div className={drag ? 'tv-editor dragging' : 'tv-editor'}>
    <p className="tv-preview-hint"><Tv size={14} />{tx("Cliquez sur l’aperçu pour ouvrir le mode TV, ou glissez un élément pour le déplacer.")}</p>
    <div ref={previewRef} className="tv-preview" role="button" tabIndex={0} aria-label={tx("Ouvrir le mode TV")}
      onClick={() => { if (performance.now() < quietUntil.current || drag) return; onOpen(); }}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(); } }}>
      {TV_ZONES.map(([zone, label]) => <div key={zone} className={`tv-preview-zone tv-zone-${zone}${drag?.over === zone ? ' is-over' : ''}`} data-drop-zone={zone} title={label}>
        {TV_WIDGETS.filter((item) => placement[item.id] === zone).map((item) => {
          const Icon = TV_WIDGET_ICONS[item.id];
          return <span key={item.id} className={drag?.id === item.id ? 'tv-chip is-dragging' : 'tv-chip'} title={tx("{0} — glissez pour déplacer", item.label)}
            onPointerDown={(event) => onPointerDown(event, item.id)}>
            <Icon size={13} />{item.label}
          </span>;
        })}
      </div>)}
    </div>
    {dragged && createPortal(<span className="tv-chip tv-chip-ghost" style={{ left: drag.left, top: drag.top, width: drag.width }}><DragIcon size={13} />{dragged.label}</span>, document.body)}
  </div>;
}

function AppearanceView({ appearance, onChange, onReset, onOpenTv, onSection }) {

  const areas = [...new Set(WIDGETS.map((widget) => widget.area))];
  return <section className="subpage settings-page appearance-page">
    <div className="page-heading"><div><div className="eyebrow">{tx("RÉGLAGES")}</div><h1>{tx("Réglages")}</h1><SettingsSections active="appearance" onChange={onSection} /><p>{tx("Ces réglages s’appliquent à cet appareil : tableau de bord et mode TV. Les invités gardent l’affichage habituel.")}</p></div></div>
    <div className="settings-card">
      <h2>{tx("Langue")}</h2>
      <p className="field-help">{tx("Langue de Sono sur cet appareil. Vos invités voient la même langue.")}</p>
      <div className="provider-tabs" role="radiogroup" aria-label={tx("Langue")}>
        {[['fr', 'Français'], ['en', 'English']].map(([id, label]) => <button key={id} type="button" role="radio" aria-checked={lang === id} className={lang === id ? 'active' : ''} onClick={() => apiRequest('/api/local/host', { method: 'PUT', body: JSON.stringify({ lang: id }) }).catch(() => {}).finally(() => setLang(id))}><Languages size={15} />{label}</button>)}
      </div>
    </div>
    <div className="settings-card">
      <h2>Style</h2>
      <SwitchRow title="Liquid Glass" description={tx("Panneaux translucides façon verre, qui laissent voir l’arrière-plan. Plus beau avec un fond coloré ou une image.")} checked={appearance.glass} onChange={(glass) => onChange({ glass })} />
    </div>
    <div className="settings-card">
      <h2>{tx("Arrière-plan")}</h2>
      <div className="swatches">
        {BACKGROUNDS.map((item) => <button key={item.id} type="button" title={item.title || item.label} className={appearance.background === item.id ? 'swatch active' : 'swatch'} aria-pressed={appearance.background === item.id} onClick={() => onChange({ background: item.id })}><span className="swatch-preview" style={{ background: item.css }} />{item.label}</button>)}
        <button type="button" className={appearance.background === 'cover' ? 'swatch active' : 'swatch'} aria-pressed={appearance.background === 'cover'} onClick={() => onChange({ background: 'cover' })}><span className="swatch-preview" style={{ background: 'linear-gradient(135deg, #3a2a5c, #1f4a5c)' }}><Disc3 size={22} /></span>{tx("Pochette en cours")}</button>
      </div>
    </div>
    <div className="settings-card">
      <h2>{tx("Couleur d’accent")}</h2>
      <p className="field-help">{tx("Boutons, titre en cours, éléments actifs.")}</p>
      <div className="accent-dots">
        {ACCENTS.map((accent) => <button key={accent.hex} type="button" className={appearance.accent === accent.hex ? 'accent-dot active' : 'accent-dot'} style={{ '--dot': accent.dot || accent.hex }} title={accent.label} aria-label={`Accent ${accent.label}`} aria-pressed={appearance.accent === accent.hex} onClick={() => onChange({ accent: accent.hex })} />)}
      </div>
    </div>
    <div className="settings-card widget-list">
      <h2>{tx("Widgets du tableau de bord")}</h2>
      <p className="field-help">{tx("Affichez seulement ce qui vous sert. Sans widget à droite, la file prend toute la largeur.")}</p>
      {areas.map((area) => <div key={area}>
        <span className="widget-area">{area === 'Centre' ? tx("Colonne centrale") : tx("Colonne de droite")}</span>
        {WIDGETS.filter((widget) => widget.area === area).map((widget) => <SwitchRow key={widget.id} title={widget.label} description={widget.description} checked={appearance.widgets[widget.id]} onChange={(checked) => onChange({ widgets: { [widget.id]: checked } })} />)}
      </div>)}
    </div>
    <div className="settings-card tv-settings">
      <h2>{tx("Mode TV")}</h2>
      <p className="field-help">{tx("Placez chaque élément dans la zone de l’écran où vous le voulez. Plusieurs éléments dans une même zone s’empilent, et chacun s’adapte à la place disponible.")}</p>
      <span className="widget-area">{tx("Fond de l’écran")}</span>
      <div className="segmented" role="group" aria-label={tx("Fond du mode TV")}>
        {[['cover', tx("Pochette en cours (animée)")], ['black', tx("Noir uni")]].map(([id, label]) => <button key={id} type="button" className={appearance.tvBackground === id ? 'active' : ''} aria-pressed={appearance.tvBackground === id} onClick={() => onChange({ tvBackground: id })}>{label}</button>)}
      </div>
      <span className="widget-area">{tx("Disposition")}</span>
      <TvLayoutEditor placement={appearance.tvPlacement} onMove={(id, zone) => onChange({ tvPlacement: { [id]: zone } })} onOpen={onOpenTv} />
      <div className="tv-element-list widget-list">
        {TV_WIDGETS.map((item) => {
          const zone = appearance.tvPlacement[item.id];
          return <SwitchRow key={item.id} title={item.label} description={zone === 'hidden' ? tx("Masqué") : `${TV_ZONES.find(([id]) => id === zone)?.[1] || ''} · ${item.description}`} checked={zone !== 'hidden'}
            onChange={(shown) => onChange({ tvPlacement: { [item.id]: shown ? DEFAULT_APPEARANCE.tvPlacement[item.id] : 'hidden' } })} />;
        })}
      </div>
      <label className="range-row">{tx("Taille de la pochette")}<input type="range" min="30" max="200" step="5" value={appearance.tvCoverScale} onChange={(event) => onChange({ tvCoverScale: Number(event.target.value) })} /><output>{appearance.tvCoverScale} %</output></label>
      <label className="range-row">{tx("Taille du QR code")}<input type="range" min="20" max="200" step="5" value={appearance.tvQrScale} onChange={(event) => onChange({ tvQrScale: Number(event.target.value) })} /><output>{appearance.tvQrScale} %</output></label>
      <p className="field-help">{tx("Les tailles se règlent aussi en direct dans le mode TV ouvert depuis l’aperçu, en haut à gauche.")}</p>
      <SwitchRow title={tx("« Proposé par »")} description={tx("Le prénom de la personne qui a ajouté le titre, sous l’artiste.")} checked={appearance.tvShowAddedBy} onChange={(tvShowAddedBy) => onChange({ tvShowAddedBy })} />
      <SwitchRow title={tx("Texte à côté du QR code")} description={tx("« Ajoutez vos titres » et le lien court.")} checked={appearance.tvShowQrText} onChange={(tvShowQrText) => onChange({ tvShowQrText })} />
    </div>
    <div className="form-actions"><button type="button" className="button secondary" onClick={onReset}>{tx("Réinitialiser l’apparence")}</button></div>
  </section>;
}

// Réglages du son : basses, médiums et aigus, appliqués en direct à l’égaliseur du moteur Deezer.
const SOUND_PRESETS = [
  [tx("Neutre"), { bass: 0, mid: 0, treble: 0 }],
  [tx("Moins de basses"), { bass: -6, mid: 0, treble: 1 }],
  [tx("Plus de basses"), { bass: 5, mid: 0, treble: 0 }],
  [tx("Voix claires"), { bass: -2, mid: 3, treble: 1.5 }],
  [tx("Aigus brillants"), { bass: 0, mid: -1, treble: 4 }],
];

function SoundCard({ sessionCode, hostToken, source, notify }) {
  const [sound, setSound] = useState(null);
  const saveTimer = useRef(0);
  useEffect(() => {
    apiRequest(`/api/sound?code=${encodeURIComponent(sessionCode)}`, { headers: { 'x-host-token': hostToken } }).then((data) => setSound(data.sound)).catch(() => {});
  }, [sessionCode, hostToken]);
  const update = (next) => {
    setSound(next);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      apiRequest('/api/sound', { method: 'PUT', headers: { 'x-host-token': hostToken }, body: JSON.stringify({ code: sessionCode, sound: next }) }).catch((error) => notify(error.message, 'error'));
    }, 120);
  };
  if (!sound) return null;
  const active = SOUND_PRESETS.find(([, preset]) => Object.keys(preset).every((key) => preset[key] === sound[key]))?.[0];
  const dB = (value) => `${value > 0 ? '+' : ''}${String(value).replace('.', ',')} dB`;
  return <div className="settings-card sound-card">
    <h2>{tx("Son")}</h2>
    <p className="field-help">{tx("Ajustez le rendu de la musique en direct")}{source !== 'Deezer' ? tx(" (lecture Deezer uniquement)") : ''}.</p>
    <div className="segmented" role="group" aria-label={tx("Préréglages du son")}>
      {SOUND_PRESETS.map(([label, preset]) => <button key={label} type="button" className={active === label ? 'active' : ''} aria-pressed={active === label} onClick={() => update(preset)}>{label}</button>)}
    </div>
    {[['bass', tx("Basses")], ['mid', tx("Médiums")], ['treble', tx("Aigus")]].map(([key, label]) => <label key={key} className="range-row">{label}<input type="range" min="-12" max="12" step="0.5" value={sound[key]} onChange={(event) => update({ ...sound, [key]: Number(event.target.value) })} /><output>{dB(sound[key])}</output></label>)}
  </div>;
}

// Paramètres en deux sections : la session (accès, invitation, suppression) et l’apparence de cet appareil.
function SettingsSections({ active, onChange }) {
  return <div className="segmented settings-sections" role="tablist" aria-label={tx("Sections des paramètres")}>
    {[['settings', 'Session', Settings], ['appearance', tx("Apparence"), Palette]].map(([id, label, Icon]) => <button key={id} type="button" role="tab" aria-selected={active === id} className={active === id ? 'active' : ''} onClick={() => { if (active !== id) { onChange(id); window.scrollTo(0, 0); } }}><Icon size={15} />{label}</button>)}
  </div>;
}

function SettingsView({ session, hostToken, notify, inviteUrl, joinUrl, onCopy, onSave, onDelete, onSection }) {
  const [name, setName] = useState(session.name);
  const [hostName, setHostName] = useState(session.host === 'Hôte' ? '' : session.host);
  const [saving, setSaving] = useState(null);
  useEffect(() => setName(session.name), [session.name]);
  useEffect(() => setHostName(session.host === 'Hôte' ? '' : session.host), [session.host]);
  const nameUnchanged = !name.trim() || name.trim() === session.name;
  const hostUnchanged = !hostName.trim() || hostName.trim() === session.host;
  const submit = (field, value, message) => async (event) => {
    event.preventDefault();
    setSaving(field);
    await onSave({ [field]: value.trim() }, message);
    setSaving(null);
  };
  return <section className="subpage settings-page">
    <div className="page-heading"><div><div className="eyebrow">{tx("RÉGLAGES")}</div><h1>{tx("Réglages")}</h1><SettingsSections active="settings" onChange={onSection} /></div></div>
    <form className="settings-card profile-card" onSubmit={submit('host', hostName, tx("Profil enregistré."))}>
      <div className="profile-head"><Avatar name={hostName || session.host} className="large" /><div><h2>{tx("Mon profil")}</h2><p className="field-help">{tx("Ce nom apparaît aux invités et à côté des titres que vous ajoutez.")}</p></div></div>
      <label>{tx("Votre nom")}<input value={hostName} maxLength={30} placeholder={tx("Ex. Camille")} autoComplete="given-name" onChange={(e) => setHostName(e.target.value)} /></label>
      <div className="form-actions"><button className="button primary" type="submit" disabled={hostUnchanged || saving === 'host'}>{saving === 'host' && <LoaderCircle className="spin" size={16} />}{tx("Enregistrer le profil")}</button></div>
    </form>
    <form className="settings-card" onSubmit={submit('name', name, tx("Nom de la session enregistré."))}>
      <h2>Session</h2>
      <label>{tx("Nom de la session")}<input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      <div className="form-actions"><button className="button primary" type="submit" disabled={nameUnchanged || saving === 'name'}>{saving === 'name' && <LoaderCircle className="spin" size={16} />}{tx("Enregistrer")}</button></div>
    </form>
    <SoundCard sessionCode={session.code} hostToken={hostToken} source={session.source} notify={notify} />
    <div className="settings-card">
      <h2>{tx("Accès à la session")}</h2>
      <ApprovalSwitch checked={Boolean(session.requireApproval)} onChange={(value) => onSave({ requireApproval: value }, value ? tx("Vous validerez désormais chaque nouvel invité.") : tx("Tout le monde peut rejoindre avec le code."))} description={tx("Chaque personne qui rejoint doit être acceptée par vous. Les invités déjà présents restent dans la session.")} />
    </div>
    <div className="settings-card">
      <h2>{tx("Lien d’invitation")}</h2>
      <p className="field-help">{tx("Partagez ce lien avec les invités qui ne peuvent pas scanner le code QR.")}</p>
      <div className="invite-link"><span>{inviteUrl}</span><button type="button" className="button secondary" onClick={onCopy}><Copy size={15} />{tx("Copier")}</button></div>
    </div>
    <CacheCard notify={notify} />
    <div className="settings-card danger-zone">
      <h2>{tx("Supprimer la session")}</h2>
      <p className="field-help">{tx('La file d’attente, l’historique et la liste des invités sont effacés définitivement. Les invités connectés sont déconnectés et le code {0} ne fonctionnera plus.', session.code)}</p>
      <div className="form-actions"><button type="button" className="button danger-button" onClick={onDelete}><Trash2 size={15} />{tx("Supprimer la session")}</button></div>
    </div>
  </section>;
}

async function appleLibraryRequest(music, path) {
  const response = await music.api.music(path);
  return response.data?.data ? response.data : response;
}

function FallbackModal({ source, sessionCode, hostToken, onClose, onChoose }) {
  const [tab, setTab] = useState('playlist');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [mine, setMine] = useState([]);
  const [loading, setLoading] = useState(false);
  const [choosing, setChoosing] = useState(null);
  const [error, setError] = useState('');
  const headers = { 'x-host-token': hostToken };
  // Vos propres playlists, affichées avant toute recherche.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (source === 'Apple Music') {
          const music = await getAppleMusic();
          if (!music.isAuthorized) return;
          const page = await appleLibraryRequest(music, '/v1/me/library/playlists?limit=50');
          if (!cancelled) setMine((page.data || []).map((item) => ({ type: 'playlist', id: item.id, name: item.attributes?.name || 'Playlist', subtitle: tx("Ma bibliothèque"), cover: item.attributes?.artwork?.url?.replace('{w}', '300').replace('{h}', '300') || '', library: true })));
        } else {
          const data = await apiRequest(`/api/sessions/${sessionCode}/catalog/mine`, { headers });
          if (!cancelled) setMine(data.playlists || []);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, sessionCode]);
  useEffect(() => {
    const term = query.trim();
    if (!term) { setResults(null); setError(''); return undefined; }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const data = await apiRequest(`/api/sessions/${sessionCode}/catalog/search?q=${encodeURIComponent(term)}&source=${encodeURIComponent(source)}`, { headers });
        if (!cancelled) { setResults(data); setError(''); }
      } catch (searchError) { if (!cancelled) setError(searchError.message); }
      finally { if (!cancelled) setLoading(false); }
    }, 350);
    return () => { cancelled = true; window.clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, source, sessionCode]);
  const choose = async (item) => {
    setChoosing(item.id);
    setError('');
    try {
      const choice = { type: item.type, id: item.id, name: item.name, subtitle: item.subtitle, cover: item.cover };
      if (item.library) {
        const music = await getAppleMusic();
        const tracks = [];
        let next = `/v1/me/library/playlists/${encodeURIComponent(item.id)}/tracks?limit=100`;
        while (next && tracks.length < 10000) {
          const page = await appleLibraryRequest(music, next);
          for (const song of page.data || []) {
            const details = song.attributes || {};
            const catalogId = details.playParams?.catalogId;
            if (catalogId) tracks.push({ providerId: catalogId, title: details.name, artist: details.artistName, album: details.albumName, durationMs: details.durationInMillis, cover: details.artwork?.url?.replace('{w}', '400').replace('{h}', '400') || '', source: 'Apple Music' });
          }
          next = page.next || null;
        }
        choice.tracks = tracks;
      }
      await onChoose(choice);
    } catch (chooseError) { setError(chooseError.message); }
    finally { setChoosing(null); }
  };
  const key = `${tab}s`;
  const items = results ? results[key] || [] : tab === 'playlist' ? mine : [];
  const kind = FALLBACK_TYPES[tab];
  return <Modal onClose={onClose} className="search-modal fallback-modal">
    <h2 className="fallback-modal-title">{tx("Musique de fond")}</h2>
    <nav className="fallback-tabs" aria-label={tx("Type de sélection")}>{Object.entries(FALLBACK_TYPES).map(([type, info]) => <button key={type} type="button" className={tab === type ? 'active' : ''} aria-pressed={tab === type} onClick={() => setTab(type)}><info.icon size={15} />{info.plural}</button>)}</nav>
    <label className="search-input"><Search size={19} /><input autoFocus aria-label={tx("Rechercher {0}", kind.plural.toLowerCase())} placeholder={tab === 'artist' ? tx("Rechercher un artiste…") : tab === 'album' ? tx("Rechercher un album…") : tx("Rechercher une playlist…")} value={query} onChange={(event) => setQuery(event.target.value)} />{loading && <LoaderCircle className="spin" size={17} />}</label>
    {error && <p className="inline-error" role="alert"><CircleAlert size={16} />{error}</p>}
    {!results && tab === 'playlist' && mine.length > 0 && <div className="mini-heading fallback-section"><h3>{tx("Mes playlists")}</h3></div>}
    {items.length > 0 ? <ul className="fallback-results">{items.map((item) => <li key={`${item.type}-${item.id}`}>
      <button type="button" disabled={Boolean(choosing)} aria-label={tx("Choisir {0}", item.name)} onClick={() => choose(item)}>
        <span className={item.type === 'artist' ? 'fallback-cover round' : 'fallback-cover'}>{item.cover ? <img src={coverAt(item.cover, 250)} alt="" loading="lazy" decoding="async" /> : <kind.icon size={18} />}</span>
        <span className="fallback-text"><strong>{item.name}</strong><small>{item.subtitle}</small></span>
        {choosing === item.id ? <LoaderCircle className="spin" size={17} /> : <ChevronRight size={17} />}
      </button>
    </li>)}</ul> : <p className="recent-empty fallback-empty">{results ? tx("Aucun résultat.") : tab === 'playlist' ? tx("Recherchez une playlist, ou choisissez-en une de votre compte si elle apparaît ici.") : tx("Recherchez {0}.", tab === 'artist' ? tx('un artiste : ses titres les plus écoutés passeront en aléatoire') : tx('un album : il sera joué dans l’ordre'))}</p>}
  </Modal>;
}

function DeleteSessionModal({ session, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const confirm = async () => { setBusy(true); await onConfirm(); setBusy(false); };
  return <Modal onClose={onClose} className="confirm-modal">
    <div className="modal-symbol danger"><Trash2 size={22} /></div>
    <h2>{tx('Supprimer « {0} » ?', session.name)}</h2>
    <p>{tx("La file, l’historique et les invités seront effacés. Tout le monde sera déconnecté. Cette action est irréversible.")}</p>
    <div className="modal-actions"><button className="button secondary" onClick={onClose}>{tx("Annuler")}</button><button className="button danger-button" disabled={busy} onClick={confirm}>{busy && <LoaderCircle className="spin" size={16} />}{tx("Supprimer définitivement")}</button></div>
  </Modal>;
}

function hiResCover(url) {
  if (!url) return '';
  return coverAt(url, 1000);
}

// Fond du mode TV : la pochette en cours, floutée une seule fois, composée (nappes et halos de ses couleurs) en UNE
// image, que le navigateur déplace très lentement (déplacement et zoom uniquement). Un seul calque à animer :
// presque aucun coût pour le processeur et la carte graphique, même modestes. À chaque nouveau titre, la nouvelle
// pochette arrive en fondu.
const AMBIENT_W = 640;

const AMBIENT_H = 360;

function composeAmbient(bitmap, palette, shade) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = AMBIENT_W;
        canvas.height = AMBIENT_H;
        const context = canvas.getContext('2d');
        context.fillStyle = '#050505';
        context.fillRect(0, 0, AMBIENT_W, AMBIENT_H);
        // Nappes de la pochette : grande en haut à gauche, grande en bas à droite, petite au centre.
        const blob = (size, x, y, alpha) => { context.globalAlpha = alpha; context.filter = 'brightness(1.45) saturate(1.15)'; context.drawImage(image, x, y, size, size); context.filter = 'none'; };
        const big = AMBIENT_W * 0.95;
        blob(big, -big * 0.35, -big * 0.55, 1);
        blob(big, AMBIENT_W - big * 0.7, AMBIENT_H - big * 0.6, 1);
        blob(AMBIENT_W * 0.7, AMBIENT_W * 0.2, -AMBIENT_H * 0.15, 0.65);
        // Halos des couleurs dominantes.
        const halos = [[0.12, 0.1, 0.5], [0.88, 0.95, 0.55], [0.5, 0.5, 0.4]];
        palette.slice(0, 3).forEach(([red, green, blue], index) => {
          const [cx, cy, r] = halos[index];
          const x = cx * AMBIENT_W;
          const y = cy * AMBIENT_H;
          const radius = r * AMBIENT_W;
          const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
          gradient.addColorStop(0, `rgba(${red}, ${green}, ${blue}, .62)`);
          gradient.addColorStop(1, `rgba(${red}, ${green}, ${blue}, 0)`);
          context.globalAlpha = 1;
          context.fillStyle = gradient;
          context.fillRect(0, 0, AMBIENT_W, AMBIENT_H);
        });
        context.globalAlpha = 1;
        context.fillStyle = `rgba(0, 0, 0, ${shade})`;
        context.fillRect(0, 0, AMBIENT_W, AMBIENT_H);
        resolve(canvas.toDataURL('image/jpeg', 0.92));
      } catch { resolve(null); }
    };
    image.onerror = () => resolve(null);
    image.src = bitmap;
  });
}

function TvAmbient({ cover }) {
  const measure = useImageMeasure(cover);
  const [layers, setLayers] = useState([]);
  const nextId = useRef(0);
  useEffect(() => {
    if (!measure || !cover) return undefined;
    let live = true;
    // Le voile du mode TV assombrit déjà d’environ 35 % : la pochette n’ajoute que le complément utile.
    const shade = Math.max(0, 1 - (1 - (measure.shade ?? 0.45)) / 0.85);
    composeAmbient(measure.smooth || measure.blur || cover, measure.palette || [], shade).then((picture) => {
      if (!live || !picture) return;
      setLayers((list) => (list.at(-1)?.cover === cover ? list : [...list.slice(-1), { id: nextId.current++, cover, picture }]));
    });
    return () => { live = false; };
  }, [measure, cover]);
  useEffect(() => {
    if (layers.length < 2) return undefined;
    const timer = window.setTimeout(() => setLayers((list) => list.slice(-1)), 2400);
    return () => window.clearTimeout(timer);
  }, [layers]);
  return <div className="tv-ambient" aria-hidden="true">
    {layers.map((layer) => <div key={layer.id} className="tv-ambient-layer"><img className="tv-drift" src={layer.picture} alt="" decoding="async" /></div>)}
  </div>;
}

// Zoom du mode TV : l’écran entier part de l’élément d’origine (lecteur ou aperçu des réglages)
// et s’agrandit jusqu’au plein écran ; à la fermeture, il revient s’y loger.
const tvOriginElement = (origin) => origin?.map((selector) => document.querySelector(selector)).find(Boolean) || null;

// Plein écran du mode TV dans un navigateur. Dans l’app de bureau, le mode TV reste dans la fenêtre telle
// qu’elle est : passer la fenêtre en plein écran à sa place faisait planter macOS au retour du bouton vert.
const setScreenFull = (on) => {
  if (window.sonoDesktop) return Promise.resolve();
  if (on) return document.documentElement.requestFullscreen?.().catch(() => {});
  return document.fullscreenElement ? document.exitFullscreen?.().catch(() => {}) : Promise.resolve();
};

// Le zoom n’anime que le déplacement, la taille et la transparence : trois propriétés que la carte graphique
// gère seule, sans redessiner l’écran à chaque image (un découpage arrondi animé, lui, le forçait).
function tvZoomKeyframes(origin) {
  const target = tvOriginElement(origin);
  const { innerWidth: width, innerHeight: height } = window;
  let rect = target?.getBoundingClientRect();
  // Élément absent ou hors de l’écran : zoom depuis le centre.
  if (!rect || !rect.width || rect.bottom < 0 || rect.top > height) rect = { left: width * .2, top: height * .2, width: width * .6, height: height * .6 };
  const scale = rect.width / width;
  const dx = rect.left + rect.width / 2 - width / 2;
  const dy = rect.top + rect.height / 2 - height / 2;
  return [
    { transform: `translate3d(${dx}px, ${dy}px, 0) scale(${scale})`, opacity: 0 },
    { opacity: 1, offset: .3 },
    { transform: 'translate3d(0, 0, 0) scale(1)', opacity: 1 },
  ];
}

function TvView({ origin, current, previousKey, next, playing, inviteUrl, controls, appearance, onAppearance, showTools, progressBar, onExit, toast, closeToast, children }) {
  const [idle, setIdle] = useState(false);
  // Passe à vrai une fois le zoom terminé : le fond animé et la pochette en haute définition n’arrivent qu’alors,
  // pour que le zoom ne partage pas la carte graphique avec leur chargement.
  const [settled, setSettled] = useState(false);
  const viewRef = useRef(null);
  const scrimRef = useRef(null);
  const closingRef = useRef(false);
  // Clic droit sur le mode TV : un petit menu discret pour masquer (ou remettre) le code QR et l’adresse.
  const [menu, setMenu] = useState(null);
  useEffect(() => {
    if (!menu) return undefined;
    const hide = () => setMenu(null);
    window.addEventListener('click', hide);
    window.addEventListener('blur', hide);
    return () => { window.removeEventListener('click', hide); window.removeEventListener('blur', hide); };
  }, [menu]);
  // Le lecteur d’origine s’efface pendant le zoom (c’est lui qui semble devenir le mode TV)
  // et un voile assombrit le tableau de bord ; la fermeture rejoue la même animation à l’envers.
  const zoom = useCallback((direction) => {
    const view = viewRef.current;
    const target = tvOriginElement(origin);
    if (!view || reducedMotion()) return Promise.resolve();
    if (target) target.style.visibility = 'hidden';
    scrimRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { ...TV_ZOOM, direction, fill: 'forwards' });
    return view.animate(tvZoomKeyframes(origin), { ...TV_ZOOM, direction, fill: direction === 'reverse' ? 'forwards' : 'none' })
      .finished.catch(() => {}).finally(() => { if (target) target.style.visibility = ''; });
  }, [origin]);
  // Plein écran d’abord (la page change de taille), puis zoom depuis le lecteur à sa place définitive.
  useLayoutEffect(() => {
    const view = viewRef.current;
    const motion = !reducedMotion();
    if (motion) view.style.opacity = '0';
    const settled = Promise.race([setScreenFull(true), new Promise((resolve) => window.setTimeout(resolve, 700))]);
    if (motion) settled.then(() => requestAnimationFrame(() => requestAnimationFrame(() => {
      if (closingRef.current) return;
      view.style.opacity = '';
      zoom('normal').then(() => { if (!closingRef.current) { document.documentElement.setAttribute('data-tv-open', ''); setSettled(true); } });
    })));
    else setSettled(true);
  }, []);
  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    // Le tableau de bord est de nouveau dessiné pendant que l’écran TV le recouvre encore entièrement ;
    // l’animation ne démarre que deux images plus tard, une fois ce travail fait (sinon elle saccade à son début).
    document.documentElement.removeAttribute('data-tv-open');
    Promise.resolve(setScreenFull(false)).then(() => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => zoom('reverse').then(() => onExitRef.current())))));
  }, [zoom]);
  const hdCover = hiResCover(current?.cover);
  // Au départ la pochette déjà en mémoire (celle du lecteur), puis la version 1400 px une fois le zoom terminé.
  const [coverSrc, setCoverSrc] = useState(() => coverAt(current?.cover, 500));
  useEffect(() => setCoverSrc(settled ? hdCover : coverAt(current?.cover, 500)), [hdCover, settled, current?.cover]);
  const placement = { ...DEFAULT_APPEARANCE.tvPlacement, ...appearance.tvPlacement };
  // Le titre s’affiche toujours en entier : sa taille diminue jusqu’à ce qu’il tienne dans sa zone, sans couper de mot.
  const titleRef = useRef(null);
  useLayoutEffect(() => {
    const title = titleRef.current;
    if (!title) return undefined;
    const fit = () => {
      const zone = title.closest('.tv-zone');
      const info = title.closest('.tv-info');
      if (!zone || !info) return;
      // Place disponible pour tout le bloc (étiquette, titre, artiste) : la zone moins les autres éléments,
      // en laissant au moins un tiers à une pochette ou un QR qui partagent la zone.
      const siblings = [...zone.children].filter((child) => child !== info);
      const gap = parseFloat(getComputedStyle(zone).rowGap) || 0;
      const fixed = siblings.filter((child) => !child.classList.contains('tv-fill')).reduce((sum, child) => sum + child.offsetHeight + gap, 0);
      const fills = siblings.filter((child) => child.classList.contains('tv-fill'));
      // Chaque pochette ou QR garde une part minimale de la zone (plus la place de son texte).
      const reserved = fills.reduce((sum, fill) => sum + gap + zone.clientHeight * (fills.length > 1 ? 0.2 : 0.36) + (fill.querySelector('.tv-invite-text')?.offsetHeight || 0), 0);
      const available = zone.clientHeight - fixed - reserved;
      let size = Math.min(96, window.innerWidth * 0.046, zone.clientWidth * 0.12);
      title.style.fontSize = `${size}px`;
      while (size > 16 && (info.offsetHeight > available || title.scrollWidth > title.clientWidth)) {
        size *= 0.93;
        title.style.fontSize = `${size}px`;
      }
    };
    fit();
    document.fonts?.ready.then(fit);
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [current?.title, placement.info, placement.cover, placement.qr, placement.player, placement.next, appearance.tvCoverScale, appearance.tvQrScale]);
  useEffect(() => {
    // Le tableau de bord reste dessous pendant le mode TV : il ne doit pas défiler.
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = 'hidden';
    // Quitter le plein écran (Échap) ramène à la vue normale.
    const onFullscreen = () => { if (!document.fullscreenElement) closeRef.current(); };
    const onKey = (event) => { if (event.key === 'Escape') closeRef.current(); };
    let timer;
    const wake = () => { setIdle(false); window.clearTimeout(timer); timer = window.setTimeout(() => setIdle(true), 2500); };
    wake();
    document.addEventListener('fullscreenchange', onFullscreen);
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousemove', wake);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('fullscreenchange', onFullscreen);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousemove', wake);
      root.style.overflow = overflow;
      setScreenFull(false);
      document.documentElement.removeAttribute('data-tv-open');
    };
  }, []);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const closeRef = useRef(close);
  closeRef.current = close;
  const widget = (id) => {
    if (id === 'cover') return <div className="tv-fill">{coverSrc
      ? <FadeCover className="tv-cover" src={coverSrc} onError={() => setCoverSrc((src) => (src !== coverAt(current?.cover, 600) ? coverAt(current?.cover, 600) : ''))} />
      : <span className="tv-cover cover-empty" aria-hidden="true"><Music2 size={84} /></span>}</div>;
    if (id === 'info') return <div className="tv-info">
      <span className="tv-label"><Equalizer playing={playing && Boolean(current)} />{!current ? tx("En attente") : playing ? tx("En lecture") : tx("En pause")}</span>
      <SwapText swapKey={trackKey(current)} backKey={previousKey}>
        <h1 ref={titleRef}>{current?.title || tx("Aucun titre en cours")}</h1>
        <p>{current ? current.artist : tx("Scannez le code pour proposer le premier titre.")}</p>
        {current?.album && <p className="tv-album">{current.album}</p>}
        {appearance.tvShowAddedBy && current?.addedBy && !current.fromFallback && <small>{tx("Proposé par {0}", current.addedBy)}</small>}
      </SwapText>
    </div>;
    // Lecture : les boutons sont attachés à la barre de progression.
    if (id === 'player') return <div className="tv-player">
      <div className="tv-player-buttons" role="group" aria-label={tx("Commandes de lecture")}>
        <IconButton label={tx("Revenir au titre précédent")} disabled={!controls.canPrevious} onClick={controls.onPrevious}><SkipBack size={22} /></IconButton>
        <IconButton label={playing ? tx("Mettre en pause") : tx("Reprendre la lecture")} className="tv-play" disabled={!current && !controls.canNext} onClick={controls.onToggle}><span key={playing ? "pause" : "lecture"} className="icon-swap">{playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}</span></IconButton>
        <IconButton label={tx("Passer au titre suivant")} disabled={!controls.canNext} onClick={controls.onNext}><SkipForward size={22} /></IconButton>
      </div>
      {progressBar}
    </div>;
    if (id === 'next') return next ? <SwapText swapKey={trackKey(next)} className="tv-next-swap"><div className="tv-next"><span>{tx("Ensuite")}</span>{`${next.title} · ${next.artist}`}</div></SwapText> : null;
    if (id === 'qr') return <div className={appearance.tvShowQrText ? 'tv-fill tv-invite' : 'tv-fill tv-invite no-text'}>
      <div className="tv-qr"><QRCodeSVG value={inviteUrl} size={280} bgColor="#f7f5ef" fgColor="#151512" level="M" /></div>
      {appearance.tvShowQrText && <div className="tv-invite-text"><strong>{tx("Ajoutez vos titres")}</strong><span>{inviteUrl.replace(/^https?:\/\//, '')}</span></div>}
    </div>;
    return null;
  };
  // Fond du mode TV : toujours tiré de la pochette en cours (animé), sauf si le noir uni est choisi.
  const blackBackground = appearance.tvBackground === 'black';
  const occupied = (zone) => TV_WIDGETS.some((item) => placement[item.id] === zone);
  const rows = TV_ROWS.filter((row) => TV_COLS.some((col) => occupied(tvZoneName(row, col))));
  const cols = TV_COLS.filter((col) => TV_ROWS.some((row) => occupied(tvZoneName(row, col))));
  // Au-delà de 100 %, la pochette et le QR agrandissent leur rangée et leur colonne.
  const coverScale = (appearance.tvCoverScale || 100) / 100;
  const qrScale = (appearance.tvQrScale || 70) / 100;
  const growth = (zone) => Math.max(1, placement.cover === zone ? coverScale : 1, placement.qr === zone ? qrScale / 0.7 : 1) ** 2;
  const rowWeight = (row) => (row === 'middle' ? 2.2 : TV_COLS.some((col) => ['info', 'cover'].some((id) => placement[id] === tvZoneName(row, col))) ? 1.5 : 1) * Math.max(...TV_COLS.map((col) => growth(tvZoneName(row, col))));
  const colWeight = (col) => (col === 'center' ? 1.5 : 1.15) * Math.max(...TV_ROWS.map((row) => growth(tvZoneName(row, col))));
  const gridStyle = {
    gridTemplateRows: rows.map((row) => `minmax(0, ${rowWeight(row)}fr)`).join(' '),
    gridTemplateColumns: cols.map((col) => `minmax(0, ${colWeight(col)}fr)`).join(' '),
    gridTemplateAreas: rows.map((row) => `"${cols.map((col) => tvZoneName(row, col)).join(' ')}"`).join(' '),
  };
  return <>
    <div ref={scrimRef} className="tv-scrim" aria-hidden="true" />
    <div ref={viewRef} onContextMenu={(event) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY }); }} className={`tv-view${current && !playing ? ' is-paused' : ''}${idle ? ' idle' : ''}${blackBackground ? ' tv-black' : ''}`} style={{ '--tv-cover-scale': Math.min(1, coverScale), '--tv-qr-scale': Math.min(1, qrScale) }}>
    {!blackBackground && <TvAmbient cover={settled ? current?.cover : ''} />}
    <button type="button" className="tv-exit" onClick={close}><X size={16} />{tx("Quitter le mode TV")}</button>
    {showTools && <div className="tv-tools">
      <label>{tx("Pochette")}<input type="range" min="30" max="200" step="5" value={appearance.tvCoverScale} aria-label={tx("Taille de la pochette")} onChange={(event) => onAppearance({ tvCoverScale: Number(event.target.value) })} /></label>
      <label>QR code<input type="range" min="20" max="200" step="5" value={appearance.tvQrScale} aria-label={tx("Taille du QR code")} onChange={(event) => onAppearance({ tvQrScale: Number(event.target.value) })} /></label>
    </div>}
    {children && <div className="tv-alerts">{children}</div>}
    <div className="tv-grid" style={gridStyle}>
      {TV_ZONES.map(([zone]) => {
        const ids = TV_WIDGETS.map((item) => item.id).filter((id) => placement[id] === zone);
        return ids.length ? <div key={zone} className={`tv-zone tv-zone-${zone}`} data-zone={zone} style={{ gridArea: zone }}>{ids.map((id) => <React.Fragment key={id}>{widget(id)}</React.Fragment>)}</div> : null;
      })}
    </div>
    {menu && <div className="tv-menu" role="menu" style={{ left: Math.min(menu.x, window.innerWidth - 270), top: Math.min(menu.y, window.innerHeight - 60) }}>
      <button type="button" role="menuitem" onClick={() => onAppearance({ tvPlacement: { qr: placement.qr === 'hidden' ? DEFAULT_APPEARANCE.tvPlacement.qr : 'hidden' } })}><QrCode size={15} />{placement.qr === 'hidden' ? tx("Afficher le code QR et l’adresse") : tx("Masquer le code QR et l’adresse")}</button>
    </div>}
    {toast && <Toast toast={toast} onClose={closeToast} />}
  </div>
  </>;
}


// « Vider le cache » : seulement dans l’app (pas sur la page d’un invité). La session en cours est fermée, le cache effacé,
// puis Sono se ferme pour repartir vraiment de zéro (le compte Deezer reste connecté).
function CacheCard({ notify }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!window.sonoDesktop) return null;
  const clear = async () => {
    setBusy(true);
    try {
      const response = await fetch('/api/local/cache', { method: 'POST' });
      if (!response.ok) throw new Error(tx("Le cache n’a pas pu être vidé."));
      notify(tx("Cache vidé : Sono se ferme."));
    } catch (error) { notify(error.message || tx("Le cache n’a pas pu être vidé."), 'error'); setBusy(false); setConfirming(false); }
  };
  return <div className="settings-card">
    <h2>{tx("Stockage")}</h2>
    <p className="field-help">{tx("Efface tout ce que l’app garde en cache (pochettes, pages, anciennes données). La session en cours est fermée et Sono se ferme ; vos comptes connectés sont conservés.")}</p>
    <div className="form-actions"><button type="button" className="button secondary" onClick={() => setConfirming(true)}><Trash2 size={15} />{tx("Vider le cache")}</button></div>
    {/* Attachée à la page : dans la carte (effet verre), elle serait centrée sur la carte et non sur la fenêtre. */}
    {confirming && createPortal(<Modal onClose={() => !busy && setConfirming(false)} className="confirm-modal">
      <div className="modal-symbol danger"><Trash2 size={22} /></div>
      <h2>{tx("Vider le cache ?")}</h2>
      <p>{tx("La session en cours va être fermée : la musique s’arrête et les invités ne pourront plus y accéder. Sono va ensuite se fermer pour que le cache soit entièrement vidé. Rouvrez l’app pour créer une nouvelle session.")}</p>
      <div className="modal-actions"><button className="button secondary" disabled={busy} onClick={() => setConfirming(false)}>{tx("Annuler")}</button><button className="button danger-button" disabled={busy} onClick={clear}>{busy ? <LoaderCircle className="spin" size={16} /> : null}{tx("Vider et fermer Sono")}</button></div>
    </Modal>, document.body)}
  </div>;
}

export { ActivityView, AppearanceView, DeleteSessionModal, FallbackModal, IntegrationsView, QRCodeSVG, SettingsView, TvView };
