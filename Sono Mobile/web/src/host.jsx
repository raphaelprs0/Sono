// Mode TV (écran de la TV ouvert par l’app iPhone) : chargé seulement pour cet écran, jamais sur la page des invités.
import { Music2, Pause, Play, QrCode, SkipBack, SkipForward, X } from 'lucide-react';
import { tx } from './i18n.js';
import { QRCodeSVG } from 'qrcode.react';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AirplayButton, DEFAULT_APPEARANCE, Equalizer, FadeCover, IconButton, SwapText, TV_ZOOM, Toast, coverAt, native, reducedMotion, trackKey, useImageMeasure } from './App.jsx';


// Grille du mode TV : rangées et colonnes ; seules celles qui contiennent un élément prennent de la place.
const TV_WIDGETS = [
  { id: 'cover', label: tx("Pochette"), description: tx("La pochette du titre en cours.") },
  { id: 'info', label: tx("Titre et artiste"), description: tx("Avec « Proposé par » si quelqu’un l’a ajouté.") },
  { id: 'player', label: tx("Lecture"), description: tx("Barre de progression avec précédent, pause et suivant (les boutons apparaissent quand la souris bouge).") },
  { id: 'next', label: tx("Titre suivant"), description: tx("La ligne « Ensuite ».") },
  { id: 'qr', label: tx("Code QR"), description: tx("Pour que les invités ajoutent leurs titres.") },
];

const TV_ROWS = ['middle', 'bottom'];

const TV_COLS = ['left', 'center', 'right'];

const tvZoneName = (row, col) => (row === 'middle' ? col : col === 'center' ? row : `${row}-${col}`);

const TV_ZONES = [
  ['left', tx("À gauche")], ['center', tx("Au centre")], ['right', tx("À droite")],
  ['bottom-left', tx("En bas à gauche")], ['bottom', tx("En bas")], ['bottom-right', tx("En bas à droite")],
];














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

// L’écran prend exactement la forme de l’élément d’origine (largeur, hauteur et coins arrondis) : à la fermeture,
// il rétrécit jusqu’à se poser sur le lecteur, resté visible dessous, et s’efface juste avant d’y arriver.
function tvZoomKeyframes(origin, closing) {
  const target = tvOriginElement(origin);
  const { innerWidth: width, innerHeight: height } = window;
  let rect = target?.getBoundingClientRect();
  // Élément absent ou hors de l’écran : zoom depuis le centre.
  const visible = rect && rect.width && rect.bottom >= 0 && rect.top <= height;
  if (!visible) rect = { left: width * .2, top: height * .2, width: width * .6, height: height * .6 };
  const sx = rect.width / width;
  const sy = rect.height / height;
  const dx = rect.left + rect.width / 2 - width / 2;
  const dy = rect.top + rect.height / 2 - height / 2;
  // Les coins sont rétrécis avec l’écran : leur rayon est agrandi d’autant pour retomber sur celui du lecteur.
  const radius = visible ? parseFloat(getComputedStyle(target).borderTopLeftRadius) || 0 : 24;
  const small = { transform: `translate3d(${dx}px, ${dy}px, 0) scale(${sx}, ${sy})`, borderRadius: `${radius / sx}px / ${radius / sy}px`, opacity: 0 };
  const full = { transform: 'translate3d(0, 0, 0) scale(1, 1)', borderRadius: '0px / 0px', opacity: 1 };
  return closing ? [full, { opacity: 1, offset: .55 }, small] : [small, { opacity: 1, offset: .3 }, full];
}

function TvView({ display = false, origin, current, previousKey, next, playing, inviteUrl, controls, appearance, onAppearance, showTools, progressBar, onExit, toast, closeToast, children }) {
  const [idle, setIdle] = useState(false);
  // Passe à vrai une fois le zoom terminé : le fond animé et la pochette en haute définition n’arrivent qu’alors,
  // pour que le zoom ne partage pas la carte graphique avec leur chargement.
  const [settled, setSettled] = useState(false);
  // Téléphone : pochette en grand et lecteur, puis le code QR en glissant sur le côté.
  const [phone, setPhone] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  const [tvPage, setTvPage] = useState(0);
  const pagerRef = useRef(null);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 900px)');
    const onChange = () => setPhone(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  const showTvPage = (page) => pagerRef.current?.scrollTo({ left: page * pagerRef.current.clientWidth, behavior: 'smooth' });
  const viewRef = useRef(null);
  const scrimRef = useRef(null);
  const sheetRef = useRef(null);
  const readyRef = useRef(false);
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
    // Téléphone : le lecteur monte du bas de l’écran (et y redescend), comme celui d’Apple Music. C’est la zone qui
    // défile qui bouge, pas le lecteur : déplacer un élément aimanté ferait recaler le défilement d’iOS.
    const sheet = sheetRef.current;
    if (sheet) {
      const closing = direction === 'reverse';
      const slide = { duration: 540, easing: 'cubic-bezier(.32, .72, 0, 1)', fill: closing ? 'forwards' : 'none' };
      const down = { transform: `translate3d(0, ${sheet.clientHeight}px, 0)` };
      const up = { transform: 'none' };
      scrimRef.current?.animate(closing ? [{ opacity: 0.6 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 0.6 }], { ...slide, fill: 'forwards' });
      return sheet.animate(closing ? [up, down] : [down, up], slide).finished.catch(() => {});
    }
    const closing = direction === 'reverse';
    // À l’ouverture, le lecteur disparaît sous l’écran qui grandit ; à la fermeture, il reste affiché dessous
    // pour que l’écran qui rétrécit s’y fonde sans laisser de vide.
    if (target && !closing) target.style.visibility = 'hidden';
    scrimRef.current?.animate(closing ? [{ opacity: 1 }, { opacity: 0, offset: .55 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 1 }], { ...TV_ZOOM, fill: 'forwards' });
    return view.animate(tvZoomKeyframes(origin, closing), { ...TV_ZOOM, fill: closing ? 'forwards' : 'none' })
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
      zoom('normal').then(() => { if (!closingRef.current) { readyRef.current = true; const sheet = sheetRef.current; if (sheet) sheet.scrollTop = sheet.scrollHeight; document.documentElement.setAttribute('data-tv-open', ''); setSettled(true); } });
    })));
    else { readyRef.current = true; setSettled(true); }
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
  // Pochette en échec (réseau mobile) : on réessaie tant que le titre est affiché.
  useEffect(() => {
    if (coverSrc || !current?.cover) return undefined;
    const timer = window.setTimeout(() => setCoverSrc(coverAt(current.cover, 600)), 4000);
    return () => window.clearTimeout(timer);
  }, [coverSrc, current?.cover]);
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
  // Téléphone : le mode TV est dans une zone qui défile, avec deux arrêts (affiché, et sorti par le bas) : iOS le fait
  // suivre le doigt, garder l’élan et revenir en place, comme le lecteur d’Apple Music. Arrêté en bas, il se ferme.
  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    const view = viewRef.current;
    if (!phone || !sheet || !view) return undefined;
    sheet.scrollTop = sheet.scrollHeight;
    let frame = 0;
    let settle = 0;
    let moving = false;
    let touching = false;
    const max = () => Math.max(1, sheet.scrollHeight - sheet.clientHeight);
    // Pendant le geste : tableau de bord redessiné dessous (sans flou) et fond animé en pause.
    const lighten = (on) => {
      if (moving === on) return;
      moving = on;
      view.classList.toggle('is-dragging', on);
      if (on) scrimRef.current?.getAnimations().forEach((animation) => animation.cancel());
    };
    const finish = () => {
      if (closingRef.current) return;
      // Pendant l’ouverture (zoom), la position bouge toute seule : rien ne se décide avant la fin.
      if (!readyRef.current) { sheet.scrollTop = sheet.scrollHeight; return; }
      // Doigt encore posé : iOS n’a pas encore choisi le cran, rien ne se décide.
      if (touching) return;
      if (sheet.scrollTop <= 2) { closingRef.current = true; lighten(false); onExitRef.current(); return; }
      // Petit glissement (cran du haut) : il remonte en place.
      if (sheet.scrollTop >= max() * 0.8 && sheet.scrollTop < max() - 2) { sheet.scrollTo({ top: max(), behavior: 'smooth' }); return; }
      // Arrêté sur le cran intermédiaire (geste assez long ou lancé) : il finit de descendre tout seul, puis se ferme.
      if (sheet.scrollTop < max() - 4) { sheet.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      if (sheet.scrollTop >= max() - 2) { lighten(false); document.documentElement.setAttribute('data-tv-open', ''); if (scrimRef.current) scrimRef.current.style.opacity = ''; }
    };
    const onScroll = () => {
      if (closingRef.current || !readyRef.current) return;
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (scrimRef.current) scrimRef.current.style.opacity = String(0.6 * Math.min(1, sheet.scrollTop / max())); });
      window.clearTimeout(settle);
      settle = window.setTimeout(finish, 140);
    };
    // Le tableau de bord est préparé dessous dès que le doigt se pose : changer les styles pendant le défilement ferait revenir iOS au cran (geste interrompu).
    const down = () => { touching = true; window.clearTimeout(settle); if (readyRef.current && !closingRef.current) lighten(true); };
    // Doigt levé après un vrai glissement : il continue de descendre d’un trait (sans s’arrêter sur un cran à mi-hauteur).
    const up = () => {
      touching = false;
      window.clearTimeout(settle);
      if (readyRef.current && !closingRef.current && sheet.scrollTop < max() * 0.85) {
        sheet.style.scrollSnapType = 'none';
        sheet.scrollTo({ top: 0, behavior: 'smooth' });
      }
      settle = window.setTimeout(finish, 160);
    };
    sheet.addEventListener('scroll', onScroll, { passive: true });
    sheet.addEventListener('scrollend', finish);
    sheet.addEventListener('touchstart', down, { passive: true });
    sheet.addEventListener('touchend', up, { passive: true });
    sheet.addEventListener('touchcancel', up, { passive: true });
    return () => {
      sheet.removeEventListener('touchstart', down);
      sheet.removeEventListener('touchend', up);
      sheet.removeEventListener('touchcancel', up);
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      sheet.removeEventListener('scroll', onScroll);
      sheet.removeEventListener('scrollend', finish);
    };
  }, [phone]);
  const widget = (id) => {
    if (id === 'cover') return <div className="tv-fill">{coverSrc
      ? <FadeCover className="tv-cover" src={coverSrc} onError={() => setCoverSrc((src) => (src !== coverAt(current?.cover, 600) ? coverAt(current?.cover, 600) : ''))} />
      : <span className="tv-cover cover-empty" aria-hidden="true"><Music2 size={84} /></span>}</div>;
    if (id === 'info') return <div className={appearance.tvShowAddedBy ? 'tv-info with-by' : 'tv-info'}>
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
    // Sur téléphone la ligne garde sa place, même vide : la pochette et les boutons ne bougent pas.
    if (id === 'next') return next ? <SwapText swapKey={trackKey(next)} className="tv-next-swap"><div className="tv-next"><span>{tx("Ensuite")}</span>{`${next.title} · ${next.artist}`}</div></SwapText> : phone ? <div className="tv-next" aria-hidden="true">&nbsp;</div> : null;
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
  const view = <div ref={viewRef} onContextMenu={(event) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY }); }} className={`tv-view${display ? ' tv-display' : ''}${current && !playing ? ' is-paused' : ''}${idle ? ' idle' : ''}${blackBackground ? ' tv-black' : ''}`} style={{ '--tv-cover-scale': Math.min(1, coverScale), '--tv-qr-scale': Math.min(1, qrScale) }}>
    {!blackBackground && <TvAmbient cover={settled ? current?.cover : ''} />}
    {!phone && <button type="button" className="tv-exit" aria-label={tx("Quitter le mode TV")} onClick={close}><X size={16} />{tx("Quitter le mode TV")}</button>}
    {showTools && <div className="tv-tools">
      <label>{tx("Pochette")}<input type="range" min="30" max="200" step="5" value={appearance.tvCoverScale} aria-label={tx("Taille de la pochette")} onChange={(event) => onAppearance({ tvCoverScale: Number(event.target.value) })} /></label>
      <label>QR code<input type="range" min="20" max="200" step="5" value={appearance.tvQrScale} aria-label={tx("Taille du QR code")} onChange={(event) => onAppearance({ tvQrScale: Number(event.target.value) })} /></label>
    </div>}
    {children && <div className="tv-alerts">{children}</div>}
    {phone ? <>
      <span className="tv-grabber" aria-hidden="true" />
      {native && phone && <AirplayButton className="tv-airplay" />}
      <div ref={pagerRef} className="tv-pager" onScroll={(event) => setTvPage(Math.round(event.currentTarget.scrollLeft / Math.max(1, event.currentTarget.clientWidth)))}>
        <section className="tv-page tv-page-player">
          {widget('cover')}
          <div className="tv-page-controls">{widget('info')}{widget('player')}{widget('next')}</div>
        </section>
        <section className="tv-page tv-page-qr">{widget('qr')}</section>
      </div>
      <nav className="tv-page-nav" aria-label={tx("Pages du mode TV")}>
        <button type="button" className={tvPage === 0 ? 'active' : ''} aria-label={tx("Lecture")} aria-pressed={tvPage === 0} onClick={() => showTvPage(0)}><Music2 size={17} /></button>
        <button type="button" className={tvPage === 1 ? 'active' : ''} aria-label={tx("Code QR")} aria-pressed={tvPage === 1} onClick={() => showTvPage(1)}><QrCode size={17} /></button>
      </nav>
    </> : <div className="tv-grid" style={gridStyle}>
      {TV_ZONES.map(([zone]) => {
        const ids = TV_WIDGETS.map((item) => item.id).filter((id) => placement[id] === zone);
        return ids.length ? <div key={zone} className={`tv-zone tv-zone-${zone}`} data-zone={zone} style={{ gridArea: zone }}>{ids.map((id) => <React.Fragment key={id}>{widget(id)}</React.Fragment>)}</div> : null;
      })}
    </div>}
    {menu && <div className="tv-menu" role="menu" style={{ left: Math.min(menu.x, window.innerWidth - 270), top: Math.min(menu.y, window.innerHeight - 60) }}>
      <button type="button" role="menuitem" onClick={() => onAppearance({ tvPlacement: { qr: placement.qr === 'hidden' ? DEFAULT_APPEARANCE.tvPlacement.qr : 'hidden' } })}><QrCode size={15} />{placement.qr === 'hidden' ? tx("Afficher le code QR et l’adresse") : tx("Masquer le code QR et l’adresse")}</button>
    </div>}
    {toast && <Toast toast={toast} onClose={closeToast} />}
  </div>;
  return <>
    <div ref={scrimRef} className="tv-scrim" aria-hidden="true" />
    {phone && !display ? <div ref={sheetRef} className="tv-sheet"><div className="tv-sheet-gap" aria-hidden="true"><span className="tv-sheet-catch" /><span className="tv-sheet-catch is-hold" /></div>{view}<span className="tv-sheet-open" aria-hidden="true" /></div> : view}
  </>;
}



export { TvView };
