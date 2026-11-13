import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, lazy, Suspense } from 'react';
import { tx, txServer, locale, lang, setLang } from './i18n.js';
import {
  Activity, ArrowRight, Check, ChevronRight, CircleAlert, Clock3, Copy, Disc3, Globe2, GripVertical, Link2, Maximize2, ListMusic, LoaderCircle, LogOut, Music2, Pause, Play, Plus, QrCode, Radio, Repeat, Search, Settings, ShieldCheck, ShieldPlus, SkipBack, Smartphone, SkipForward, Trash2, Tv, UserMinus, UserPlus, UserRound, UsersRound, Wifi, X
} from 'lucide-react';
import { createPortal, flushSync } from 'react-dom';
import appleMusicLogo from './assets/apple-music.webp';
import deezerIcon from './assets/deezer.webp';

// Parties réservées à l’hôte (host.jsx) : chargées à part, jamais sur la page des invités, et préchargées dès que l’hôte est là.
export const loadHostParts = () => import('./host.jsx');
const hostPart = (name) => {
  const Lazy = lazy(() => loadHostParts().then((parts) => ({ default: parts[name] })));
  return (props) => <Suspense fallback={null}><Lazy {...props} /></Suspense>;
};
const IntegrationsView = hostPart('IntegrationsView');
const AppearanceView = hostPart('AppearanceView');
const SettingsView = hostPart('SettingsView');
const ActivityView = hostPart('ActivityView');
const FallbackModal = hostPart('FallbackModal');
const DeleteSessionModal = hostPart('DeleteSessionModal');
const TvView = hostPart('TvView');
const QRCodeSVG = hostPart('QRCodeSVG');


const defaultSession = { name: tx("Session Sono"), code: 'SONO-4821', host: 'Hôte', guests: 0, active: true, source: null };

const NAV_ITEMS = [
  { id: 'queue', label: tx("File d’attente"), icon: ListMusic },
  { id: 'activity', label: tx("Activité"), icon: Activity },
  { id: 'integrations', label: tx("Connexions"), icon: Link2 },
];

// ───────────── Apparence (réglages de l’appareil hôte, gardés dans le navigateur) ─────────────
const APPEARANCE_KEY = 'sono-appearance';
const DEFAULT_APPEARANCE = {
  background: 'black', accent: '#d7f75b', glass: false,
  widgets: { nowPlaying: true, progress: true, queue: true, fallback: true, invite: true, participants: true, stats: false, activity: false },
  // Mode TV : chaque widget est placé dans une zone d’une grille 3 × 3, ou masqué.
  tvPlacement: { cover: 'left', info: 'center', player: 'center', next: 'center', qr: 'right' },
  // Tailles en % de l’espace disponible dans la zone (jamais plus grand que la zone : rien ne se chevauche).
  tvShowAddedBy: true, tvShowQrText: true, tvCoverScale: 100, tvQrScale: 70,
  // Fond du mode TV : la pochette en cours, animée (« cover »), ou un noir uni (« black »).
  tvBackground: 'cover',
};
// Fonds : noir, blanc (thème clair) ou automatique (noir ou blanc selon le système) ; « Pochette en cours » est à part.
const BACKGROUNDS = [
  { id: 'black', edges: ['#000000', '#000000'], label: tx("Noir"), css: '#000000' },
  { id: 'white', edges: ['#f4f4f0', '#f4f4f0'], label: tx("Blanc"), css: 'radial-gradient(ellipse 90% 60% at 50% -10%, #ffffff 0, transparent 70%), #f4f4f0' },
  // Aperçu seulement : le fond affiché est celui que le système choisit (voir resolveLook).
  { id: 'auto', edges: ['#000000', '#000000'], label: tx("Automatique"), title: tx("Noir ou blanc selon le réglage du système"), css: 'linear-gradient(135deg, #000000 50%, #f4f4f0 50%)' },
];
// Couleurs d’accent, chacune avec la couleur de texte la plus lisible posée dessus (ink), une teinte de survol
// et, pour le thème clair, une version foncée utilisée quand l’accent sert de couleur de texte (lightText).
// « Natif » n’a pas de couleur propre : blanc sur un fond sombre, noir sur un fond clair (jamais confondu avec le fond).
const ACCENTS = [
  { hex: '#d7f75b', label: tx("Citron"), ink: '#171a08', hover: '#e4ff7a', lightText: '#5a7000' },
  { hex: '#c084fc', label: tx("Lilas"), ink: '#1f0b33', hover: '#d2a5fd', lightText: '#7a2ec4' },
  { hex: '#fb7185', label: tx("Framboise"), ink: '#330811', hover: '#fd94a4', lightText: '#c0243f' },
  { hex: '#fbbf24', label: tx("Or"), ink: '#2b1d02', hover: '#fcd05a', lightText: '#946000' },
  { hex: '#bdd2e9', label: 'Pleins Phares', ink: '#0c1521', hover: '#d3e3f4', lightText: '#3a6491' },
  { hex: '#f5f5f4', label: tx("Natif"), ink: '#151512', hover: '#ffffff', native: true, dot: 'linear-gradient(135deg, #f5f5f4 50%, #151513 50%)' },
];
// Version sombre de l’accent « Natif », affichée sur le thème clair.
const NATIVE_ON_LIGHT = { hex: '#151513', ink: '#f5f5f4', hover: '#2c2c29' };
const PANEL_WIDGETS = ['invite', 'participants', 'stats', 'activity'];

function readAppearance() {
  try { return normalizeAppearance(JSON.parse(localStorage.getItem(APPEARANCE_KEY) || 'null')); } catch { return DEFAULT_APPEARANCE; }
}
function normalizeAppearance(value) {
  try {
    const saved = value && typeof value === 'object' ? { ...value } : null;
    if (!saved) return DEFAULT_APPEARANCE;
    // Couleurs libres retirées : un ancien choix revient aux valeurs prédéfinies.
    if (saved.accent === '#151513') saved.accent = '#f5f5f4';
    if (!ACCENTS.some((item) => item.hex === saved.accent)) saved.accent = DEFAULT_APPEARANCE.accent;
    // Fond inconnu ou retiré (ancien choix) : retour au fond par défaut.
    if (saved.background !== 'cover' && !BACKGROUNDS.some((item) => item.id === saved.background)) saved.background = DEFAULT_APPEARANCE.background;
    delete saved.backgroundImage;
    // L’ancienne rangée du haut n’existe plus : ses éléments passent dans la rangée du milieu.
    const tvPlacement = Object.fromEntries(Object.entries({ ...DEFAULT_APPEARANCE.tvPlacement, ...saved.tvPlacement }).map(([id, zone]) => [id, { 'top-left': 'left', top: 'center', 'top-right': 'right' }[zone] || zone]));
    return { ...DEFAULT_APPEARANCE, ...saved, widgets: { ...DEFAULT_APPEARANCE.widgets, ...saved.widgets, nowPlaying: true, queue: true, fallback: true }, tvPlacement };
  } catch { return DEFAULT_APPEARANCE; }
}

function hexToRgb(hex) {
  const value = /^#?([\da-f]{6})$/i.exec(hex)?.[1] || 'd7f75b';
  return [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16));
}

// Couleur d’accent : toutes les nuances (survol, fond doux, texte posé dessus) en découlent, selon le thème.
function applyAccent(hex, theme) {
  const chosen = ACCENTS.find((item) => item.hex === hex) || ACCENTS[0];
  // « Natif » : noir sur le thème clair, blanc sur le thème sombre.
  const accent = chosen.native && theme === 'light' ? NATIVE_ON_LIGHT : chosen;
  const root = document.documentElement.style;
  root.setProperty('--accent-rgb', hexToRgb(accent.hex).join(', '));
  root.setProperty('--lime', accent.hex);
  root.setProperty('--lime-hover', accent.hover);
  root.setProperty('--lime-ink', accent.ink);
  root.setProperty('--lime-text', theme === 'light' ? accent.lightText || accent.hex : accent.text || accent.hex);
  // Zones toujours sombres (carte du titre en cours, mode TV) : la version de l’accent faite pour un fond sombre.
  const onDark = chosen;
  root.setProperty('--dark-accent-rgb', hexToRgb(onDark.hex).join(', '));
  root.setProperty('--dark-lime', onDark.hex);
  root.setProperty('--dark-lime-hover', onDark.hover);
  root.setProperty('--dark-lime-ink', onDark.ink);
  root.setProperty('--dark-lime-text', onDark.text || onDark.hex);
}

// Fond « Automatique » : noir ou blanc selon le thème du système, suivi en direct.
const lightQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
const subscribeSystemTheme = (callback) => { lightQuery?.addEventListener?.('change', callback); return () => lightQuery?.removeEventListener?.('change', callback); };
function useSystemLight() { return useSyncExternalStore(subscribeSystemTheme, () => Boolean(lightQuery?.matches), () => false); }
const resolveLook = (look, systemLight) => (look.background === 'auto' ? { ...look, background: systemLight ? 'white' : 'black' } : look);

// Assombrissement minimal d’une image floutée pour que tous les textes posés dessus restent lisibles :
// la zone la plus claire, une fois assombrie, ne dépasse pas BACKDROP_MAX_LUMINANCE (gris foncé).
const BACKDROP_MAX_LUMINANCE = 0.045;
const shadeCache = new Map();
const relativeLuminance = (rgb) => {
  const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
// Couleurs réellement dominantes de la pochette, pour les halos du mode TV : regroupement des pixels en
// quelques familles de couleurs (k-moyennes), puis les trois plus présentes et les plus colorées.
// Aucune teinte inventée : une pochette bleu-gris donne des halos bleu-gris, une pochette de feu des halos de feu.
function coverPalette(pixels) {
  const toHsl = ([r, g, b]) => {
    const [R, G, B] = [r / 255, g / 255, b / 255];
    const max = Math.max(R, G, B); const min = Math.min(R, G, B); const l = (max + min) / 2; const d = max - min;
    if (!d) return { h: 0, s: 0, l };
    const sat = d / (1 - Math.abs(2 * l - 1));
    const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
    return { h: (h * 60 + 360) % 360, s: sat, l };
  };
  const distance = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  // Centres de départ : le plus éloigné des précédents (en partant de la couleur moyenne).
  const mean = [0, 1, 2].map((c) => pixels.reduce((sum, px) => sum + px[c], 0) / pixels.length);
  const centers = [mean];
  while (centers.length < 5) {
    let far = pixels[0]; let best = -1;
    for (const px of pixels) { const near = Math.min(...centers.map((center) => distance(px, center))); if (near > best) { best = near; far = px; } }
    centers.push([...far]);
  }
  let groups = [];
  for (let round = 0; round < 8; round += 1) {
    groups = centers.map(() => []);
    for (const px of pixels) groups[centers.reduce((best, center, i) => (distance(px, center) < distance(px, centers[best]) ? i : best), 0)].push(px);
    groups.forEach((group, i) => { if (group.length) centers[i] = [0, 1, 2].map((c) => group.reduce((sum, px) => sum + px[c], 0) / group.length); });
  }
  const families = groups.map((group, i) => ({ share: group.length / pixels.length, rgb: centers[i], ...toHsl(centers[i]) })).filter((family) => family.share > 0);
  // Les plus présentes et les plus colorées d’abord ; deux familles trop proches comptent pour une.
  families.sort((a, b) => b.share * (0.4 + b.s) - a.share * (0.4 + a.s));
  const chosen = [];
  for (const family of families) {
    const hueGap = (other) => Math.min(Math.abs(other.h - family.h), 360 - Math.abs(other.h - family.h));
    if (chosen.every((other) => (family.s < 0.15 || other.s < 0.15 ? Math.abs(other.l - family.l) > 0.12 : hueGap(other) > 20 || Math.abs(other.l - family.l) > 0.2))) chosen.push(family);
    if (chosen.length === 3) break;
  }
  // Pochette presque unie : mêmes couleurs, plus ou moins claires (jamais une autre teinte).
  while (chosen.length < 3) chosen.push({ ...(chosen[0] || { rgb: [110, 110, 110], l: 0.43 }), l: (chosen[0]?.l ?? 0.43) * (chosen.length === 1 ? 1.15 : 0.85) });
  // Couleur d’origine, légèrement relevée en saturation comme le fond du tableau de bord ; seule la luminosité est
  // ramenée dans une plage visible (en multipliant la couleur, sans jamais en changer la teinte ni la faire virer).
  return chosen.map(({ rgb, l }) => {
    const gray = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
    const vivid = rgb.map((v) => Math.max(0, Math.min(255, gray + (v - gray) * 1.12)));
    const lightness = (Math.max(...vivid) + Math.min(...vivid)) / 510;
    const factor = lightness > 0 ? Math.min(0.58, Math.max(0.3, l)) / lightness : 1;
    return vivid.map((v) => Math.round(Math.max(0, Math.min(255, v * factor))));
  });
}
// Pochette floutée une fois pour toutes : une petite image saturée et fortement adoucie (flou en plusieurs passes,
// dégradés sans marches), que le navigateur agrandit en fond. Même rendu qu’un filtre « blur » de 70 px, sans le
// recalculer à chaque image. Avec « disc », les bords s’estompent (pour les nappes mobiles du mode TV).
function smoothBitmap(image, { size = 48, radius = 3, passes = 3, saturation = 1.5, disc = false } = {}) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, size, size);
    const frame = context.getImageData(0, 0, size, size);
    const px = frame.data;
    const count = size * size;
    let a = new Float32Array(count * 3);
    let b = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const gray = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
      for (let c = 0; c < 3; c += 1) a[i * 3 + c] = Math.max(0, Math.min(255, gray + (px[i * 4 + c] - gray) * saturation));
    }
    // Flou de boîte, séparable, plusieurs passes (≈ flou gaussien), bords prolongés.
    const width = radius * 2 + 1;
    const blurAxis = (src, dst, horizontal) => {
      for (let line = 0; line < size; line += 1) for (let c = 0; c < 3; c += 1) {
        const at = (k) => { const clamped = Math.min(size - 1, Math.max(0, k)); return (horizontal ? line * size + clamped : clamped * size + line) * 3 + c; };
        let sum = 0;
        for (let k = -radius; k <= radius; k += 1) sum += src[at(k)];
        for (let k = 0; k < size; k += 1) { dst[at(k)] = sum / width; sum += src[at(k + radius + 1)] - src[at(k - radius)]; }
      }
    };
    for (let pass = 0; pass < passes; pass += 1) { blurAxis(a, b, true); blurAxis(b, a, false); }
    const middle = (size - 1) / 2;
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      for (let c = 0; c < 3; c += 1) px[i * 4 + c] = a[i * 3 + c];
      if (disc) {
        const edge = Math.min(1, Math.hypot(x - middle, y - middle) / middle);
        const t = Math.min(1, Math.max(0, (edge - 0.3) / 0.7));
        px[i * 4 + 3] = Math.round(255 * (1 - t * t * (3 - 2 * t)));
      } else px[i * 4 + 3] = 255;
    }
    context.putImageData(frame, 0, 0);
    return canvas.toDataURL('image/png');
  } catch { return null; }
}
function measureImage(src) {
  if (!shadeCache.has(src)) {
    // Une soirée enchaîne des centaines de pochettes : seules les plus récentes restent en mémoire.
    if (shadeCache.size >= 24) shadeCache.delete(shadeCache.keys().next().value);
    shadeCache.set(src, new Promise((resolve) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        try {
          // 12 × 12 pixels : une moyenne par zone, comme le flou de l’arrière-plan.
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 12;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          context.drawImage(image, 0, 0, 12, 12);
          const data = context.getImageData(0, 0, 12, 12).data;
          const pixels = [];
          for (let i = 0; i < data.length; i += 4) pixels.push([data[i], data[i + 1], data[i + 2]]);
          // Palette : échantillon plus fin (24 × 24) pour retrouver les vraies couleurs dominantes.
          const fine = document.createElement('canvas');
          fine.width = fine.height = 24;
          const fineContext = fine.getContext('2d', { willReadFrequently: true });
          fineContext.drawImage(image, 0, 0, 24, 24);
          const fineData = fineContext.getImageData(0, 0, 24, 24).data;
          const finePixels = [];
          for (let i = 0; i < fineData.length; i += 4) finePixels.push([fineData[i], fineData[i + 1], fineData[i + 2]]);
          const palette = coverPalette(finePixels);
          pixels.sort((a, b) => relativeLuminance(a) - relativeLuminance(b));
          const bright = pixels[Math.floor(pixels.length * 0.9)];
          let keep = 1;
          while (keep > 0.05 && relativeLuminance(bright.map((v) => v * keep)) > BACKDROP_MAX_LUMINANCE) keep -= 0.01;
          // Couleur moyenne de la première et de la dernière rangée : bords haut et bas du fond.
          const row = (y) => [0, 1, 2].map((c) => Math.round(Array.from({ length: 12 }, (_, x) => data[(y * 12 + x) * 4 + c]).reduce((a, b) => a + b) / 12));
          resolve({ shade: 1 - keep, bright, mid: pixels[Math.floor(pixels.length * 0.5)], top: row(0), bottom: row(11), palette, blur: smoothBitmap(image, { size: 48, radius: 3 }), smooth: smoothBitmap(image, { size: 96, radius: 5, disc: true }) });
        } catch { resolve({ shade: 0.65 }); }
      };
      image.onerror = () => resolve({ shade: 0.65 });
      image.src = coverAt(src, 120);
    }));
  }
  return shadeCache.get(src);
}
function useImageMeasure(src) {
  const [state, setState] = useState({ src: null, value: null });
  useEffect(() => {
    if (!src) return undefined;
    let alive = true;
    measureImage(src).then((value) => { if (alive) setState({ src, value }); });
    return () => { alive = false; };
  }, [src]);
  // Jamais la mesure d’une autre pochette : le temps d’analyser la nouvelle, on n’affiche rien de périmé.
  return src && state.src === src ? state.value : null;
}

// Couleurs unies des bords haut et bas du fond affiché, d’où vient la teinte des barres du téléphone.
const SCRIM = [8, 8, 7];
const toHex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
function useBackdropEdges(look, cover) {
  const preset = BACKGROUNDS.find((item) => item.id === look.background) || BACKGROUNDS[0];
  const src = look.background === 'cover' ? cover : preset.image;
  const measure = useImageMeasure(src);
  const last = useRef(null);
  if (!src || !measure?.top) {
    // Pochette en cours d’analyse : on garde les bords précédents plutôt que d’afficher un éclair de couleur par défaut.
    if (src && look.background === 'cover' && last.current) return last.current;
    return preset.id === 'cover' || !preset.edges ? ['#0f0f0d', '#0f0f0d'] : preset.edges;
  }
  // Même assombrissement que l’arrière-plan : au moins 50 % pour une pochette, juste le complément pour l’image déjà assombrie.
  const shade = look.background === 'cover' ? Math.max(0.5, measure.shade) : Math.max(measure.shade, preset.minShade ?? 0);
  last.current = [measure.top, measure.bottom].map((rgb) => toHex(rgb.map((v, i) => v * (1 - shade) + SCRIM[i] * shade)));
  return last.current;
}
function applyEdges(edges) {
  // Safari (iPhone) remplit les zones de ses barres, en haut comme en bas, avec une seule couleur : le fond racine.
  // Les deux bords de la page se fondent donc vers la même couleur, la plus sombre des deux (léger vignettage).
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const edge = edges.reduce((a, b) => (relativeLuminance(rgb(b)) < relativeLuminance(rgb(a)) ? b : a));
  const root = document.documentElement;
  root.style.setProperty('--edge-top', edge);
  root.style.setProperty('--edge-bottom', edge);
  root.style.backgroundColor = edge;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', edge);
  // Bandes fixes en tout dernier dans la page : au-dessus du fond, sous le contenu.
  for (const side of ['top', 'bottom']) {
    let strip = document.getElementById(`sono-edge-${side}`);
    if (!strip) {
      strip = document.createElement('div');
      strip.id = `sono-edge-${side}`;
      strip.className = `edge-tint ${side}`;
      strip.setAttribute('aria-hidden', 'true');
      strip.innerHTML = '<i></i>';
    }
    if (strip !== document.body.lastElementChild) document.body.append(strip);
  }
}

function AppBackdrop({ appearance, cover }) {
  const { background } = appearance;
  const preset = BACKGROUNDS.find((item) => item.id === background);
  const measure = useImageMeasure(background === 'cover' ? cover : preset?.image);
  const shade = measure?.shade ?? 0.65;
  // Le temps d’analyser la nouvelle pochette, l’ancienne reste en place.
  const shownCover = useRef(null);
  if (background === 'cover' && cover && measure) shownCover.current = { cover, measure };
  if (background === 'default') return null;
  // Pochette en cours : au moins 50 %, davantage pour les pochettes claires (comme sur l’iPhone).
  if (background === 'cover') return <div className={shownCover.current?.cover ? 'app-backdrop blurred has-image' : 'app-backdrop'} style={{ '--shade': Math.max(0.5, shownCover.current?.measure?.shade ?? shade) }} aria-hidden="true">{shownCover.current && <FadeCover className={shownCover.current.measure.blur ? 'soft' : ''} src={shownCover.current.measure.blur || shownCover.current.cover} />}</div>;
  return <div className={preset?.image ? 'app-backdrop has-image' : 'app-backdrop'} style={{ background: preset?.css || 'var(--bg)', backgroundColor: 'var(--edge-bottom)', '--shade': preset?.image ? Math.max(shade, preset.minShade ?? 0) : 0 }} aria-hidden="true" />;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—:—';
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function trackDurationMs(track) {
  if (Number.isFinite(track.durationMs) && track.durationMs > 0) return track.durationMs;
  const match = String(track.duration || '').match(/^(\d+):([0-5]\d)$/);
  return match ? (Number(match[1]) * 60 + Number(match[2])) * 1000 : 0;
}

function queueDuration(queue) {
  const total = queue.reduce((sum, track) => sum + trackDurationMs(track), 0);
  if (!total) return '0 min';
  if (total < 60000) return '< 1 min';
  const minutes = Math.round(total / 60000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

function activityTime(item) {
  if (!item.at) return item.time || '';
  const date = new Date(item.at);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return tx("À l’instant");
  if (minutes < 60) return tx("Il y a {0} min", minutes);
  return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

function sinceLabel(at) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return tx("à l’instant");
  if (minutes < 60) return tx('depuis {0} min', minutes);
  return tx('depuis {0}', date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }));
}

function readStorage(key, fallback = '') {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

function writeStorage(key, value) {
  try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* stockage indisponible */ }
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'x-sono-client': clientId(), ...options.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(txServer(data.error) || tx("Le serveur Sono est momentanément indisponible."));
    error.status = response.status;
    throw error;
  }
  return data;
}

async function getAppleMusic() {
  if (!window.MusicKit) {
    if (!window.sonoMusicKitLoading) window.sonoMusicKitLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js';
      script.onload = resolve;
      script.onerror = () => {
        window.sonoMusicKitLoading = null;
        reject(new Error(tx("Impossible de charger MusicKit JS.")));
      };
      document.head.appendChild(script);
    });
    await window.sonoMusicKitLoading;
  }
  if (window.sonoAppleMusic) return window.sonoAppleMusic;
  if (!window.sonoAppleMusicConfiguring) window.sonoAppleMusicConfiguring = (async () => {
    const { developerToken } = await apiRequest('/api/integrations/apple/developer-token');
    if (!developerToken) throw new Error(tx("Apple Music n’a pas fourni son jeton public."));
    const music = await window.MusicKit.configure({ developerToken, app: { name: 'Sono', build: '1.0.0' } });
    window.sonoAppleMusic = music;
    return music;
  })();
  try { return await window.sonoAppleMusicConfiguring; }
  finally { window.sonoAppleMusicConfiguring = null; }
}

// Apps de lecture pilotées par le serveur (qui garde leur connexion) : même modèle d’état, mêmes commandes.
const ENGINES = { Deezer: '/api/integrations/opendeezer' };
const engineBase = (source) => ENGINES[source] || null;

async function searchProvider(source, query) {
  if (source === 'Deezer') {
    const data = await apiRequest(`/api/integrations/opendeezer/search?q=${encodeURIComponent(query)}`);
    const items = data.data || data.results || data.tracks || [];
    return items.map((track) => ({ id: String(track.id), providerId: String(track.id), title: track.title, artist: track.artist?.name || track.artist || tx("Artiste inconnu"), album: track.album?.title || track.album || '', durationMs: track.duration ? track.duration * 1000 : 0, duration: track.duration ? formatDuration(track.duration * 1000) : '—:—', cover: track.album?.cover_xl || track.album?.cover || track.cover || '', source: 'Deezer' }));
  }
  const data = await apiRequest(`/api/integrations/apple/search?q=${encodeURIComponent(query)}`);
  return data.tracks.map((track) => ({ ...track, id: track.providerId, durationMs: track.duration, duration: formatDuration(track.duration), source: 'Apple Music' }));
}

// Un titre trouvé sur une autre plateforme est recherché sur l’app de lecture de la session.
async function playableTrack(track, source) {
  if (track.source === source && track.providerId) return track;
  const results = await searchProvider(source, `${track.title} ${track.artist}`);
  const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  const match = results.find((item) => same(item.title, track.title) && same(item.artist, track.artist)) || results.find((item) => same(item.title, track.title)) || results[0];
  if (!match?.providerId) throw new Error(tx("« {0} » est introuvable sur {1}.", track.title, source));
  return match;
}

// Dernière position de lecture connue, gardée sur l’appareil : après une relance de Sono,
// le titre resté dans le lecteur repart de là où il s’était arrêté.
const POSITION_KEY = 'sono-position';
const savePosition = (trackId, positionMs) => writeStorage(POSITION_KEY, JSON.stringify({ id: trackId, positionMs: Math.round(positionMs) }));
const savedPosition = (trackId) => {
  try { const saved = JSON.parse(readStorage(POSITION_KEY) || 'null'); return saved?.id === trackId ? saved.positionMs : 0; } catch { return 0; }
};

async function controlProvider({ track, action, playing, source, hostToken, sessionCode }) {
  if (!source) throw new Error(tx("Connectez Apple Music ou Deezer dans Connexions pour lancer la musique."));
  if (!track) throw new Error(tx("Aucun titre n’est sélectionné."));
  // « resume » : relancer le titre en cours, même si l’app de lecture l’a oublié (Sono relancé).
  const resume = action === 'resume' || (action === 'toggle' && !playing);
  if (source === 'Apple Music') {
    const music = await getAppleMusic();
    if (!music.isAuthorized) throw new Error(tx("Apple Music n’est plus connecté sur cet appareil. Reconnectez-le dans Connexions."));
    if (action === 'next') { await music.setQueue({ song: (await playableTrack(track, source)).providerId }); await music.play(); }
    else if (!resume) await music.pause();
    else {
      const id = (await playableTrack(track, source)).providerId;
      if (String(music.nowPlayingItem?.id || '') !== String(id)) {
        await music.setQueue({ song: id });
        await music.play();
        const at = savedPosition(track.id);
        if (at > 3000) await music.seekToTime(at / 1000);
      } else await music.play();
    }
    return;
  }
  const headers = { 'x-host-token': hostToken };
  const base = engineBase(source);
  const engine = (path, body) => apiRequest(`${base}/${path}`, { method: 'POST', headers, body: JSON.stringify({ code: sessionCode, ...body }) });
  if (action === 'next') { await engine('play', { id: (await playableTrack(track, source)).providerId }); return; }
  if (!resume) { await engine('transport', { action: 'pause' }); return; }
  // Reprise : si le moteur a encore le titre, il repart simplement ; sinon on le relance à la dernière position connue.
  const id = String((await playableTrack(track, source)).providerId);
  const { resumed, status } = await engine('transport', { action: 'resume', id });
  if (resumed) return;
  await engine('play', { id });
  // Titre terminé (le moteur le connaît encore, à l’arrêt) : on le relance depuis le début.
  // La dernière position n’est reprise que si Sono a été relancé en cours de titre.
  const ended = String(status?.track?.id || '') === id;
  const at = savedPosition(track.id);
  const total = track.durationMs || status?.durationMs || 0;
  if (!ended && at > 3000 && (!total || at < total - 8000)) await engine('seek', { ms: at });
}

function Brand() {
  return <div className="brand"><span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span><span className="brand-name">sono<span className="brand-dot" /></span></div>;
}

const PROVIDER_LOGOS = { 'Apple Music': appleMusicLogo, Deezer: deezerIcon };

function ProviderLogo({ provider, size = 20 }) {
  const src = PROVIDER_LOGOS[provider];
  return src ? <img className={`provider-logo ${provider === 'Deezer' ? 'deezer' : 'apple-music'}`} src={src} width={size} height={size} alt="" aria-hidden="true" /> : null;
}

function clientId() {
  let id = readStorage('sono-client-id');
  if (!id) {
    id = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    writeStorage('sono-client-id', id);
  }
  return id;
}

function IconButton({ label, children, className = '', ...props }) {
  return <button type="button" className={`icon-button ${className}`} aria-label={label} title={label} {...props}>{children}</button>;
}

function Avatar({ name, className = '' }) {
  const label = String(name || '?').trim() || '?';
  let hue = 0;
  for (const char of label) hue = (hue * 31 + char.charCodeAt(0)) % 360;
  return <i className={`avatar ${className}`} style={{ '--hue': hue }} aria-hidden="true">{label.charAt(0).toUpperCase()}</i>;
}

function FadeCover({ src, className = '', onError }) {
  const [layers, setLayers] = useState(() => [{ src, id: 0 }]);
  const nextId = useRef(1);
  useEffect(() => {
    if (layers.at(-1)?.src === src) return undefined;
    let live = true;
    const image = new Image();
    image.src = src;
    const show = () => { if (live) setLayers((list) => [...list.slice(-1), { src, id: nextId.current++ }]); };
    (image.decode ? image.decode() : Promise.resolve()).then(show, show);
    return () => { live = false; };
  }, [src]);
  return <span className={`fade-cover ${className}`}>{layers.map((layer) => <img key={layer.id} src={layer.src} alt="" decoding="async" onError={onError}
    onAnimationEnd={() => setLayers((list) => list.filter((item) => item.id >= layer.id))} />)}</span>;
}

function TrackCover({ track, className = 'track-cover', iconSize = 18, size = 120, fade = false }) {
  // Une image qui échoue (réseau mobile, taille indisponible) est retentée : l’adresse d’origine, puis encore une fois un peu plus tard.
  const [attempt, setAttempt] = useState({ cover: track?.cover, count: 0 });
  const count = attempt.cover === track?.cover ? attempt.count : 0;
  const retry = useRef(0);
  useEffect(() => () => window.clearTimeout(retry.current), []);
  if (!track?.cover || count > 2) return <span className={`${className} cover-empty`} aria-hidden="true"><Music2 size={iconSize} /></span>;
  const onError = () => {
    const cover = track.cover;
    window.clearTimeout(retry.current);
    retry.current = window.setTimeout(() => setAttempt({ cover, count: count + 1 }), count ? 2500 : 300);
  };
  const src = count === 0 ? coverAt(track.cover, size) : count === 1 ? coverAt(track.cover, 600) : `${coverAt(track.cover, 600)}${track.cover.includes('?') ? '&' : '?'}essai=2`;
  if (fade) return <FadeCover className={className} src={src} onError={onError} />;
  return <img key={src} className={className} src={src} alt="" decoding="async" onError={onError} />;
}

function Equalizer({ playing }) {
  return <span className={playing ? 'equalizer' : 'equalizer paused'} aria-hidden="true"><i /><i /><i /></span>;
}

// App de bureau : quand la fenêtre est cachée ou réduite, les animations et le fond du mode TV se mettent en pause
// (la page continue de tourner pour la musique et les invités, mais ne dessine plus rien).
if (typeof window !== 'undefined' && window.sonoDesktop) document.documentElement.setAttribute('data-desktop', '');
if (typeof window !== 'undefined') window.sonoDesktop?.onVisibility?.((visible) => document.documentElement.toggleAttribute('data-window-hidden', !visible));

// Au doigt, le navigateur peut attendre avant de valider un appui (il guette un double appui).
// Les boutons réagissent donc dès que le doigt se lève, sauf si le doigt a glissé ou si la page défilait encore.
if (typeof document !== 'undefined') {
  let touch = null;
  let lastScroll = 0;
  window.addEventListener('scroll', () => { lastScroll = performance.now(); }, { passive: true, capture: true });
  document.addEventListener('touchstart', (event) => {
    const point = event.touches[0];
    touch = event.touches.length === 1 && performance.now() - lastScroll > 120 ? { x: point.clientX, y: point.clientY, at: performance.now() } : null;
  }, { passive: true, capture: true });
  document.addEventListener('touchend', (event) => {
    const start = touch;
    touch = null;
    const button = event.target.closest?.('button');
    if (!start || !button || button.disabled) return;
    const point = event.changedTouches[0];
    if (Math.hypot(point.clientX - start.x, point.clientY - start.y) > 10 || performance.now() - start.at > 500) return;
    event.preventDefault();
    button.click();
  }, { passive: false, capture: true });
}

// Prénom déjà saisi dans l’app avant de rejoindre une session hébergée ailleurs : passé dans le fragment de l’adresse, jamais envoyé au serveur.
if (typeof window !== 'undefined' && window.location.hash.startsWith('#prenom=')) {
  writeStorage('sono-guest-name', decodeURIComponent(window.location.hash.slice(8)).slice(0, 30));
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}

function App() {
  const params = new URLSearchParams(window.location.search);
  // Lien court « adresse/1234 » ; l’ancien « ?invitation=SONO-1234 » reste accepté.
  const shortInvite = window.location.pathname.match(/^\/(\d{4})\/?$/)?.[1];
  const invitedCode = params.get('invitation')?.toUpperCase() || (shortInvite ? `SONO-${shortInvite}` : undefined);
  const isGuest = Boolean(invitedCode);
  const isJoinPage = !isGuest && window.location.pathname.replace(/\/+$/, '') === '/rejoindre';
  const [hostState, setHostState] = useState(() => isGuest ? 'guest' : !isJoinPage && readStorage('sono-host-code') ? 'checking' : 'home');
  // Admin : clé personnelle reçue du serveur, pour les commandes depuis sa page d’invité.
  const [adminInfo, setAdminInfo] = useState(null);
  const [adminLoaded, setAdminLoaded] = useState(false);
  const [queue, setQueue] = useState([]);
  const [session, setSession] = useState(() => ({ ...defaultSession, code: invitedCode || readStorage('sono-host-code') || defaultSession.code }));
  const [current, setCurrent] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [ownerToken, setHostToken] = useState(() => readStorage(`sono-host-${session.code}`));
  // Un admin commande avec sa clé personnelle, sans quitter sa page d’invité.
  const adminControl = isGuest && Boolean(adminInfo?.key);
  const hostToken = ownerToken || (adminControl ? adminInfo.key : '');
  const [guestName, setGuestName] = useState(() => readStorage('sono-guest-name'));
  const [lockedName, setLockedName] = useState('');
  const myName = lockedName || guestName;
  const guestReady = !isGuest || Boolean(myName);
  const [networkUrl, setNetworkUrl] = useState('');
  const [publicUrl, setPublicUrl] = useState(() => window.location.hostname.endsWith('.trycloudflare.com') ? window.location.origin : '');
  const [publicBusy, setPublicBusy] = useState(false);
  const [live, setLive] = useState(false);
  const [view, setView] = useState('queue');
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [activity, setActivity] = useState([]);
  const [fallbackQueue, setFallbackQueue] = useState(null);
  const [previous, setPrevious] = useState(null);
  const [admission, setAdmission] = useState(null);
  const [ended, setEnded] = useState(false);
  const knownRequests = useRef(null);
  const knownParticipants = useRef(null);
  const [joinNotices, setJoinNotices] = useState([]);
  const [appearance, setAppearance] = useState(readAppearance);
  const resumeHostingRef = useRef(() => {});
  const updateAppearance = useCallback((patch) => setAppearance((previous) => ({ ...previous, ...patch, widgets: { ...previous.widgets, ...patch.widgets }, tvPlacement: { ...previous.tvPlacement, ...patch.tvPlacement } })), []);
  const widgets = appearance.widgets;
  const playbackBusyRef = useRef(false);
  const dropUnavailableRef = useRef(() => {});
  const playbackRef = useRef(() => {});
  const preloadedRef = useRef(null);
  const historyRef = useRef([]);
  const skipState = useRef({ delta: 0, timer: 0, active: false, sending: false, toggle: false, watchUntil: 0, crossfadeTo: null });
  // Mode TV ouvert par-dessus le tableau de bord : origin est l’élément d’où il s’agrandit (lecteur ou aperçu des réglages).
  const [tv, setTv] = useState(null);
  // Position dans le titre en cours (lue sur l’app de lecture), pour la barre de progression.
  const [progress] = useState(createProgressStore);
  const setProgress = progress.set;
  const autoAdvanceRef = useRef(() => {});
  const toastTimer = useRef();
  const socketRef = useRef(null);
  const helloRef = useRef({});
  helloRef.current = { type: 'hello', clientId: clientId(), name: isGuest ? myName.trim() : '', hostToken: isGuest ? undefined : hostToken };

  const notify = useCallback((message, type = 'success') => {
    setToast({ message, type, id: Date.now() });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), type === 'error' ? 5500 : 3500);
  }, []);
  const closeToast = useCallback(() => setToast(null), []);
  const applyPayload = useCallback((data) => {
    // Une diffusion qui ne change rien ne redessine rien : les listes gardent le même objet.
    if (data.session) setSession((value) => { const next = keepSame(value, data.session); return next === value || !next.fallback ? next : { ...next, fallback: keepSame(value.fallback, next.fallback) }; });
    if (Array.isArray(data.queue)) setQueue((value) => keepSame(value, data.queue));
    if (Object.hasOwn(data, 'current')) setCurrent((value) => keepSame(value, data.current));
    if (typeof data.playing === 'boolean') setPlaying(data.playing);
    if (Array.isArray(data.activity)) setActivity((value) => keepSame(value, data.activity));
    if (Object.hasOwn(data, 'fallbackQueue')) setFallbackQueue((value) => keepSame(value, data.fallbackQueue));
    if (Object.hasOwn(data, 'previous')) setPrevious(data.previous);
    if (Array.isArray(data.history)) historyRef.current = data.history;
    if (data.admission) setAdmission(data.admission);
    if (data.you) setLockedName(data.you);
    if (Object.hasOwn(data, 'you')) { setAdminInfo(data.admin || null); setAdminLoaded(true); }
    if (data.hostToken) {
      setHostToken(data.hostToken);
      writeStorage(`sono-host-${data.session.code}`, data.hostToken);
      writeStorage('sono-host-code', data.session.code);
    }
  }, []);

  // Pendant un changement affiché d’avance, une diffusion plus ancienne ramènerait l’écran en arrière :
  // on la garde de côté, puis on applique la dernière une fois le serveur stabilisé.
  const pendingChanges = useRef(0);
  const holding = useRef(false);
  const heldPayload = useRef(null);
  const releaseTimer = useRef(0);
  const beginChange = () => { pendingChanges.current += 1; holding.current = true; window.clearTimeout(releaseTimer.current); };
  const endChange = () => {
    pendingChanges.current -= 1;
    if (pendingChanges.current) return;
    releaseTimer.current = window.setTimeout(() => {
      holding.current = false;
      if (heldPayload.current) applyPayload(heldPayload.current);
      heldPayload.current = null;
    }, 500);
  };
  const applyBroadcast = useCallback((data) => {
    if (!holding.current) { applyPayload(data); return; }
    const { queue: heldQueue, current: heldCurrent, previous: heldPrevious, history: heldHistory, playing: heldPlaying, fallbackQueue: heldFallback, ...rest } = data;
    heldPayload.current = { ...heldPayload.current, ...Object.fromEntries(Object.entries({ queue: heldQueue, current: heldCurrent, previous: heldPrevious, history: heldHistory, playing: heldPlaying, fallbackQueue: heldFallback, session: data.session }).filter(([key]) => Object.hasOwn(data, key))) };
    // Le reste de la session suit, sauf le prochain titre de fond déjà avancé à l’écran.
    if (rest.session) { const incoming = rest.session; delete rest.session; setSession((value) => ({ ...incoming, fallback: incoming.fallback && value.fallback ? { ...incoming.fallback, next: value.fallback.next } : incoming.fallback })); }
    applyPayload(rest);
  }, [applyPayload]);

  // La session a été supprimée : l’invité voit un écran de fin, l’hôte revient à l’accueil.
  const sessionGone = useCallback(() => {
    if (isGuest) { setEnded(true); return; }
    writeStorage(`sono-host-${session.code}`, null);
    writeStorage('sono-host-code', null);
    if (readStorage('sono-last-host-code') === session.code) writeStorage('sono-last-host-code', null);
    setModal(null);
    setHostState('home');
    notify(tx("Cette session a été supprimée."));
  }, [isGuest, session.code, notify]);

  // Cet appareil a-t-il déjà une session dont il est l’hôte ? Sinon, on affiche l’accueil Créer / Rejoindre.
  useEffect(() => {
    if (hostState !== 'checking') return undefined;
    let cancelled = false;
    const token = readStorage(`sono-host-${session.code}`);
    const request = token
      ? apiRequest('/api/host/resume', { method: 'POST', headers: { 'x-host-token': token }, body: JSON.stringify({ code: session.code }) })
      : apiRequest('/api/host/bootstrap', { method: 'POST', body: JSON.stringify({ code: session.code }) });
    request.then((data) => {
      if (cancelled) return;
      if (token) setHostToken(token);
      applyPayload(data);
      setHostState('host');
    }).catch((error) => {
      if (cancelled) return;
      if ([403, 404].includes(error.status)) writeStorage('sono-host-code', null);
      setHostState('home');
    });
    return () => { cancelled = true; };
  }, [hostState, session.code, applyPayload]);

  useEffect(() => {
    if (hostState !== 'host' && hostState !== 'guest') return undefined;
    let closed = false;
    let socket;
    let reconnect;
    const connect = async () => {
      try {
        const data = isGuest
          ? await apiRequest(`/api/sessions/${session.code}`)
          : await apiRequest('/api/host/resume', { method: 'POST', headers: { 'x-host-token': readStorage(`sono-host-${session.code}`) }, body: JSON.stringify({ code: session.code }) });
        if (!closed) applyPayload(data);
      } catch (error) {
        if (closed) return;
        if (error.status === 404) { closed = true; sessionGone(); return; }
        notify(error.message, 'error');
      }
      // Un invité ne rejoint vraiment la session qu’après avoir donné son prénom.
      if (closed || !guestReady) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${window.location.host}/ws?session=${session.code}`);
      socketRef.current = socket;
      socket.onopen = () => {
        setLive(true);
        socket.send(JSON.stringify(helloRef.current));
      };
      socket.onmessage = (event) => applyBroadcast(JSON.parse(event.data));
      socket.onclose = (event) => {
        setLive(false);
        if (event.code === 4001) { closed = true; notify(tx("L’hôte a désactivé l’accès à distance."), 'error'); return; }
        if (event.code === 4004) { closed = true; sessionGone(); return; }
        if (!closed) reconnect = window.setTimeout(connect, 2500);
      };
    };
    connect();
    fetch('/api/config').then((response) => response.json()).then((config) => { setNetworkUrl(config.networkUrl || ''); setPublicUrl(config.publicUrl || ''); }).catch(() => {});
    return () => { closed = true; window.clearTimeout(reconnect); socket?.close(); };
  }, [session.code, isGuest, hostState, guestReady, applyPayload, notify, sessionGone]);

  // Détecte la fin du titre en cours sur l’app de lecture pour enchaîner automatiquement.
  const currentId = current?.id;
  // L’hôte pilote la lecture. S’il est absent, c’est la page d’un admin connecté (toujours le même) qui enchaîne les titres.
  const drivingAdmin = (session.participants || []).filter((person) => person.admin && person.online).map((person) => person.id).sort()[0];
  const adminDriving = adminControl && Boolean(engineBase(session.source)) && session.hostOnline === false && drivingAdmin === adminInfo.id;
  const watchEnd = (hostState === 'host' || adminDriving) && playing && Boolean(currentId);
  useEffect(() => {
    if (!watchEnd || !engineBase(session.source)) return undefined;
    let seenPlaying = false;
    let timer = 0;
    let stopped = false;
    const poll = async () => {
      let delay = 1000;
      const skip = skipState.current;
      try {
        const data = await apiRequest(`${engineBase(session.source)}/status?code=${session.code}`, { headers: { 'x-host-token': hostToken } });
        if (stopped) return;
        const state = String(data.status?.state || '').toLowerCase();
        const engineTrack = String(data.status?.track?.id || '');
        // Pendant un enchaînement ou un fondu, le moteur joue encore l’ancien titre : sa position ne concerne pas ce qui est affiché.
        const stale = skip.active || (engineTrack && current?.source === session.source && String(current.providerId) !== engineTrack);
        if (!stale && Number.isFinite(data.status?.positionMs)) {
          setProgress({ positionMs: data.status.positionMs, durationMs: data.status.durationMs || 0, at: Date.now(), running: !['loading', 'stopped'].includes(state) });
          if (engineTrack && state === 'playing') savePosition(currentId, data.status.positionMs);
        }
        if (skip.crossfadeTo && engineTrack === skip.crossfadeTo) { skip.crossfadeTo = null; seenPlaying = true; setCrossfadeEnded((value) => value + 1); }
        else if (skip.crossfadeTo && Date.now() > skip.crossfadeDeadline) {
          // Le moteur n’a pas enchaîné : on lui demande directement le titre affiché.
          skip.crossfadeTo = null;
          setCrossfadeEnded((value) => value + 1);
          controlProvider({ track: current, action: 'next', playing: true, source: session.source, hostToken, sessionCode: session.code }).catch(() => {});
        }
        else if (!skip.active && preloadedRef.current && engineTrack === preloadedRef.current) {
          // Enchaînement sans blanc : le moteur joue déjà le titre préchargé.
          const switchedTo = preloadedRef.current;
          preloadedRef.current = null;
          autoAdvanceRef.current(currentId, switchedTo);
        } else if (state === 'playing') seenPlaying = true;
        else if (seenPlaying && !skip.active && (state === 'stopped' || state === 'error')) { seenPlaying = false; autoAdvanceRef.current(currentId); }
        // Le fondu dure 3 s. À 2 s de la fin, le nouveau titre domine : l’affichage change sans attendre la fin du moteur.
        const remaining = (data.status?.durationMs || 0) - (data.status?.positionMs || 0);
        if (!stale && !skip.crossfadeTo && state === 'playing' && data.status?.durationMs > 0 && preloadedRef.current && String(data.status.preloaded || '') === preloadedRef.current) {
          if (remaining <= 2000) advanceRef.current(Math.max(0, 3000 - remaining), preloadedRef.current);
          else if (remaining < 3200) delay = remaining - 2000;
        }
      } catch {}
      if (stopped) return;
      timer = window.setTimeout(poll, Date.now() < skip.watchUntil ? Math.min(delay, 200) : delay);
    };
    poll();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [watchEnd, session.source, session.code, hostToken, currentId]);
  // Une position donnée à l’instant pour ce titre (changement affiché d’avance) reste valable.
  const currentKey = trackKey(current);
  useEffect(() => { setProgress((value) => (Date.now() - value.at < 300 ? value : { positionMs: 0, durationMs: 0, at: Date.now() })); }, [currentKey]);
  useEffect(() => {
    if (hostState !== 'host' || session.source !== 'Apple Music' || !currentId) return undefined;
    const timer = window.setInterval(() => {
      const music = window.sonoAppleMusic;
      if (music && Number.isFinite(music.currentPlaybackTime)) {
        setProgress({ positionMs: music.currentPlaybackTime * 1000, durationMs: (music.currentPlaybackDuration || 0) * 1000, at: Date.now() });
        if (music.currentPlaybackTime > 0) savePosition(currentId, music.currentPlaybackTime * 1000);
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [hostState, session.source, currentId]);
  // Apple Music ne joue qu’un titre à la fois : fondu de sortie sur les 3 dernières secondes, fondu d’entrée au suivant.
  useEffect(() => {
    if (hostState !== 'host' || session.source !== 'Apple Music' || !currentId) return undefined;
    const started = Date.now();
    const timer = window.setInterval(() => {
      const music = window.sonoAppleMusic;
      if (!music || !Number.isFinite(music.currentPlaybackTime)) return;
      const duration = music.currentPlaybackDuration || 0;
      const fadeOut = duration > 6 ? Math.min(1, Math.max(0, (duration - music.currentPlaybackTime) / 3)) : 1;
      music.volume = Math.min(fadeOut, Math.min(1, (Date.now() - started) / 1500));
    }, 200);
    return () => { window.clearInterval(timer); if (window.sonoAppleMusic) window.sonoAppleMusic.volume = 1; };
  }, [hostState, session.source, currentId]);
  const seekTo = async (ms) => {
    setProgress((state) => ({ ...state, positionMs: ms, at: Date.now() }));
    try {
      if (session.source === 'Apple Music') await (await getAppleMusic()).seekToTime(ms / 1000);
      else {
        const base = engineBase(session.source);
        // Titre terminé : un clic sur la barre le relance (la session repasse en lecture), puis va à l’endroit choisi.
        if (!playing && current) {
          const data = await apiRequest(`${base}/status?code=${encodeURIComponent(session.code)}`, { headers: { 'x-host-token': hostToken } }).catch(() => null);
          if (String(data?.status?.state || '').toLowerCase() === 'stopped') await playbackRef.current('toggle');
        }
        await apiRequest(`${base}/seek`, { method: 'POST', headers: { 'x-host-token': hostToken }, body: JSON.stringify({ code: session.code, ms }) });
      }
    } catch (error) { notify(error.message, 'error'); }
  };

  // Prochain titre : la file d’abord, puis la musique de fond.
  const nextUp = queue[0] || session.fallback?.next || null;
  // Dès qu’un titre joue sur Deezer, le suivant est préchargé ; il est remplacé si la file change.
  const [crossfadeEnded, setCrossfadeEnded] = useState(0);
  const nextKey = nextUp ? `${nextUp.id}:${nextUp.providerId}` : '';
  useEffect(() => {
    // Pendant un fondu, le moteur a encore besoin de son titre préchargé : le remplacer ferait sauter un titre.
    if (!watchEnd || session.source !== 'Deezer' || !nextUp || skipState.current.crossfadeTo) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const track = await playableTrack(nextUp, 'Deezer');
        if (cancelled || preloadedRef.current === String(track.providerId)) return;
        await apiRequest('/api/integrations/opendeezer/preload', { method: 'POST', headers: { 'x-host-token': hostToken }, body: JSON.stringify({ code: session.code, id: track.providerId }) });
        if (!cancelled) preloadedRef.current = String(track.providerId);
      } catch (error) {
        if (!cancelled && error.status === 409) dropUnavailableRef.current(nextUp);
      }
    }, 800);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [watchEnd, session.source, session.code, hostToken, currentId, nextKey, crossfadeEnded]);
  useEffect(() => {
    if (!watchEnd || session.source !== 'Apple Music') return undefined;
    let music;
    const states = window.MusicKit?.PlaybackStates || {};
    const onState = (event) => {
      if ([states.ended ?? 5, states.completed ?? 10].includes(event?.state)) autoAdvanceRef.current(currentId);
    };
    getAppleMusic().then((instance) => { music = instance; music.addEventListener?.('playbackStateDidChange', onState); }).catch(() => {});
    return () => music?.removeEventListener?.('playbackStateDidChange', onState);
  }, [watchEnd, session.source, currentId]);

  useEffect(() => {
    const requests = session.requests || [];
    const ids = new Set(requests.map((item) => item.id));
    if (knownRequests.current) {
      const fresh = requests.filter((item) => !knownRequests.current.has(item.id));
      if (fresh.length === 1) notify(tx("{0} demande à rejoindre la session.", fresh[0].name));
      else if (fresh.length > 1) notify(tx("{0} personnes demandent à rejoindre la session.", fresh.length));
    }
    knownRequests.current = ids;
  }, [session.requests, notify]);

  // Les invités voient les couleurs choisies par l’hôte ; l’hôte, les siennes.
  const guestTheme = isGuest ? { ...DEFAULT_APPEARANCE, ...session.theme } : null;
  // Les invités affichent Sono dans la langue choisie par l’hôte.
  useEffect(() => { if (isGuest) setLang(session.theme?.lang); }, [isGuest, session.theme?.lang]);
  // Session terminée : retour au design personnel.
  const systemLight = useSystemLight();
  const look = resolveLook((!ended && guestTheme) || appearance, systemLight);
  // Fond « pochette en cours » : la dernière pochette reste en mémoire, pour garder le même décor hors session.
  useEffect(() => { if (!isGuest && current?.cover) writeStorage('sono-last-cover', current.cover); }, [current?.cover, isGuest]);
  const backdropCover = current?.cover || (isGuest ? undefined : readStorage('sono-last-cover') || undefined);
  const edges = useBackdropEdges(look, backdropCover);
  useEffect(() => applyEdges(edges), [edges[0], edges[1]]);
  useEffect(() => {
    const theme = look.background === 'white' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    applyAccent(look.accent, theme);
    document.documentElement.toggleAttribute('data-glass', look.glass);
    document.documentElement.toggleAttribute('data-custom-bg', look.background !== 'default');
  }, [look.accent, look.glass, look.background]);
  useEffect(() => {
    if (isGuest) return;
    try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance)); } catch {}
  }, [appearance, isGuest]);
  // Préférences de l’ordinateur hôte gardées par le serveur : le style et la session animée survivent
  // à un changement d’adresse de la page (l’app de bureau peut changer de port d’un lancement à l’autre).
  const hostPrefsLoaded = useRef(false);
  useEffect(() => {
    if (isGuest) return;
    apiRequest('/api/local/host').then((prefs) => {
      if (prefs.appearance) setAppearance(normalizeAppearance(prefs.appearance));
      if (prefs.lang) setLang(prefs.lang);
      const { code, hostToken: token } = prefs.session || {};
      if (code && !readStorage('sono-host-code') && !isJoinPage) {
        writeStorage(`sono-host-${code}`, token);
        resumeHostingRef.current(code);
      }
    }).catch(() => {}).finally(() => { hostPrefsLoaded.current = true; });
  }, []);
  const appearanceJson = JSON.stringify(appearance);
  useEffect(() => {
    if (isGuest || !hostPrefsLoaded.current) return undefined;
    const timer = window.setTimeout(() => apiRequest('/api/local/host', { method: 'PUT', body: JSON.stringify({ appearance: JSON.parse(appearanceJson) }) }).catch(() => {}), 400);
    return () => window.clearTimeout(timer);
  }, [appearanceJson, isGuest]);
  // L’hôte envoie ses couleurs à la session dès qu’elles changent.
  const sharedTheme = JSON.stringify({ background: appearance.background, accent: appearance.accent, glass: appearance.glass, lang });
  useEffect(() => {
    if (isGuest || hostState !== 'host' || !hostToken || sharedTheme === JSON.stringify(session.theme)) return undefined;
    const timer = window.setTimeout(() => {
      apiRequest(`/api/sessions/${session.code}`, { method: 'PATCH', headers: { 'x-host-token': hostToken }, body: JSON.stringify({ theme: JSON.parse(sharedTheme) }) }).catch(() => {});
    }, 300);
    return () => window.clearTimeout(timer);
  }, [sharedTheme, session.theme, session.code, hostState, hostToken, isGuest]);

  // Sans validation, l’hôte est prévenu dès qu’un nouvel invité arrive.
  useEffect(() => {
    if (isGuest || !session.participants) return;
    const guests = session.participants.filter((person) => person.role !== 'host');
    const known = knownParticipants.current;
    if (known?.code === session.code && !session.requireApproval) {
      const fresh = guests.filter((person) => !known.ids.has(person.id));
      if (fresh.length) setJoinNotices((list) => [...list.filter((item) => !fresh.some((person) => person.id === item.id)), ...fresh.map((person) => ({ id: person.id, name: person.name, at: Date.now() }))]);
    }
    knownParticipants.current = { code: session.code, ids: new Set(guests.map((person) => person.id)) };
  }, [session.participants, session.code, session.requireApproval, isGuest]);
  // Le bandeau d’arrivée disparaît seul après quelques secondes.
  useEffect(() => {
    if (!joinNotices.length) return undefined;
    const timer = window.setInterval(() => setJoinNotices((list) => (list.some((item) => Date.now() - item.at >= 15000) ? list.filter((item) => Date.now() - item.at < 15000) : list)), 1000);
    return () => window.clearInterval(timer);
  }, [joinNotices.length]);
  const dismissJoinNotice = useCallback((id) => setJoinNotices((list) => list.filter((item) => item.id !== id)), []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(helloRef.current));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [myName, hostToken]);

  useEffect(() => {
    if (hostState === 'home' || hostState === 'checking') { document.title = tx("Sono — La musique se partage"); return; }
    const base = `${session.name} — Sono`;
    document.title = current && playing ? `♪ ${current.title} · ${base}` : base;
  }, [current, playing, session.name, hostState]);

  const localHosts = ['localhost', '127.0.0.1', '0.0.0.0'];
  const inviteBase = publicUrl || (localHosts.includes(window.location.hostname) && networkUrl ? networkUrl : window.location.origin);
  const inviteUrl = `${inviteBase}/${session.code.replace(/^SONO-/, '')}`;
  const joinUrl = `${inviteBase}/rejoindre`;
  const hostHeaders = useMemo(() => ({ 'x-host-token': hostToken }), [hostToken]);
  // Prépare le tunnel en arrière-plan pour que « Activer l’accès à distance » soit instantané.
  const canManagePublicLink = hostState === 'host' && Boolean(hostToken) && !window.location.hostname.endsWith('.trycloudflare.com');
  useEffect(() => {
    if (!canManagePublicLink || publicUrl) return;
    // Préparé dès que le tableau de bord de l’hôte est ouvert (Cloudflare met ~5 s à créer un lien) : le passage à « Internet » est instantané.
    apiRequest('/api/public-link/prepare', { method: 'POST', headers: { 'x-host-token': hostToken }, body: JSON.stringify({ code: session.code }) }).catch(() => {});
  }, [canManagePublicLink, publicUrl, hostToken, session.code]);
  const enablePublicAccess = async () => {
    setPublicBusy(true);
    try {
      const data = await apiRequest('/api/public-link', { method: 'POST', headers: hostHeaders, body: JSON.stringify({ code: session.code }) });
      setPublicUrl(data.publicUrl);
      notify(tx("Le lien public est actif."));
    } catch (error) { notify(error.message, 'error'); }
    finally { setPublicBusy(false); }
  };
  const disablePublicAccess = async () => {
    setPublicBusy(true);
    try {
      await apiRequest('/api/public-link', { method: 'DELETE', headers: hostHeaders, body: JSON.stringify({ code: session.code }) });
      setPublicUrl('');
      notify(tx("Le lien public a été désactivé."));
    } catch (error) { notify(error.message, 'error'); }
    finally { setPublicBusy(false); }
  };

  const addTrack = useCallback(async (track) => {
    try {
      const addedBy = isGuest ? myName : session.host;
      const data = await apiRequest(`/api/sessions/${session.code}/tracks`, { method: 'POST', headers: isGuest ? {} : { 'x-host-token': hostToken }, body: JSON.stringify({ track, addedBy }) });
      applyPayload(data);
      notify(tx("« {0} » a rejoint la file.", track.title));
      return true;
    } catch (error) { notify(error.message, 'error'); return false; }
  }, [session.code, session.host, isGuest, myName, hostToken, applyPayload, notify]);

  const confirmGuestName = (name) => {
    setGuestName(name.trim());
    writeStorage('sono-guest-name', name.trim());
  };
  // Le serveur sait ainsi si une ou deux apps sont connectées (le nom de l’app n’est affiché que s’il y a le choix).
  const setAppleLinked = (linked) => {
    if ((session.apps || []).includes('Apple Music') === linked) return;
    apiRequest(`/api/sessions/${session.code}`, { method: 'PATCH', headers: hostHeaders, body: JSON.stringify({ appleLinked: linked }) }).then(applyPayload).catch(() => {});
  };
  const setSource = async (source, message) => {
    try {
      applyPayload(await apiRequest(`/api/sessions/${session.code}`, { method: 'PATCH', headers: hostHeaders, body: JSON.stringify({ playbackSource: source }) }));
      if (message) notify(message);
    } catch (error) { notify(error.message, 'error'); }
  };
  const removeTrack = async (id) => {
    try {
      const track = queue.find((item) => item.id === id);
      const data = await apiRequest(`/api/sessions/${session.code}/tracks/${id}`, { method: 'DELETE', headers: hostHeaders });
      applyPayload(data); setModal(null);
      notify(tx("« {0} » a été retiré de la file.", track?.title));
    } catch (error) { notify(error.message, 'error'); }
  };
  const orderRequest = useRef(0);
  const sendOrder = async (items) => {
    const previous = queue;
    const order = orderRequest.current + 1;
    orderRequest.current = order;
    setQueue(items);
    beginChange();
    try {
      const data = await apiRequest(`/api/sessions/${session.code}/queue`, { method: 'PATCH', headers: hostHeaders, body: JSON.stringify({ ids: items.map((item) => item.id) }) });
      // Un autre déplacement a suivi : sa réponse fera foi.
      if (order === orderRequest.current) applyPayload(data);
    } catch (error) { if (order === orderRequest.current) setQueue(previous); notify(error.message, 'error'); }
    finally { endChange(); }
  };
  const reorderTrack = (from, to) => {
    if (from === to || to < 0 || to >= queue.length) return;
    const next = [...queue];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    sendOrder(next);
  };
  // Suivant / précédent : l’écran avance à chaque appui, mais rien n’est lancé tant que l’hôte continue de changer.
  // Le serveur (et donc le moteur) ne reçoit qu’une commande, une fois le choix arrêté.
  const showSkip = (action, track) => {
    if (action === 'next') {
      const earlier = current;
      setQueue((items) => items.filter((item) => item.id !== track.id));
      if (track.fromFallback && fallbackQueue) {
        const tracks = fallbackQueue.tracks.filter((item) => item.id !== track.id);
        setFallbackQueue({ ...fallbackQueue, tracks, total: Math.max(0, fallbackQueue.total - 1) });
        setSession((value) => (value.fallback ? { ...value, fallback: { ...value.fallback, next: tracks[0] || null } } : value));
      }
      if (earlier) { historyRef.current = [earlier, ...historyRef.current]; setPrevious(earlier); }
    } else {
      // Le titre quitté retourne en tête, comme le fera le serveur.
      if (current?.fromFallback && fallbackQueue) {
        const back = { ...current, id: `fond-${current.fallbackIndex}` };
        setFallbackQueue({ ...fallbackQueue, tracks: [back, ...fallbackQueue.tracks], total: fallbackQueue.total + 1 });
        setSession((value) => (value.fallback ? { ...value, fallback: { ...value.fallback, next: back } } : value));
      } else if (current) setQueue((items) => [current, ...items]);
      historyRef.current = historyRef.current.slice(1);
      setPrevious(historyRef.current[0] || null);
    }
    setCurrent(track);
    setPlaying(true);
    // Sur le téléphone qui joue, la barre attend que le son démarre vraiment.
    setProgress({ positionMs: 0, durationMs: trackDurationMs(track), at: Date.now(), running: engineBase(session.source) ? false : undefined });
  };
  // Fondu entre deux titres : dès que le nouveau son domine, l’affichage change, sans relancer le moteur.
  const advanceRef = useRef(null);
  advanceRef.current = (ms, preloaded) => {
    if (!nextUp || !current || playbackBusyRef.current || skipState.current.active) return;
    const expected = current.id;
    skipState.current.crossfadeTo = preloaded;
    skipState.current.crossfadeDeadline = Date.now() + 6000;
    skipState.current.watchUntil = Date.now() + 5000;
    preloadedRef.current = null;
    beginChange();
    showSkip('next', nextUp);
    setProgress({ positionMs: ms, durationMs: trackDurationMs(nextUp), at: Date.now(), running: true });
    apiRequest(`/api/sessions/${session.code}/playback`, { method: 'POST', headers: hostHeaders, body: JSON.stringify({ action: 'next', expected }) })
      .then(applyPayload)
      .catch(() => apiRequest(`/api/sessions/${session.code}`, { headers: hostHeaders }).then(applyPayload).catch(() => {}))
      .finally(endChange);
  };
  // Coupe le son à l’appui, pendant que l’hôte choisit le titre.
  const holdEngine = () => {
    if (session.source === 'Apple Music') { window.sonoAppleMusic?.pause?.(); return; }
    const base = engineBase(session.source);
    if (base) apiRequest(`${base}/transport`, { method: 'POST', headers: hostHeaders, body: JSON.stringify({ code: session.code, action: 'pause' }) }).catch(() => {});
  };
  const flushSkips = async () => {
    const state = skipState.current;
    state.timer = 0;
    if (state.sending) return;
    const delta = state.delta;
    state.delta = 0;
    state.sending = true;
    let data = null;
    try {
      if (delta) {
        preloadedRef.current = null;
        state.watchUntil = Date.now() + 5000;
        // Le moteur démarre tout de suite, le serveur est prévenu en même temps.
        [, data] = await Promise.all([
          controlProvider({ track: current, action: 'next', playing, source: session.source, hostToken, sessionCode: session.code }),
          apiRequest(`/api/sessions/${session.code}/playback`, { method: 'POST', headers: hostHeaders, body: JSON.stringify({ action: delta > 0 ? 'next' : 'previous', count: Math.abs(delta) }) }),
        ]);
      } else {
        // Retour au titre de départ : il repart où il en était, ou reste en pause s’il l’était.
        if (state.wasPlaying) await controlProvider({ track: current, action: 'resume', playing: false, source: session.source, hostToken, sessionCode: session.code });
        data = await apiRequest(`/api/sessions/${session.code}`, { headers: hostHeaders });
      }
      // De nouveaux appuis pendant l’envoi : cette réponse est déjà dépassée.
      if (!state.delta && !state.timer) applyPayload(data);
    } catch (error) {
      window.clearTimeout(state.timer);
      state.timer = 0;
      state.delta = 0;
      state.toggle = false;
      const refused = error.status === 409 && delta > 0 && (state.refused || 0) < 5;
      state.refused = refused ? (state.refused || 0) + 1 : 0;
      notify(refused ? tx("« {0} » n’est pas disponible sur votre compte {1} : il est passé.", current?.title, session.source) : error.message, 'error');
      await apiRequest(`/api/sessions/${session.code}`, { headers: hostHeaders }).then(applyPayload).catch(() => {});
      // Titre refusé par Deezer pour ce compte : on passe au suivant.
      if (refused) window.setTimeout(() => playbackRef.current('next'), 50);
    }
    state.sending = false;
    if (state.timer) return;
    if (state.delta) { flushSkipsRef.current(); return; }
    state.active = false;
    endChange();
    if (state.toggle) { state.toggle = false; playbackRef.current('toggle'); }
  };
  const flushSkipsRef = useRef(flushSkips);
  flushSkipsRef.current = flushSkips;
  const skipTrack = (action) => {
    const track = action === 'next' ? nextUp : previous;
    if (!track) return;
    const state = skipState.current;
    // Un changement à la main remplace le fondu en cours.
    state.crossfadeTo = null;
    showSkip(action, track);
    state.delta += action === 'next' ? 1 : -1;
    if (!state.active) {
      state.active = true;
      state.wasPlaying = playing;
      beginChange();
      // Le son en cours se coupe à l’appui ; le titre choisi part dès que l’hôte s’arrête de changer.
      if (current) holdEngine();
    }
    window.clearTimeout(state.timer);
    // Rien en cours : pas de raison d’attendre pour lancer le premier titre.
    state.timer = window.setTimeout(() => flushSkipsRef.current(), current ? SKIP_SETTLE_MS : 0);
  };
  const stableReorder = useStableCallback((from, to) => reorderTrack(from, to));
  const stableMoveFallback = useStableCallback((track, to) => moveFallbackTrack(track, to));
  const stableSkipFallback = useStableCallback((track) => skipFallbackTrack(track));
  const askRemove = useStableCallback((track) => setModal({ type: 'remove', track }));
  const openSearch = useStableCallback(() => setModal('search'));
  const playback = async (action, expected, { alreadyPlaying = false, skipped = 0 } = {}) => {
    if ((action === 'next' || action === 'previous') && expected === undefined && !alreadyPlaying && !skipped) { skipTrack(action); return; }
    // Pause pendant un enchaînement de titres : le titre choisi part d’abord, puis la pause s’applique.
    if (action === 'toggle' && skipState.current.active) {
      skipState.current.toggle = true;
      window.clearTimeout(skipState.current.timer);
      skipState.current.timer = 0;
      flushSkips();
      return;
    }
    if (playbackBusyRef.current) return;
    playbackBusyRef.current = true;
    const track = action === 'next' ? nextUp : action === 'previous' ? previous : current;
    // L’écran réagit tout de suite ; le serveur confirme ensuite (ou corrige en cas d’erreur).
    if (action === 'toggle') setPlaying(!playing);
    else if ((action === 'next' || action === 'previous') && track && !alreadyPlaying) {
      setCurrent(track);
      setPlaying(true);
      setQueue((items) => items.filter((item) => item.id !== track.id));
      setProgress({ positionMs: 0, durationMs: trackDurationMs(track), at: Date.now() });
    }
    try {
      // Une lecture lancée à la main remplace le titre préchargé dans le moteur.
      if (!alreadyPlaying && action !== 'toggle') preloadedRef.current = null;
      const control = () => controlProvider({ track, action: action === 'previous' ? 'next' : action, playing, source: session.source, hostToken, sessionCode: session.code });
      if (action === 'toggle') {
        // Pause et reprise : le moteur et le serveur sont prévenus en même temps.
        const [, data] = await Promise.all([control(), apiRequest(`/api/sessions/${session.code}/playback`, { method: 'POST', headers: hostHeaders, body: JSON.stringify({ action, expected: action === 'previous' ? current?.id ?? null : expected }) })]);
        applyPayload(data);
      } else {
        if (action !== 'ended' && !alreadyPlaying) await control();
        applyPayload(await apiRequest(`/api/sessions/${session.code}/playback`, { method: 'POST', headers: hostHeaders, body: JSON.stringify({ action, expected: action === 'previous' ? current?.id ?? null : expected }) }));
      }
    } catch (error) {
      // Titre refusé par Deezer pour ce compte : on le passe et on lance le suivant.
      if (error.status === 409 && action === 'next' && track && skipped < 5) {
        await dropUnavailableRef.current(track);
        playbackBusyRef.current = false;
        window.setTimeout(() => playbackRef.current('next', expected, { skipped: skipped + 1 }), 300);
        return;
      }
      notify(error.message, 'error');
      // Retour à l’état réel de la session après l’affichage anticipé.
      apiRequest(`/api/sessions/${session.code}`, { headers: hostHeaders }).then(applyPayload).catch(() => {});
    }
    finally { playbackBusyRef.current = false; }
  };
  playbackRef.current = playback;
  dropUnavailableRef.current = async (track) => {
    try {
      const path = track.fromFallback && Number.isInteger(track.fallbackIndex) ? `fallback/tracks/${track.fallbackIndex}?unavailable=1` : `tracks/${track.id}`;
      applyPayload(await apiRequest(`/api/sessions/${session.code}/${path}`, { method: 'DELETE', headers: hostHeaders }));
      notify(tx("« {0} » n’est pas disponible sur votre compte {1} : il est passé.", track.title, session.source), 'error');
    } catch {}
  };
  // Sono relancé pendant que la musique jouait : le titre resté dans le lecteur reprend tout seul,
  // à sa dernière position, dès que l’app de lecture est prête (le moteur Deezer met un instant à se connecter).
  const resumeCheckedRef = useRef(false);
  useEffect(() => {
    if (resumeCheckedRef.current || hostState !== 'host' || !current || !session.source) return undefined;
    resumeCheckedRef.current = true;
    if (!playing) return undefined;
    let cancelled = false;
    (async () => {
      for (let attempt = 0; attempt < 30 && !cancelled; attempt += 1) {
        try {
          if (engineBase(session.source)) await apiRequest(`${engineBase(session.source)}/status?code=${encodeURIComponent(session.code)}`, { headers: hostHeaders });
          await controlProvider({ track: current, action: 'resume', playing, source: session.source, hostToken, sessionCode: session.code });
          return;
        } catch { await new Promise((resolve) => setTimeout(resolve, 1000)); }
      }
    })();
    return () => { cancelled = true; };
  }, [hostState, current?.id, session.source]);
  // À la fin d’un titre, on enchaîne : la file d’abord, puis la musique de fond.
  autoAdvanceRef.current = (endedId, switchedTo) => {
    if (playbackBusyRef.current || !playing || current?.id !== endedId) return;
    if (!switchedTo) { playback(nextUp ? 'next' : 'ended', endedId); return; }
    // Le moteur Deezer est déjà passé au titre préchargé : on l’enregistre sans relancer la lecture.
    if (nextUp && nextUp.source === 'Deezer' && String(nextUp.providerId) === switchedTo) { playback('next', endedId, { alreadyPlaying: true }); return; }
    if (nextUp) { playback('next', endedId); return; }
    apiRequest(`${engineBase(session.source)}/transport`, { method: 'POST', headers: hostHeaders, body: JSON.stringify({ code: session.code, action: 'playpause' }) }).catch(() => {});
    playback('ended', endedId);
  };
  const chooseFallback = async (choice) => {
    applyPayload(await apiRequest(`/api/sessions/${session.code}/fallback`, { method: 'PUT', headers: hostHeaders, body: JSON.stringify({ ...choice, source: session.source }) }));
    setModal(null);
    notify(tx("« {0} » prendra le relais quand la file sera vide.", choice.name));
  };
  const moveFallbackTrack = async (track, to) => {
    const previousQueue = fallbackQueue;
    const previousNext = session.fallback?.next;
    const order = orderRequest.current + 1;
    orderRequest.current = order;
    const tracks = moveItem(fallbackQueue?.tracks || [], track, to);
    setFallbackQueue((value) => (value ? { ...value, tracks } : value));
    if (tracks[0]) setSession((value) => (value.fallback ? { ...value, fallback: { ...value.fallback, next: tracks[0] } } : value));
    beginChange();
    try {
      const data = await apiRequest(`/api/sessions/${session.code}/fallback/order`, { method: 'PATCH', headers: hostHeaders, body: JSON.stringify({ index: track.fallbackIndex, to }) });
      if (order === orderRequest.current) applyPayload(data);
    } catch (error) {
      if (order === orderRequest.current) { setFallbackQueue(previousQueue); setSession((value) => (value.fallback ? { ...value, fallback: { ...value.fallback, next: previousNext } } : value)); }
      notify(error.message, 'error');
    } finally { endChange(); }
  };
  const skipFallbackTrack = async (track) => {
    try {
      applyPayload(await apiRequest(`/api/sessions/${session.code}/fallback/tracks/${track.fallbackIndex}`, { method: 'DELETE', headers: hostHeaders }));
      notify(tx("« {0} » ne passera pas.", track.title));
    } catch (error) { notify(error.message, 'error'); }
  };
  const clearFallback = async () => {
    try {
      applyPayload(await apiRequest(`/api/sessions/${session.code}/fallback`, { method: 'DELETE', headers: hostHeaders }));
      notify(tx("La musique de fond est désactivée."));
    } catch (error) { notify(error.message, 'error'); }
  };
  const copyInvite = async () => {
    try { await navigator.clipboard.writeText(inviteUrl); notify(tx("Lien d’invitation copié.")); }
    catch { notify(tx("Impossible de copier le lien automatiquement."), 'error'); }
  };

  const saveSettings = async (changes, message) => {
    try {
      applyPayload(await apiRequest(`/api/sessions/${session.code}`, { method: 'PATCH', headers: hostHeaders, body: JSON.stringify(changes) }));
      notify(message);
      return true;
    } catch (error) { notify(error.message, 'error'); return false; }
  };
  const startHosting = async ({ name, host, requireApproval }) => {
    const data = await apiRequest('/api/sessions', { method: 'POST', body: JSON.stringify({ name, host, requireApproval }) });
    applyPayload(data);
    setView('queue');
    setHostState('host');
    notify(tx("Votre session est prête. Invitez vos proches !"));
  };
  const resumeHosting = (code) => {
    writeStorage('sono-host-code', code);
    setHostToken(readStorage(`sono-host-${code}`));
    setSession((state) => ({ ...state, code }));
    setHostState('checking');
  };
  resumeHostingRef.current = resumeHosting;
  useEffect(() => {
    if (hostState === 'host' && hostToken && session.code) rememberHostSession(session.code, hostToken);
  }, [hostState, session.code, hostToken]);
  // L’hôte est là : ses écrans (paramètres, connexions, mode TV…) sont préchargés pour s’ouvrir sans attente.
  useEffect(() => { if (hostState === 'host') loadHostParts().catch(() => {}); }, [hostState]);
  // La session animée est retenue par le serveur pour cet ordinateur ; oubliée quand l’hôte la quitte.
  const rememberHostSession = (code, token) => apiRequest('/api/local/host', { method: 'PUT', body: JSON.stringify(code ? { sessionCode: code, hostToken: token } : { sessionCode: null }) }).catch(() => {});
  const removeMember = async (person) => {
    try {
      applyPayload(await apiRequest(`/api/sessions/${session.code}/members/${person.id}`, { method: 'DELETE', headers: hostHeaders }));
      setModal(null);
      notify(tx("{0} a été retiré de la session.", person.name));
    } catch (error) { notify(error.message, 'error'); }
  };
  // L’hôte nomme un invité admin (ou lui retire ce statut) : il pourra gérer la lecture, la file et les arrivées.
  const setAdmin = async (person, admin) => {
    try {
      applyPayload(await apiRequest(`/api/sessions/${session.code}/admins`, { method: 'PATCH', headers: hostHeaders, body: JSON.stringify({ id: person.id, admin }) }));
      setModal(null);
      notify(admin ? tx("{0} est maintenant admin.", person.name) : tx("{0} n’est plus admin.", person.name));
    } catch (error) { notify(error.message, 'error'); }
  };
  // L’invité apprend qu’il vient d’être nommé admin (ou ne l’est plus).
  const wasAdmin = useRef(null);
  useEffect(() => {
    if (!isGuest || !adminLoaded) return;
    // Premier état reçu : simple point de départ (pas de message à chaque rechargement de la page).
    if (wasAdmin.current !== null) {
      if (adminInfo && !wasAdmin.current) notify(tx("L’hôte vous a nommé admin : vous pouvez gérer la lecture et la file."));
      else if (!adminInfo && wasAdmin.current) notify(tx("Vous n’êtes plus admin."));
    }
    wasAdmin.current = Boolean(adminInfo);
  }, [adminInfo, adminLoaded, isGuest]);
  const deleteSession = async () => {
    const { code } = session;
    try {
      try {
        const music = window.sonoAppleMusic;
        if (playing && session.source === 'Apple Music' && music) await (music.stop ? music.stop() : music.pause());
      } catch {}
      await apiRequest(`/api/sessions/${code}`, { method: 'DELETE', headers: hostHeaders });
      writeStorage(`sono-host-${code}`, null);
      writeStorage('sono-host-code', null);
      if (readStorage('sono-last-host-code') === code) writeStorage('sono-last-host-code', null);
      rememberHostSession(null);
      setModal(null);
      setHostState('home');
      notify(tx("La session « {0} » a été supprimée.", session.name));
    } catch (error) { notify(error.message, 'error'); }
  };
  const leaveAsGuest = () => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'leave' }));
    window.setTimeout(() => window.location.assign('/rejoindre'), 150);
  };
  const decideRequest = async (request, decision) => {
    try {
      applyPayload(await apiRequest(`/api/sessions/${session.code}/admissions`, { method: 'POST', headers: hostHeaders, body: JSON.stringify({ id: request.id, decision }) }));
      notify(decision === 'accept' ? tx("{0} a rejoint la session.", request.name) : tx("La demande de {0} a été refusée.", request.name));
    } catch (error) { notify(error.message, 'error'); }
  };
  const requestAgain = () => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ ...helloRef.current, retry: true }));
  };
  const closeModal = useCallback(() => setModal(null), []);
  useMediaKeys({
    toggle: () => playback(current ? 'toggle' : 'next'),
    next: () => { if (nextUp) playback('next'); },
    previous: () => { if (previous) playback('previous'); },
  }, hostState === 'host' || adminControl);

  if (hostState === 'checking') return <><AppBackdrop appearance={look} cover={backdropCover} /><div className="guest-shell boot-screen"><Brand /><LoaderCircle className="spin" size={22} /></div></>;
  if (hostState === 'home') {
    const lastCode = readStorage('sono-last-host-code');
    return <><AppBackdrop appearance={look} cover={backdropCover} /><HomeView initialTab={isJoinPage || !localHosts.includes(window.location.hostname) ? 'join' : 'create'} onCreate={startHosting} resumeCode={lastCode && readStorage(`sono-host-${lastCode}`) ? lastCode : ''} onResume={resumeHosting} guestName={guestName} onConfirmName={confirmGuestName} toast={toast} closeToast={closeToast} /></>;
  }

  if (isGuest && ended) return <><AppBackdrop appearance={look} cover={backdropCover} /><SessionEndedView /></>;

  if (isGuest && !myName) {
    return <><AppBackdrop appearance={look} /><NameGate session={session} onConfirm={confirmGuestName} toast={toast} closeToast={closeToast} /></>;
  }

  if (isGuest && ['pending', 'refused', 'removed'].includes(admission)) {
    return <><AppBackdrop appearance={look} /><WaitingView session={session} admission={admission} live={live} name={myName} onRetry={requestAgain} toast={toast} closeToast={closeToast} /></>;
  }

  if (isGuest) {
    return <><AppBackdrop appearance={look} cover={current?.cover} /><GuestView admin={adminInfo} control={adminControl ? { canPrevious: Boolean(previous), canNext: Boolean(nextUp), onToggle: () => playback(current ? 'toggle' : 'next'), onNext: () => playback('next'), onPrevious: () => playback('previous'), requests: session.requests || [], onDecide: decideRequest, onRemoveTrack: removeTrack, onReorder: reorderTrack, onSkipFallback: skipFallbackTrack, onMoveFallback: moveFallbackTrack, headers: hostHeaders } : null} session={session} queue={queue} fallbackQueue={fallbackQueue} current={current} playing={playing} live={live} addTrack={addTrack} name={myName} onLeave={leaveAsGuest} toast={toast} closeToast={closeToast} /></>;
  }

  const showPanel = view === 'queue' && PANEL_WIDGETS.some((id) => widgets[id]);
  return <div className={showPanel ? 'app-shell' : 'app-shell no-panel'}>
    <AppBackdrop appearance={look} cover={current?.cover} />
    <aside className="sidebar">
      <Brand />
      <div className="session-mini">{!live && <span className="live-dot offline" title={tx("Reconnexion…")} />}<div><small>Session</small><strong>{session.name}</strong><span>{session.code}</span></div></div>
      <nav className="main-nav" aria-label={tx("Navigation principale")}>
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? 'active' : ''} aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}>
          <Icon size={19} /><span className="nav-label">{label}</span>{id === 'queue' && queue.length > 0 && <span className="nav-count">{queue.length}</span>}
        </button>)}
        <button className={view === 'settings' || view === 'appearance' ? 'nav-settings active' : 'nav-settings'} aria-current={view === 'settings' || view === 'appearance' ? 'page' : undefined} onClick={() => setView('settings')}><Settings size={19} /><span className="nav-label">{tx("Réglages")}</span></button>
      </nav>
      <button type="button" className="host-profile" onClick={() => setView('settings')} title={tx("Modifier mon profil")}><Avatar name={session.host} /><div><strong>{session.host}</strong><span><ShieldCheck size={12} />{session.host === 'Hôte' ? tx("Ajoutez votre nom") : tx("Hôte de la session")}</span></div></button>
    </aside>

    <main className="main-content">
      <header className="mobile-header"><Brand /><IconButton label={tx("Afficher le code QR")} className="mobile-qr" onClick={() => setModal('qr')}><QrCode size={20} /></IconButton></header>
      {(session.requests || []).length > 0 && <JoinRequests requests={session.requests} onDecide={decideRequest} />}
      {joinNotices.length > 0 && <JoinNotices notices={joinNotices} onDismiss={dismissJoinNotice} onRemove={(person) => { dismissJoinNotice(person.id); setModal({ type: 'kick', person }); }} />}
      {view === 'queue' && <div className="view">
        <section className="page-heading">
          <div>{!live && <div className="eyebrow offline"><span className="live-dot offline" />{tx("RECONNEXION…")}</div>}<h1>{session.name}</h1></div>
          <div className="heading-actions">
            <button className="button secondary invite-inline" onClick={() => setModal('qr')}><QrCode size={16} />{tx("Inviter")}</button>
            {!widgets.nowPlaying && <button className="button secondary tv-button" onClick={() => setTv({ tools: false, origin: ['.tv-button'] })}><Tv size={16} /><span>{tx("Mode TV")}</span></button>}
          </div>
        </section>
        {!session.source && <div className="source-notice"><span className="logo-pair"><ProviderLogo provider="Apple Music" size={26} /><ProviderLogo provider="Deezer" size={26} /></span><p><strong>{tx("Choisissez l’app qui jouera la musique")}</strong>{tx("Connectez Apple Music ou Deezer : la lecture et la recherche passeront uniquement par cette app.")}</p><button className="button primary" onClick={() => setView('integrations')}><Link2 size={16} />{tx("Connecter")}</button></div>}
        {widgets.nowPlaying && <NowPlaying onOpenTv={() => setTv({ tools: false, origin: ['.now-playing'] })} current={current} next={nextUp} previous={previous} playing={playing} source={(session.apps || []).length > 1 ? session.source : null} togglePlayback={() => playback(current ? 'toggle' : 'next')} nextTrack={() => playback('next')} previousTrack={() => playback('previous')} progressBar={widgets.progress && <ProgressBar className="now-progress" track={current} progress={progress} playing={playing} onSeek={seekTo} />} />}
        {(widgets.queue || widgets.fallback) && <section className="queue-section">
          {widgets.queue && <><div className="section-heading">
            <div><h2>{tx("Prochains titres")} <span key={queue.length + (fallbackQueue?.total || 0)} className="count-pill pop">{queue.length + (fallbackQueue?.total || 0)}</span></h2>{queue.length > 0 && <p>{queueDuration(queue)} {tx("de musique proposée · glissez une ligne pour réordonner")}</p>}</div>
            <button className="button primary" onClick={() => setModal('search')}><Plus size={16} />{tx("Ajouter")}</button>
          </div>
          {session.fallback && <QueueGroupLabel title={tx("Proposés par les invités")} count={queue.length} />}
          <QueueList queue={queue} host fallback={session.fallback} onRemove={askRemove} onReorder={stableReorder} onBrowse={openSearch} /></>}
          {widgets.fallback && <><FallbackCard fallback={session.fallback} source={session.source} onChoose={() => setModal('fallback')} onClear={clearFallback} />
          {session.fallback && <FallbackList tracks={fallbackQueue?.tracks || NO_TRACKS} total={fallbackQueue?.total || 0} host startIndex={queue.length} onSkip={stableSkipFallback} onMove={stableMoveFallback} sessionCode={session.code} headers={hostHeaders} />}</>}
        </section>}
      </div>}
      {view === 'activity' && <ActivityView activity={activity} participants={session.participants || []} guests={session.guests} queue={queue} onRemove={(person) => setModal({ type: 'kick', person })} onToggleAdmin={(person) => (person.admin ? setAdmin(person, false) : setModal({ type: 'admin', person }))} />}
      {view === 'integrations' && <IntegrationsView notify={notify} hostToken={hostToken} sessionCode={session.code} source={session.source} onSourceChange={setSource} onAppleLinked={setAppleLinked} />}
      {view === 'appearance' && <AppearanceView appearance={appearance} onChange={updateAppearance} onReset={() => setAppearance(DEFAULT_APPEARANCE)} onOpenTv={() => setTv({ tools: true, origin: ['.tv-preview'] })} onSection={setView} />}
      {view === 'settings' && <SettingsView session={session} hostToken={hostToken} notify={notify} inviteUrl={inviteUrl} onCopy={copyInvite} onSave={saveSettings} onDelete={() => setModal('delete')} onSection={setView} />}
    </main>

    {showPanel && <aside className="right-panel">
      {widgets.invite && <div className="invite-card">
        <div className="invite-title"><span><QrCode size={18} /></span><div><h3>{tx("Inviter des proches")}</h3><p>{tx("Scannez pour proposer des titres")}</p></div></div>
        <button className="qr-wrap" onClick={() => setModal('qr')} aria-label={tx("Agrandir le code QR")}><QRCodeSVG value={inviteUrl} size={180} bgColor="#f7f5ef" fgColor="#151512" level="M" /></button>
        <button className="session-code" onClick={copyInvite} title={tx("Copier le lien d’invitation")}>{session.code}<Copy size={14} /></button>
        {session.requireApproval && <p className="approval-chip"><ShieldCheck size={13} />{tx("Vous validez chaque invité")}</p>}
        <div className="access-toggle" role="group" aria-label={tx("Qui peut rejoindre")}>
          <button type="button" className={publicUrl ? '' : 'active'} aria-pressed={!publicUrl} disabled={publicBusy} onClick={() => publicUrl && disablePublicAccess()}><Wifi size={14} />Wi-Fi</button>
          <button type="button" className={publicUrl ? 'active' : ''} aria-pressed={Boolean(publicUrl)} disabled={publicBusy} onClick={() => !publicUrl && enablePublicAccess()}>{publicBusy ? <LoaderCircle className="spin" size={14} /> : <Globe2 size={14} />}Internet</button>
        </div>
      </div>}
      {widgets.stats && <div className="party-stats">
        <div><strong>{session.guests}</strong><small>{session.guests > 1 ? tx("invités connectés") : tx("invité connecté")}</small></div>
        <div><strong>{queueDuration(queue)}</strong><small>{tx("proposés en attente")}</small></div>
      </div>}
      {widgets.participants && <ParticipantList participants={session.participants || []} onRemove={(person) => setModal({ type: 'kick', person })} onToggleAdmin={(person) => (person.admin ? setAdmin(person, false) : setModal({ type: 'admin', person }))} />}
      {widgets.activity && <div className="recent-activity">
        <div className="mini-heading"><h3>{tx("Activité récente")}</h3><button onClick={() => setView('activity')}>{tx("Voir tout")}<ChevronRight size={14} /></button></div>
        {activity.length ? <ul>{activity.slice(0, 4).map((item, index) => <li key={item.at || index}><ActivityIcon icon={item.icon} /><div><p>{txServer(item.text)}</p><small>{activityTime(item)}</small></div></li>)}</ul> : <p className="recent-empty">{tx("Rien pour l’instant.")}</p>}
      </div>}
    </aside>}

    {modal === 'qr' && <Modal onClose={closeModal} className="qr-modal">
      <div className="modal-symbol lime"><QrCode size={24} /></div>
      <h2>{tx("Rejoindre")} {session.name}</h2>
      <p>{tx("Scannez ce code avec l’appareil photo de votre téléphone.")}</p>
      <div className="qr-large"><QRCodeSVG value={inviteUrl} size={240} bgColor="#ffffff" fgColor="#11110f" level="H" /></div>
      <div className="big-code">{session.code}</div>
      <div className="copy-field"><span>{inviteUrl}</span><IconButton label={tx("Copier le lien")} onClick={copyInvite}><Copy size={17} /></IconButton></div>
      <p className="join-note">{tx("Sans appareil photo : ouvrez")} <strong>{joinUrl.replace(/^https?:\/\//, '')}</strong> {tx("et tapez le code.")}</p>
      <small className={publicUrl ? 'privacy-note public' : 'privacy-note'}>{publicUrl ? <Globe2 size={14} /> : <Wifi size={14} />}{publicUrl ? tx("Lien public actif") : tx("Réseau Wi-Fi local")}</small>
      {publicUrl ? <button className="text-button danger-text" disabled={publicBusy} onClick={disablePublicAccess}>{tx("Désactiver le lien public")}</button> : <button className="button primary public-access-button" disabled={publicBusy} onClick={enablePublicAccess}>{publicBusy ? <LoaderCircle className="spin" size={16} /> : <Globe2 size={16} />}{publicBusy ? tx("Création du lien…") : tx("Autoriser les invités hors Wi-Fi")}</button>}
    </Modal>}
    {modal === 'search' && <Modal onClose={closeModal} className="search-modal"><SearchPanel source={session.source} showSource={(session.apps || []).length > 1} onConnect={() => { setModal(null); setView('integrations'); }} addTrack={async (track) => { if (await addTrack(track)) setModal(null); }} /></Modal>}
    {modal?.type === 'remove' && <Modal onClose={closeModal} className="confirm-modal">
      <div className="modal-symbol danger"><Trash2 size={22} /></div>
      <h2>{tx("Retirer ce titre ?")}</h2>
      <div className="confirm-track"><TrackCover track={modal.track} /><div><strong>{modal.track.title}</strong><span>{modal.track.artist}</span></div></div>
      <div className="modal-actions"><button className="button secondary" onClick={closeModal}>{tx("Annuler")}</button><button className="button danger-button" onClick={() => removeTrack(modal.track.id)}>{tx("Retirer le titre")}</button></div>
    </Modal>}
    {modal?.type === 'admin' && <Modal onClose={closeModal} className="confirm-modal">
      <div className="modal-symbol lime"><ShieldPlus size={22} /></div>
      <h2>{tx("Nommer")} {modal.person.name} {tx("admin ?")}</h2>
      <p>{modal.person.name} {tx("pourra lancer et passer les titres, gérer la file et accepter les invités.")} {modal.person.name} {tx("ne pourra pas modifier les réglages ni les connexions.")}</p>
      <div className="modal-actions"><button className="button secondary" onClick={closeModal}>{tx("Annuler")}</button><button className="button primary" onClick={() => setAdmin(modal.person, true)}>{tx("Nommer admin")}</button></div>
    </Modal>}
    {modal?.type === 'kick' && <Modal onClose={closeModal} className="confirm-modal">
      <div className="modal-symbol danger"><UserMinus size={22} /></div>
      <h2>{tx("Retirer")} {modal.person.name} ?</h2>
      <p>{modal.person.name} {tx("ne verra plus la file et ne pourra plus ajouter de titres. Cette personne pourra vous demander à revenir.")}</p>
      <div className="modal-actions"><button className="button secondary" onClick={closeModal}>{tx("Annuler")}</button><button className="button danger-button" onClick={() => removeMember(modal.person)}>{tx("Retirer de la session")}</button></div>
    </Modal>}
    {modal === 'fallback' && <FallbackModal source={session.source} sessionCode={session.code} hostToken={hostToken} onClose={closeModal} onChoose={chooseFallback} />}
    {modal === 'delete' && <DeleteSessionModal session={session} onClose={closeModal} onConfirm={deleteSession} />}
    {!tv && toast && <Toast toast={toast} onClose={closeToast} />}
    {tv && createPortal(<TvView origin={tv.origin} current={current} previousKey={previous && trackKey(previous)} next={nextUp} playing={playing} inviteUrl={inviteUrl}
      controls={{ canPrevious: Boolean(previous), canNext: Boolean(nextUp), onToggle: () => playback(current ? 'toggle' : 'next'), onNext: () => playback('next'), onPrevious: () => playback('previous') }} appearance={appearance} onAppearance={updateAppearance} showTools={tv.tools} progressBar={current && <ProgressBar className="tv-progress" track={current} progress={progress} playing={playing} onSeek={seekTo} />} onExit={() => setTv(null)} toast={toast} closeToast={closeToast}>
      {(session.requests || []).length > 0 && <JoinRequests requests={session.requests} onDecide={decideRequest} />}
      {joinNotices.length > 0 && <JoinNotices notices={joinNotices} onDismiss={dismissJoinNotice} />}
    </TvView>, document.body)}
  </div>;
}

function ParticipantList({ participants, title = tx("Dans la session"), onRemove, onToggleAdmin }) {
  const guests = participants.filter((person) => person.role !== 'host');
  return <div className="participants">
    <div className="mini-heading"><h3>{title} <span className="count-pill">{participants.length}</span></h3></div>
    <ul>{participants.map((person) => <li key={person.id}>
      <Avatar name={person.name} />
      {/* Nom et badge (Hôte / Admin) sur une ligne, statut sur la suivante : le statut n’est jamais écrasé par les boutons. */}
      <span className="participant-name">
        <span className="participant-title"><strong>{person.name}</strong>{person.role === 'host' ? <span className="role-chip">Hôte</span> : person.admin && <span className="role-chip">Admin</span>}</span>
        <small className={person.online ? 'presence online' : 'presence'}>{person.role === 'host' ? tx("Organise la session") : person.online ? tx("En ligne") : tx("Hors ligne")}</small>
      </span>
      {person.role !== 'host' && (onToggleAdmin || onRemove) && <span className="participant-actions">
        {onToggleAdmin && <IconButton label={person.admin ? tx("Retirer {0} des admins", person.name) : tx("Nommer {0} admin", person.name)} className={person.admin ? 'admin-person active' : 'admin-person'} onClick={() => onToggleAdmin(person)}><ShieldPlus size={15} /></IconButton>}
        {onRemove && <IconButton label={tx("Retirer {0}", person.name)} className="remove-person" onClick={() => onRemove(person)}><UserMinus size={15} /></IconButton>}
      </span>}
    </li>)}</ul>
    {!guests.length && <p className="recent-empty">{tx("Personne n’a encore rejoint.")}</p>}
  </div>;
}

function ActivityIcon({ icon }) {
  return <span className={`activity-icon ${icon || 'music'}`}>{icon === 'plus' ? <Plus size={15} /> : icon === 'user' ? <UserRound size={15} /> : <Music2 size={15} />}</span>;
}

// Barre de progression : défile en continu (sans à-coups entre deux relevés de l’app de lecture),
// se survole pour voir un moment du titre, et se clique ou se fait glisser pour y aller.
const clockLabel = (ms) => {
  const total = Math.max(0, Math.floor((ms || 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

// Position de lecture partagée par les barres de progression : un relevé ne redessine qu’elles,
// pas toute l’app (le moteur est interrogé chaque seconde).
function createProgressStore() {
  let value = { positionMs: 0, durationMs: 0, at: Date.now() };
  const listeners = new Set();
  return {
    get: () => value,
    set: (next) => { value = typeof next === 'function' ? next(value) : next; listeners.forEach((listener) => listener()); },
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

function ProgressBar({ track, progress: store, playing, onSeek, className = '' }) {
  const progress = useSyncExternalStore(store.subscribe, store.get);
  const trackRef = useRef(null);
  const fillRef = useRef(null);
  const thumbRef = useRef(null);
  const tipRef = useRef(null);
  const timeRef = useRef(null);
  const anchor = useRef({ positionMs: 0, at: performance.now(), playing: false });
  const dragRef = useRef(null);
  const settleRef = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [hovering, setHovering] = useState(false);
  const duration = progress.durationMs || trackDurationMs(track) || 0;
  const durationRef = useRef(duration);
  durationRef.current = duration;
  const livePosition = () => {
    const { positionMs, at, playing: running } = anchor.current;
    return positionMs + (running ? performance.now() - at : 0);
  };
  // La barre est dessinée directement (sans passer par React) : le glissement suit la souris image par image.
  const draw = (position) => {
    const total = durationRef.current;
    const ratio = total ? Math.min(1, Math.max(0, position / total)) : 0;
    // Transformations seulement : la carte graphique déplace la barre sans recalcul de mise en page.
    if (fillRef.current) { fillRef.current.style.transition = 'none'; fillRef.current.style.transform = `translate3d(${(ratio - 1) * 100}%, 0, 0)`; }
    if (thumbRef.current) { thumbRef.current.style.transition = 'none'; thumbRef.current.style.transform = `translateX(${ratio * 100}%)`; }
    const label = clockLabel(Math.min(position, total || position));
    if (timeRef.current && timeRef.current.textContent !== label) timeRef.current.textContent = label;
  };
  // En lecture, une seule consigne suffit : la carte graphique fait glisser la barre jusqu’au bout, en continu et sans calcul.
  const run = () => {
    const position = livePosition();
    draw(position);
    const total = durationRef.current;
    if (!anchor.current.playing || !total || position >= total || !fillRef.current || !thumbRef.current) return;
    void fillRef.current.offsetWidth;
    const motion = `transform ${Math.round(total - position)}ms linear`;
    fillRef.current.style.transition = motion;
    thumbRef.current.style.transition = motion;
    fillRef.current.style.transform = 'translate3d(0, 0, 0)';
    thumbRef.current.style.transform = 'translateX(100%)';
  };
  const showTip = (ms) => {
    const total = durationRef.current;
    if (!tipRef.current || !total) return;
    tipRef.current.style.left = `${(ms / total) * 100}%`;
    tipRef.current.textContent = clockLabel(ms);
  };
  // Un relevé de l’app de lecture ne recale la barre que s’il s’écarte vraiment de sa course.
  // Juste après un déplacement, on laisse au moteur le temps d’y aller avant d’écouter ses relevés.
  useEffect(() => {
    const running = playing && progress.running !== false;
    const sample = progress.positionMs + (running ? Date.now() - progress.at : 0);
    const drift = Math.abs(sample - livePosition());
    if (drift > 700 && performance.now() < settleRef.current) return;
    if (drift > 700 || anchor.current.playing !== running) {
      anchor.current = { positionMs: drift > 700 ? sample : livePosition(), at: performance.now(), playing: running };
      if (dragRef.current === null) run();
    }
  }, [progress, playing]);
  useEffect(() => {
    // Seul le temps affiché passe par ici, une fois par seconde.
    const paint = () => {
      if (dragRef.current !== null || !anchor.current.playing || !timeRef.current) return;
      const total = durationRef.current;
      const label = clockLabel(Math.min(livePosition(), total || Infinity));
      if (timeRef.current.textContent !== label) timeRef.current.textContent = label;
    };
    run();
    const timer = window.setInterval(paint, 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { if (dragRef.current === null) run(); }, [duration]);
  const msAt = (clientX) => {
    const rect = trackRef.current.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * durationRef.current;
  };
  const seek = (ms) => {
    const target = Math.round(Math.min(Math.max(0, ms), Math.max(0, durationRef.current - 1000)));
    anchor.current = { positionMs: target, at: performance.now(), playing };
    settleRef.current = performance.now() + 2000;
    run();
    onSeek(target);
  };
  const onPointerDown = (event) => {
    if (!duration) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = msAt(event.clientX);
    setDragging(true);
    draw(dragRef.current);
    showTip(dragRef.current);
  };
  const onPointerMove = (event) => {
    if (!duration) return;
    const ms = msAt(event.clientX);
    showTip(ms);
    if (dragRef.current !== null) { dragRef.current = ms; draw(ms); }
  };
  const onPointerUp = () => {
    if (dragRef.current === null) return;
    seek(dragRef.current);
    dragRef.current = null;
    setDragging(false);
  };
  const onKeyDown = (event) => {
    if (!duration) return;
    const step = { ArrowRight: 5000, ArrowLeft: -5000, ArrowUp: 5000, ArrowDown: -5000 }[event.key];
    if (step) { event.preventDefault(); seek(livePosition() + step); }
    if (event.key === 'Home') { event.preventDefault(); seek(0); }
  };
  return <div className={`progress${dragging ? ' dragging' : ''}${(hovering || dragging) && duration ? ' show-tip' : ''}${duration ? '' : ' disabled'} ${className}`}>
    <span ref={timeRef} className="progress-time" />
    <div ref={trackRef} className="progress-track" role="slider" tabIndex={duration ? 0 : -1} aria-label={tx("Position dans le titre")} aria-valuemin={0} aria-valuemax={Math.round(duration / 1000)}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onPointerEnter={() => setHovering(true)} onPointerLeave={() => setHovering(false)} onKeyDown={onKeyDown}>
      <span className="progress-rail"><span ref={fillRef} className="progress-fill" /></span>
      <span ref={thumbRef} className="progress-thumb-track"><span className="progress-thumb" /></span>
      <span ref={tipRef} className="progress-tip" aria-hidden="true" />
    </div>
    <span className="progress-time">{duration ? clockLabel(duration) : '—:—'}</span>
  </div>;
}

// Halo coloré de la pochette derrière le titre en cours, atténué pour les pochettes claires.
function CoverGlow({ cover }) {
  const measure = useImageMeasure(cover);
  // Le temps d’analyser la nouvelle pochette, l’ancienne reste en place.
  const last = useRef(null);
  if (measure) last.current = { measure, cover };
  if (!last.current) return null;
  const { measure: shown, cover: shownCover } = last.current;
  const shade = shown.shade ?? 0.5;
  return <div className={shown.blur ? 'now-backdrop soft' : 'now-backdrop'} style={{ opacity: 0.4 * Math.min(1, (1 - shade) / 0.5) }} aria-hidden="true"><FadeCover src={shown.blur || shownCover} /></div>;
}

const SKIP_SETTLE_MS = 250;
// Identité d’un titre à l’écran : le serveur peut lui donner un nouvel identifiant en le lançant.
const trackKey = (track) => (track ? `${track.providerId || ''}|${track.title}|${track.artist}` : 'vide');

const NO_TRACKS = [];
// Une fonction qui garde la même identité d’un rendu à l’autre, pour ne pas redessiner les listes mémorisées.
function useStableCallback(callback) {
  const ref = useRef(callback);
  ref.current = callback;
  return useCallback((...args) => ref.current(...args), []);
}
const keepSame = (value, next) => (value === next || JSON.stringify(value) === JSON.stringify(next) ? value : next);

const moveItem = (items, item, to) => {
  const from = items.findIndex((other) => other.id === item.id);
  if (from < 0) return items;
  const next = [...items];
  next.splice(from, 1);
  next.splice(Math.min(to, next.length), 0, items[from]);
  return next;
};

// Texte qui change avec le titre : l’ancien sort sur le côté pendant que le nouveau entre de l’autre côté.
// Ils restent toujours à une largeur d’écart : jamais superposés, jamais de vide, et rien ne bouge en hauteur.
// Un nouveau changement en cours de fondu repart de l’état affiché, sans clignotement.
function SwapText({ swapKey, backKey, className = '', children }) {
  const layerRef = useRef(null);
  const last = useRef(null);
  const settle = useRef(0);
  useEffect(() => () => window.clearTimeout(settle.current), []);
  useLayoutEffect(() => {
    const layer = layerRef.current;
    const before = last.current;
    last.current = { key: swapKey, backKey, html: layer.innerHTML };
    if (!before || before.key === swapKey || reducedMotion()) return;
    const width = layer.parentElement.clientWidth;
    const direction = swapKey === before.backKey ? -1 : 1;
    // Un changement pendant le glissement repart de ce qui est à l’écran.
    const style = getComputedStyle(layer);
    const x = new DOMMatrixReadOnly(style.transform).m41;
    const opacity = Number(style.opacity);
    const ghost = layer.cloneNode(false);
    ghost.innerHTML = before.html;
    ghost.classList.add('swap-ghost');
    ghost.setAttribute('aria-hidden', 'true');
    layer.after(ghost);
    const timing = { duration: 320, easing: 'cubic-bezier(.4, 0, .2, 1)' };
    ghost.animate([{ transform: `translate3d(${x}px, 0, 0)`, opacity }, { transform: `translate3d(${-direction * width}px, 0, 0)`, opacity: 0 }], { ...timing, fill: 'forwards' }).onfinish = () => ghost.remove();
    layer.getAnimations().forEach((animation) => animation.cancel());
    layer.animate([{ transform: `translate3d(${direction * width}px, 0, 0)`, opacity: 0 }, { transform: 'translate3d(0, 0, 0)', opacity: 1 }], timing);
    // Si l’écran ne dessine plus d’images (fenêtre cachée, recopie vers une TV), l’animation resterait à son début, texte invisible :
    // passé sa durée, le texte est remis à sa place quoi qu’il arrive.
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      layer.getAnimations().forEach((animation) => animation.finish());
      layer.parentElement?.querySelectorAll('.swap-ghost').forEach((item) => item.remove());
    }, timing.duration + 120);
  });
  return <div className={`swap-text ${className}`}><div ref={layerRef} className="swap-layer">{children}</div></div>;
}

function NowPlaying({ current, next, previous, playing, source, togglePlayback, nextTrack, previousTrack, progressBar, onOpenTv }) {
  // Un clic sur le lecteur ouvre le mode TV, sauf sur ses commandes (boutons, barre de progression).
  // Le chemin du clic est lu tel qu’il était à l’appui : l’icône du bouton Lecture/Pause est remplacée aussitôt,
  // et sans cela le clic sur le bouton ouvrait aussi le mode TV.
  const openTv = (event) => { if (!event.composedPath().some((node) => node.matches?.('button, .progress, input, a'))) onOpenTv(); };
  return <section className={current ? 'now-playing opens-tv' : 'now-playing idle opens-tv'} onClick={openTv} title={tx("Ouvrir le mode TV")}>
    <button type="button" className="tv-open-hint" onClick={onOpenTv}><Maximize2 size={14} />{tx("Mode TV")}</button>
    {current?.cover && <CoverGlow cover={current.cover} />}
    <div className="now-cover"><TrackCover track={current} className="now-cover-image" iconSize={34} size={500} fade /></div>
    <div className="now-info">
      <div className="now-label"><Equalizer playing={playing && Boolean(current)} />{!current ? tx("LECTURE") : playing ? tx("EN LECTURE") : tx("EN PAUSE")}</div>
      <SwapText swapKey={trackKey(current)} backKey={previous && trackKey(previous)}><h2>{current?.title || tx("Aucun titre en cours")}</h2>
      <p>{current ? <>{current.artist}{current.album && <span className="now-album"><span>•</span>{current.album}</span>}</> : next ? (next.fromFallback ? tx("Lancez la musique de fond.") : tx("Lancez le premier titre de la file.")) : tx("Ajoutez un titre pour commencer.")}</p></SwapText>
      {current?.addedBy && <div className="now-meta">{current.fromFallback ? <span className="fallback-badge"><Repeat size={13} /></span> : <Avatar name={current.addedBy} />}{current.fromFallback ? tx("Musique de fond · {0}", current.addedBy) : tx("Proposé par {0}", current.addedBy)}{source && <span className="source-chip"><ProviderLogo provider={source} size={14} />{tx("Sur {0}", source)}</span>}</div>}
    </div>
    <div className="player-controls">
      <IconButton label={tx("Revenir au titre précédent")} className="skip-button" disabled={!previous} title={previous ? tx("Revenir à « {0} »", previous.title) : tx("Aucun titre précédent")} onClick={previousTrack}><SkipBack size={22} /></IconButton>
      <IconButton label={playing ? tx("Mettre en pause") : tx("Reprendre la lecture")} className="play-button" disabled={!current && !next} onClick={togglePlayback}><span key={playing ? "pause" : "lecture"} className="icon-swap">{playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}</span></IconButton>
      <IconButton label={tx("Passer au titre suivant")} className="skip-button" disabled={!next} onClick={nextTrack}><SkipForward size={22} /></IconButton>
    </div>
    {current && progressBar}
    {next && <div className="up-next"><span>{tx("Ensuite")}</span><p>{`${next.title} · ${next.artist}`}</p></div>}
  </section>;
}

// Reclasser au doigt : rester appuyé sur une ligne la soulève, puis elle suit le doigt et les autres s’écartent.
// Un glissement immédiat reste un simple défilement de la page.
function useTouchReorder(onDrop, enabled) {
  // La liste peut apparaître plus tard (file d’abord vide) : les gestes s’y branchent à ce moment-là.
  const [list, listRef] = useState(null);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;
  useEffect(() => {
    if (!list || !enabled) return undefined;
    let timer = null;
    let start = null;
    let active = null;
    let scroller = null;
    let frame = 0;
    const place = (clientY) => {
      const moved = clientY + window.scrollY - active.startY;
      active.row.style.transform = `translate3d(0, ${moved}px, 0) scale(1.02)`;
      const center = active.rects[active.from].top + active.rects[active.from].height / 2 + moved;
      let to = active.rects.findIndex((rect) => center >= rect.top && center < rect.bottom);
      if (to < 0) to = center < active.rects[0].top ? 0 : active.rects.length - 1;
      active.to = to;
      const height = active.rects[active.from].height + (active.rects[1] ? active.rects[1].top - active.rects[0].bottom : 0);
      active.all.forEach((other, index) => {
        if (index === active.from) return;
        const shift = index > active.from && index <= to ? -height : index < active.from && index >= to ? height : 0;
        other.style.transform = shift ? `translate3d(0, ${shift}px, 0)` : '';
      });
    };
    const lift = (row, y) => {
      const all = [...list.querySelectorAll('[data-reorder]')];
      const rects = all.map((item) => { const rect = item.getBoundingClientRect(); return { top: rect.top + window.scrollY, bottom: rect.bottom + window.scrollY, height: rect.height }; });
      active = { row, all, rects, from: all.indexOf(row), to: all.indexOf(row), startY: y + window.scrollY, y };
      row.classList.add('touch-lifted');
      list.classList.add('is-reordering');
      place(y);
      // Près du haut ou du bas de l’écran, la page défile toute seule.
      scroller = window.setInterval(() => {
        const margin = 90;
        const speed = active.y < margin ? -7 : active.y > window.innerHeight - margin ? 7 : 0;
        if (speed) { window.scrollBy(0, speed); place(active.y); }
      }, 16);
    };
    const cancel = () => { window.clearTimeout(timer); timer = null; start = null; };
    const onStart = (event) => {
      const row = event.target.closest?.('[data-reorder]');
      if (!row || event.touches.length !== 1 || event.target.closest('button, a, input')) return;
      start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      timer = window.setTimeout(() => lift(row, start.y), 260);
    };
    const onMove = (event) => {
      if (active) {
        event.preventDefault();
        active.y = event.touches[0].clientY;
        // Au plus une mise à jour par image : le déplacement suit l’écran sans à-coups.
        if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (active) place(active.y); });
      } else if (start && Math.hypot(event.touches[0].clientX - start.x, event.touches[0].clientY - start.y) > 8) cancel();
    };
    const onEnd = () => {
      cancel();
      if (!active) return;
      window.clearInterval(scroller);
      const { row, all, from, to, rects } = active;
      active = null;
      row.classList.replace('touch-lifted', 'touch-settling');
      row.style.transform = `translate3d(0, ${rects[to].top - rects[from].top}px, 0)`;
      window.setTimeout(() => {
        // Tout se fait avant la prochaine image : le nouvel ordre s’affiche en même temps que les décalages disparaissent.
        all.forEach((item) => { item.style.transition = 'none'; });
        if (to !== from) flushSync(() => dropRef.current(from, to));
        all.forEach((item) => { item.style.transform = ''; });
        list.classList.remove('is-reordering');
        row.classList.remove('touch-settling');
        void list.offsetHeight;
        all.forEach((item) => { item.style.transition = ''; });
      }, 200);
    };
    // À la souris, pas besoin d’attendre : le titre se soulève dès qu’il bouge de quelques pixels.
    let press = null;
    const onMouseMove = (event) => {
      if (active) {
        active.y = event.clientY;
        if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (active) place(active.y); });
      } else if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4) lift(press.row, press.y);
    };
    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      press = null;
      onEnd();
    };
    const onMouseDown = (event) => {
      const row = event.button === 0 && event.target.closest?.('[data-reorder]');
      if (!row || event.target.closest('button, a, input')) return;
      event.preventDefault();
      press = { row, x: event.clientX, y: event.clientY };
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    };
    list.addEventListener('mousedown', onMouseDown);
    list.addEventListener('touchstart', onStart, { passive: true });
    list.addEventListener('touchmove', onMove, { passive: false });
    list.addEventListener('touchend', onEnd);
    list.addEventListener('touchcancel', onEnd);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(scroller);
      list.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      list.removeEventListener('touchstart', onStart);
      list.removeEventListener('touchmove', onMove);
      list.removeEventListener('touchend', onEnd);
      list.removeEventListener('touchcancel', onEnd);
    };
  }, [list, enabled]);
  return [listRef, list];
}

// Quand une liste change (titre ajouté, retiré, déplacé) : chaque ligne glisse vers sa place, une nouvelle apparaît, une retirée s’efface.
function useListMotion(list, keys, skip) {
  const positions = useRef(new Map());
  const lastList = useRef(null);
  const mountedAt = useRef(Date.now());
  useLayoutEffect(() => {
    if (!list) return;
    const fresh = lastList.current !== list;
    if (fresh) { lastList.current = list; positions.current = new Map(); }
    const next = new Map();
    const animate = !skip.current && !reducedMotion();
    // Une liste qui réapparaît longtemps après l’ouverture de la page : son premier titre vient d’être ajouté.
    const entering = positions.current.size > 0 || (fresh && Date.now() - mountedAt.current > 1500);
    for (const row of list.querySelectorAll('[data-track]')) {
      const id = row.dataset.track;
      const top = row.offsetTop;
      next.set(id, { top, row });
      if (!animate) continue;
      const before = positions.current.get(id);
      if (!before) { if (entering) row.animate([{ opacity: 0, transform: 'translate3d(0, 10px, 0) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' }); }
      else if (before.top !== top) row.animate([{ transform: `translate3d(0, ${before.top - top}px, 0)` }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.32, .72, 0, 1)' });
    }
    if (animate) for (const [id, { top, row }] of positions.current) {
      if (next.has(id)) continue;
      const ghost = row.cloneNode(true);
      ['data-track', 'data-reorder', 'draggable'].forEach((name) => ghost.removeAttribute(name));
      ghost.classList.add('row-ghost');
      ghost.style.top = `${top}px`;
      list.append(ghost);
      ghost.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(.97)' }], { duration: 180, easing: 'ease-out', fill: 'forwards' }).onfinish = () => ghost.remove();
    }
    skip.current = false;
    positions.current = next;
  }, [keys, list]);
}

// À la fermeture d’une fenêtre ou d’un message : une copie s’efface à sa place, sans retarder la suite.
function useExitGhost(animateExit) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const element = ref.current;
    return () => {
      if (!element?.isConnected || reducedMotion()) return;
      const ghost = element.cloneNode(true);
      ghost.style.pointerEvents = 'none';
      ghost.setAttribute('aria-hidden', 'true');
      element.after(ghost);
      animateExit(ghost).onfinish = () => ghost.remove();
    };
  }, []);
  return ref;
}

const QueueList = memo(function QueueList({ queue, host, fallback, onRemove, onReorder, onBrowse }) {
  const skipFlip = useRef(false);
  const [reorderRef, listElement] = useTouchReorder((from, to) => { skipFlip.current = true; onReorder(from, to); }, Boolean(host && onReorder));
  useListMotion(listElement, queue.map((track) => track.id).join(','), skipFlip);

  if (!queue.length && fallback) return <p className="queue-empty-inline">{host ? tx("Aucun titre proposé pour l’instant. Les titres ajoutés passeront avant la musique de fond.") : tx("Aucun titre proposé : ajoutez-en un, il passera avant la musique de fond.")}</p>;
  if (!queue.length) return <div className="empty-state">
    <span><Music2 size={26} /></span>
    <h3>{tx("La file est vide")}</h3>
    <p>{fallback ? tx("En attendant vos titres, « {0} » prend le relais.", fallback.name) : host ? tx("Partagez le code QR ou ajoutez vous-même un premier titre.") : tx("Soyez le premier à proposer un titre !")}</p>
    {onBrowse && <button className="button secondary" onClick={onBrowse}><Search size={16} />{tx("Parcourir le catalogue")}</button>}
  </div>;

  return <div ref={reorderRef} className={host ? 'queue-list is-host' : 'queue-list is-guest'}>
    {queue.map((track, index) => {
      const classes = ['queue-item', index === 0 && 'is-next'].filter(Boolean).join(' ');
      return <article key={track.id} className={classes} data-track={track.id} data-reorder={host ? '' : undefined}>
        {host && <span className="drag-handle" aria-hidden="true"><GripVertical size={16} /></span>}
        {host && <span className="track-number">{index + 1}</span>}
        <TrackCover track={track} />
        <div className="track-main"><strong>{track.title}</strong><span>{track.artist}</span></div>
        {host && <span className="track-album">{track.album || '—'}</span>}
        <span className="added-by" title={tx("Proposé par {0}", track.addedBy)}><Avatar name={track.addedBy} /><span>{track.addedBy}</span></span>
        <span className="track-duration">{track.duration || '—:—'}</span>
        {host && <div className="track-actions">
          <IconButton label={tx("Retirer {0}", track.title)} className="remove-action" onClick={() => onRemove(track)}><Trash2 size={16} /></IconButton>
        </div>}
      </article>;
    })}
  </div>;
});

function SearchPanel({ addTrack, compact = false, source, showSource = false, onConnect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [added, setAdded] = useState([]);
  const [pending, setPending] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!query.trim() || !source) { setResults([]); setError(''); setLoading(false); return () => { cancelled = true; }; }
    const timer = window.setTimeout(async () => {
      setLoading(true); setError('');
      try {
        const tracks = await searchProvider(source, query.trim());
        if (!cancelled) setResults(tracks);
      } catch (error) { if (!cancelled) { setResults([]); setError(error.message || tx("La recherche est momentanément indisponible.")); } }
      finally { if (!cancelled) setLoading(false); }
    }, 350);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, source]);

  if (!source) return <div className={`search-panel ${compact ? 'compact' : ''}`}>
    {!compact && <div className="search-title"><div className="modal-symbol lime"><Music2 size={22} /></div><div><h2>{tx("Ajouter un titre")}</h2></div></div>}
    <div className="search-empty no-source">
      <span className="logo-pair"><ProviderLogo provider="Apple Music" size={34} /><ProviderLogo provider="Deezer" size={34} /></span>
      <strong>{tx("Aucune app de lecture connectée")}</strong>
      <span>{onConnect ? tx("Connectez Apple Music ou Deezer pour chercher et lancer des titres.") : tx("L’hôte doit d’abord connecter Apple Music ou Deezer.")}</span>
      {onConnect && <button type="button" className="button primary" onClick={onConnect}><Link2 size={16} />{tx("Connecter une app")}</button>}
    </div>
  </div>;

  const add = async (track) => {
    setPending(track.id);
    if (await addTrack(track)) setAdded((ids) => [...ids, track.id]);
    setPending(null);
  };

  return <div className={`search-panel ${compact ? 'compact' : ''}`}>
    {!compact && <div className="search-title"><div className="modal-symbol lime"><Music2 size={22} /></div><div><h2>{tx("Ajouter un titre")}</h2><p>{tx("Le titre rejoindra la fin de la file.")}</p></div></div>}
    <label className="search-input"><Search size={19} /><input autoFocus={!compact} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tx("Titre, artiste ou album…")} aria-label={tx("Rechercher un titre")} enterKeyHint="search" />{loading && <LoaderCircle className="spin" size={18} />}{query && !loading && <button type="button" aria-label={tx("Effacer la recherche")} onClick={() => setQuery('')}><X size={17} /></button>}</label>
    {showSource && <p className="search-source-label"><ProviderLogo provider={source} size={16} />{tx("Recherche sur")} <strong>{source}</strong></p>}
    {error && <div className="inline-error" role="alert"><CircleAlert size={16} />{error}</div>}
    {!loading && !error && !query && <div className="search-empty"><Search size={26} /><strong>{showSource ? tx("Rechercher sur {0}", source) : tx("Rechercher un titre")}</strong><span>{tx("Tapez le nom d’un titre, d’un artiste ou d’un album.")}</span></div>}
    {!loading && !error && query && results.length === 0 && <div className="search-empty"><Disc3 size={26} /><strong>{tx("Aucun titre trouvé")}</strong><span>{tx("Essayez une autre orthographe ou une autre source.")}</span></div>}
    {loading && <div className="search-results" aria-hidden="true">{[0, 1, 2, 3].map((item) => <div className="search-skeleton" key={item}><i /><span><b /><b /></span></div>)}</div>}
    {!loading && results.length > 0 && <div className="search-results">{results.map((track) => {
      const isAdded = added.includes(track.id);
      return <div className={isAdded ? 'search-result added' : 'search-result'} key={track.id}>
        <TrackCover track={track} />
        <div><strong>{track.title}</strong><span>{[track.artist, track.album].filter(Boolean).join(' · ')}</span></div>
        <span className="result-duration">{track.duration}</span>
        <button type="button" aria-label={tx("Ajouter {0}", track.title)} className={isAdded ? 'added' : ''} disabled={isAdded || pending === track.id} onClick={() => add(track)}>{pending === track.id ? <LoaderCircle className="spin" size={17} /> : isAdded ? <Check size={18} /> : <Plus size={19} />}</button>
      </div>;
    })}</div>}
  </div>;
}

function GuestView({ admin, control, session, queue, fallbackQueue, current, playing, live, addTrack, name, onLeave, toast, closeToast }) {
  const [tab, setTab] = useState('search');
  const [removing, setRemoving] = useState(null);
  const people = (session.participants || []).length;
  return <div className="guest-shell" data-live={live}>
    <header className="guest-header">
      <Brand />
      <div className="guest-header-actions">
        {!live && <span className="guest-badge offline"><span className="live-dot offline" />{tx("Reconnexion…")}</span>}
        <button type="button" className="icon-button guest-leave" onClick={onLeave} aria-label={tx("Quitter la session")} title={tx("Quitter la session")}><LogOut size={18} /></button>
      </div>
    </header>
    <main className="guest-main">
      <section className="guest-welcome">
        <h1>{session.name}</h1>
        <p><Avatar name={name} /><span>{tx("Vous êtes")} <strong>{name}</strong>{people > 1 ? tx(" · {0} personnes", people) : ''}</span></p>
      </section>
      {admin && <section className={session.hostOnline === false ? 'admin-card alert' : 'admin-card'} aria-label="Admin">
        <span className="admin-card-icon"><ShieldCheck size={20} /></span>
        <div>
          <strong>{session.hostOnline === false ? tx("L’hôte est absent") : tx("Vous êtes admin")}</strong>
          <p>{session.hostOnline === false ? tx("Vous gardez les commandes : la lecture, les nouveaux arrivants et la file d’attente.") : tx("Vous gérez la lecture, les nouveaux arrivants et la file d’attente.")}</p>
        </div>
      </section>}
      {control && control.requests.length > 0 && <JoinRequests requests={control.requests} onDecide={control.onDecide} />}
      <div className={current ? 'guest-now' : 'guest-now idle'}>
        {current?.cover && <CoverGlow cover={current.cover} />}
        <TrackCover track={current} iconSize={22} size={250} />
        <div>
          <span className="guest-now-label"><Radio size={13} />{!current ? tx("EN ATTENTE") : playing ? tx("EN CE MOMENT") : tx("EN PAUSE")}</span>
          <strong>{current?.title || tx("Aucun titre en cours")}</strong>
          <p>{current ? current.artist : tx("La musique démarre bientôt.")}</p>
        </div>
        {current && <Equalizer playing={playing} />}
      </div>
      {control && <div className="guest-controls" role="group" aria-label={tx("Commandes de lecture")}>
        <IconButton label={tx("Revenir au titre précédent")} className="skip-button" disabled={!control.canPrevious} onClick={control.onPrevious}><SkipBack size={22} /></IconButton>
        <IconButton label={playing ? tx("Mettre en pause") : tx("Reprendre la lecture")} className="play-button" disabled={!current && !control.canNext} onClick={control.onToggle}><span key={playing ? "pause" : "lecture"} className="icon-swap">{playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}</span></IconButton>
        <IconButton label={tx("Passer au titre suivant")} className="skip-button" disabled={!control.canNext} onClick={control.onNext}><SkipForward size={22} /></IconButton>
      </div>}
      <nav className="guest-tabs" aria-label={tx("Affichage")}>
        <button className={tab === 'search' ? 'active' : ''} aria-pressed={tab === 'search'} onClick={() => setTab('search')}><Search size={17} />{tx("Proposer")}</button>
        <button className={tab === 'queue' ? 'active' : ''} aria-pressed={tab === 'queue'} onClick={() => setTab('queue')}><ListMusic size={17} />{tx("La file")} <span>{queue.length}</span></button>
      </nav>
      {tab === 'search' ? <SearchPanel compact source={session.source} showSource={(session.apps || []).length > 1} addTrack={addTrack} /> : <div className="guest-queue">
        {session.fallback && <QueueGroupLabel title={tx("Proposés par les invités")} count={queue.length} />}
        <QueueList queue={queue} host={Boolean(control)} fallback={session.fallback} onRemove={control ? setRemoving : undefined} onReorder={control?.onReorder} onBrowse={control ? () => setTab('search') : undefined} />
        {session.fallback && <><QueueGroupLabel title={tx("Musique de fond · {0}", session.fallback.name)} count={fallbackQueue?.total || 0} fallback /><FallbackList tracks={fallbackQueue?.tracks || []} total={fallbackQueue?.total || 0} host={Boolean(control)} startIndex={queue.length} onSkip={control?.onSkipFallback} onMove={control?.onMoveFallback} sessionCode={session.code} headers={control?.headers} /></>}
      </div>}
    </main>
    {removing && <Modal onClose={() => setRemoving(null)} className="confirm-modal">
      <div className="modal-symbol danger"><Trash2 size={22} /></div>
      <h2>{tx("Retirer ce titre ?")}</h2>
      <div className="confirm-track"><TrackCover track={removing} /><div><strong>{removing.title}</strong><span>{removing.artist}</span></div></div>
      <div className="modal-actions"><button className="button secondary" onClick={() => setRemoving(null)}>{tx("Annuler")}</button><button className="button danger-button" onClick={() => { control.onRemoveTrack(removing.id); setRemoving(null); }}>{tx("Retirer de la file")}</button></div>
    </Modal>}
    {toast && <Toast toast={toast} onClose={closeToast} />}
  </div>;
}

function HomeView({ initialTab, onCreate, resumeCode, onResume, guestName, onConfirmName, toast, closeToast }) {
  const [tab, setTab] = useState(initialTab);
  return <div className="guest-shell home-shell">
    <main className="home-main">
      <section className="home-hero">
        <h1 aria-label="Sono"><Brand /></h1>
        <p>{tx("Créez une file d’attente commune pour votre soirée, ou rejoignez celle d’un proche.")}</p>
      </section>
      <div className="home-choice" role="group" aria-label={tx("Que voulez-vous faire ?")}>
        <button type="button" className={tab === 'create' ? 'active' : ''} aria-pressed={tab === 'create'} onClick={() => setTab('create')}>
          <span className="choice-icon"><Radio size={20} /></span><span><strong>{tx("Créer une session")}</strong><small>{tx("Vous êtes l’hôte de la soirée")}</small></span>
        </button>
        <button type="button" className={tab === 'join' ? 'active' : ''} aria-pressed={tab === 'join'} onClick={() => setTab('join')}>
          <span className="choice-icon"><UsersRound size={20} /></span><span><strong>{tx("Rejoindre une session")}</strong><small>{tx("Avec le code de l’hôte")}</small></span>
        </button>
      </div>
      <div className="home-panel">{tab === 'create' ? <CreateForm onCreate={onCreate} defaultHost={guestName} /> : <JoinForm guestName={guestName} onConfirmName={onConfirmName} />}</div>
      {resumeCode && <button type="button" className="text-button resume-link" onClick={() => onResume(resumeCode)}>{tx("Reprendre ma session")} {resumeCode}<ArrowRight size={14} /></button>}
    </main>
    {toast && <Toast toast={toast} onClose={closeToast} />}
  </div>;
}

function ApprovalSwitch({ checked, onChange, description }) {
  return <label className="switch-row">
    <span><strong>{tx("Valider les nouveaux invités")}</strong><small>{description}</small></span>
    <input type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} />
  </label>;
}

function CreateForm({ onCreate, defaultHost }) {
  const [name, setName] = useState('');
  const [host, setHost] = useState(defaultHost || '');
  const [requireApproval, setRequireApproval] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    if (!name.trim()) return setError(tx("Donnez un nom à votre session."));
    setBusy(true);
    setError('');
    try { await onCreate({ name: name.trim(), host: host.trim(), requireApproval }); }
    catch (requestError) { setError(requestError.message); setBusy(false); }
  };
  return <form className="home-form" onSubmit={submit} noValidate>
    <label>{tx("Nom de la session")}<input autoFocus value={name} maxLength={80} onChange={(event) => { setName(event.target.value); setError(''); }} placeholder={tx("Ex. Anniversaire de Léa")} /></label>
    <label>{tx("Votre prénom")}<input value={host} maxLength={30} onChange={(event) => setHost(event.target.value)} placeholder={tx("Affiché à vos invités")} autoComplete="given-name" /></label>
    <ApprovalSwitch checked={requireApproval} onChange={setRequireApproval} description={tx("Vous acceptez ou refusez chaque personne qui veut entrer.")} />
    {error && <p className="field-error" role="alert">{error}</p>}
    <button className="button primary join-button" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <Plus size={18} />}{tx("Créer la session")}</button>
  </form>;
}

// Lien d’invitation collé : une session hébergée ailleurs (ordinateur, autre service). Renvoie son adresse propre.
function inviteAddress(value) {
  const text = value.trim();
  if (!text) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    const digits = url.pathname.match(/^\/(\d{4})\/?$/)?.[1] || url.searchParams.get('invitation')?.match(/^SONO-(\d{4})$/i)?.[1];
    return digits && /^https?:$/.test(url.protocol) ? `${url.origin}/${digits}` : null;
  } catch { return null; }
}
const openInvite = (address, name) => { window.location.assign(`${address}#prenom=${encodeURIComponent(name)}`); };

function JoinForm({ guestName, onConfirmName }) {
  const [name, setName] = useState(guestName || '');
  const [link, setLink] = useState('');
  const [digits, setDigits] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    if (!name.trim()) return setError(tx("Indiquez votre prénom pour que l’hôte vous reconnaisse."));
    if (link.trim()) {
      const address = inviteAddress(link);
      if (!address) return setError(tx("Ce lien d’invitation n’est pas valide. Copiez-le depuis la page de l’hôte."));
      onConfirmName(name);
      return openInvite(address, name.trim());
    }
    if (digits.length !== 4) return setError(tx("Le code contient 4 chiffres, par exemple SONO-4821."));
    const code = `SONO-${digits}`;
    setBusy(true);
    setError('');
    try {
      await apiRequest(`/api/sessions/${code}`);
      onConfirmName(name);
      window.location.assign(`/${code.replace(/^SONO-/, '')}`);
    } catch (requestError) {
      // Pas sur cet ordinateur : la session a peut-être été créée depuis l’app iPhone.
      const elsewhere = requestError.status === 404 && window.sonoDesktop ? await apiRequest(`/api/join/lookup?code=${code}`).catch(() => null) : null;
      if (elsewhere?.url) { onConfirmName(name); openInvite(elsewhere.url, name.trim()); return; }
      setError(requestError.status === 404 ? tx("Aucune session ne correspond à ce code. Si elle est hébergée sur un autre ordinateur, collez son lien d’invitation.") : requestError.message);
      setBusy(false);
    }
  };
  return <form className="home-form" onSubmit={submit} noValidate>
    <label>{tx("Votre prénom")}<input value={name} maxLength={30} onChange={(event) => { setName(event.target.value); setError(''); }} placeholder={tx("Pour que l’hôte vous reconnaisse")} autoComplete="given-name" /></label>
    <p className="form-note">{tx("Il ne pourra plus être modifié une fois dans la session.")}</p>
    <span className="form-label">{tx("Code affiché par l’hôte")}</span>
    <label className={error ? 'code-input invalid' : 'code-input'}>
      <span aria-hidden="true">SONO-</span>
      <input value={digits} onChange={(event) => { setDigits(event.target.value.replace(/\D/g, '').slice(-4)); setError(''); }} inputMode="numeric" autoComplete="off" placeholder="0000" aria-label={tx("Code de la session")} aria-invalid={Boolean(error)} />
    </label>
    {window.sonoDesktop && <label className="join-link">{tx("Session sur un autre appareil ? Lien d’invitation")}<input value={link} type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(event) => { setLink(event.target.value); setError(''); }} placeholder="https://…" autoComplete="off" /></label>}
    {error && <p className="field-error" role="alert">{error}</p>}
    <button className="button primary join-button" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <ArrowRight size={18} />}{tx("Rejoindre")}</button>
    <p className="join-hint"><QrCode size={16} />{tx("Vous avez le code QR ? Scannez-le simplement avec l’appareil photo.")}</p>
  </form>;
}

// iPhone ou iPad dans un navigateur (pas dans la page ouverte par l’app Sono elle-même) : un lien propose
// d’ouvrir la session dans l’app Sono, si elle est installée.
const appleMobile = typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const openInAppLink = (code) => (appleMobile && /Safari\//.test(navigator.userAgent) ? `sono://open?url=${encodeURIComponent(`${window.location.origin}/${String(code).replace(/^SONO-/, '')}`)}` : null);

function NameGate({ session, onConfirm, toast, closeToast }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const submit = (event) => {
    event.preventDefault();
    if (!name.trim()) return setError(tx("Indiquez votre prénom pour que l’hôte vous reconnaisse."));
    onConfirm(name);
  };
  return <div className="guest-shell">
    <header className="guest-header"><Brand /></header>
    <main className="join-main">
      <form className="join-card" onSubmit={submit} noValidate>
        <div className="modal-symbol lime"><UserRound size={22} /></div>
        <span className="guest-kicker">{tx("Invitation de")} {session.host}</span>
        <h1>{session.name}</h1>
        <p>{tx("Comment vous appelez-vous ? Votre prénom s’affichera à côté des titres que vous proposez.")}</p>
        <label className="waiting-name">{tx("Votre prénom")}<input autoFocus value={name} maxLength={30} onChange={(event) => { setName(event.target.value); setError(''); }} placeholder={tx("Ex. Léa")} autoComplete="given-name" /></label>
        <p className="form-note">{tx("Il ne pourra plus être modifié une fois dans la session.")}</p>
        {error && <p className="field-error" role="alert">{error}</p>}
        <button className="button primary join-button" type="submit">{session.requireApproval ? <ShieldCheck size={18} /> : <ArrowRight size={18} />}{session.requireApproval ? tx("Demander l’accès") : tx("Rejoindre la session")}</button>
        {openInAppLink(session.code) && <a className="open-in-app" href={openInAppLink(session.code)}><Smartphone size={15} />{tx("Ouvrir dans l’app Sono")}</a>}
      </form>
    </main>
    {toast && <Toast toast={toast} onClose={closeToast} />}
  </div>;
}

function WaitingView({ session, admission, live, name, onRetry, toast, closeToast }) {
  const removed = admission === 'removed';
  const refused = admission === 'refused' || removed;
  return <div className="guest-shell" data-live={live}>
    <header className="guest-header"><Brand />{!live && <span className="guest-badge offline"><span className="live-dot offline" />{tx("Reconnexion…")}</span>}</header>
    <main className="join-main">
      <div className="join-card waiting-card">
        <div className={refused ? 'modal-symbol danger' : 'modal-symbol lime'}>{refused ? <X size={22} /> : <LoaderCircle className="spin" size={22} />}</div>
        <h1>{removed ? tx("Retiré de la session") : refused ? tx("Demande refusée") : tx("Demande envoyée")}</h1>
        <p>{removed ? tx("{0} vous a retiré de « {1} ». Vous pouvez lui demander à revenir.", session.host, session.name) : refused ? tx("{0} n’a pas accepté votre demande pour « {1} ».", session.host, session.name) : tx("{0} doit accepter votre arrivée dans « {1} ».", session.host, session.name)}</p>
        <div className="guest-name waiting-identity"><Avatar name={name} /><span>{tx("Vous êtes")} <strong>{name}</strong></span></div>
        {refused
          ? <button className="button primary join-button" onClick={onRetry}>{removed ? tx("Demander à revenir") : tx("Renvoyer une demande")}</button>
          : <p className="join-hint"><Clock3 size={16} />{tx("Cette page s’ouvrira toute seule dès que l’hôte aura accepté.")}</p>}
      </div>
    </main>
    {toast && <Toast toast={toast} onClose={closeToast} />}
  </div>;
}

// Même bandeau que les demandes d’accès, pour les arrivées quand aucune validation n’est demandée.
function JoinNotices({ notices, onDismiss, onRemove }) {
  return <section className="join-requests" aria-label={tx("Nouveaux invités")}>
    <div className="join-requests-head"><UserPlus size={16} /><strong>{notices.length > 1 ? tx("{0} personnes ont rejoint la session", notices.length) : tx("Quelqu’un a rejoint la session")}</strong></div>
    <ul>{notices.map((notice) => <li key={notice.id}>
      <Avatar name={notice.name} />
      <div><strong>{notice.name}</strong><small>{tx("vient d’arriver")}</small></div>
      {onRemove && <button type="button" className="button secondary" aria-label={tx("Retirer {0} de la session", notice.name)} onClick={() => onRemove(notice)}><UserMinus size={15} /><span>{tx("Retirer")}</span></button>}
      <button type="button" className="button primary" aria-label={tx("Fermer l’arrivée de {0}", notice.name)} onClick={() => onDismiss(notice.id)}><Check size={15} /><span>OK</span></button>
    </li>)}</ul>
  </section>;
}

function JoinRequests({ requests, onDecide }) {
  return <section className="join-requests" aria-label={tx("Demandes pour rejoindre la session")}>
    <div className="join-requests-head"><ShieldCheck size={16} /><strong>{requests.length > 1 ? tx("{0} personnes veulent rejoindre", requests.length) : tx("Quelqu’un veut rejoindre")}</strong></div>
    <ul>{requests.map((request) => <li key={request.id}>
      <Avatar name={request.name} />
      <div><strong>{request.name}</strong><small>{sinceLabel(request.since)}</small></div>
      <button type="button" className="button secondary" aria-label={tx("Refuser {0}", request.name)} onClick={() => onDecide(request, 'refuse')}><X size={15} /><span>{tx("Refuser")}</span></button>
      <button type="button" className="button primary" aria-label={tx("Accepter {0}", request.name)} onClick={() => onDecide(request, 'accept')}><Check size={15} /><span>{tx("Accepter")}</span></button>
    </li>)}</ul>
  </section>;
}

function QueueGroupLabel({ title, count, fallback = false }) {
  return <div className={fallback ? 'queue-group fallback' : 'queue-group'}>{fallback ? <Repeat size={14} /> : <UsersRound size={14} />}<span>{title}</span><span className="count-pill">{count}</span></div>;
}

// Les titres de la musique de fond à venir, sous les titres proposés : toute la playlist est consultable.
const FallbackList = memo(function FallbackList({ tracks, total, host, startIndex, onSkip, onMove: moveTrack, sessionCode, headers }) {
  const onMove = moveTrack && ((track, to) => { setAll((list) => list && moveItem(list, track, to)); moveTrack(track, to); });
  const skipFlip = useRef(false);
  const [reorderRef, listElement] = useTouchReorder((from, to) => { skipFlip.current = true; onMove(visibleRef.current[from], to); }, Boolean(host && moveTrack));
  const visibleRef = useRef([]);
  const [limit, setLimit] = useState(10);
  const [all, setAll] = useState(null);
  const [loading, setLoading] = useState(false);
  const needsAll = limit > tracks.length && total > tracks.length;
  useEffect(() => {
    if (!needsAll) { setAll(null); return undefined; }
    let cancelled = false;
    setLoading(true);
    apiRequest(`/api/sessions/${sessionCode}/fallback/upcoming`, { headers })
      .then((data) => { if (!cancelled) setAll(data.tracks); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [needsAll, total, sessionCode]);
  const items = (needsAll && all) || tracks;
  const visible = items.slice(0, limit);
  const remaining = total - visible.length;
  visibleRef.current = visible;
  useListMotion(listElement, visible.map((track) => track.id).join(','), skipFlip);
  return <div ref={reorderRef} className={host ? 'queue-list fallback-list is-host' : 'queue-list fallback-list is-guest'}>
    {visible.map((track, index) => <article key={track.id} data-track={track.id} data-reorder={host && onMove ? '' : undefined}
      className={['queue-item is-fallback', startIndex === 0 && index === 0 && 'is-next'].filter(Boolean).join(' ')}>
      {host && <span className="drag-handle" aria-hidden="true"><GripVertical size={16} /></span>}
      {host && <span className="track-number">{startIndex + index + 1}</span>}
      <TrackCover track={track} />
      <div className="track-main"><strong>{track.title}</strong><span>{track.artist}</span></div>
      {host && <span className="track-album">{track.album || '—'}</span>}
      <span className="added-by fallback-by" title={tx("Musique de fond")}><span className="fallback-badge"><Repeat size={12} /></span><span>{tx("Fond")}</span></span>
      <span className="track-duration">{track.durationMs ? formatDuration(track.durationMs) : '—:—'}</span>
      {host && <div className="track-actions">
        <IconButton label={tx("Ne pas jouer {0}", track.title)} className="remove-action" onClick={() => onSkip(track)}><X size={16} /></IconButton>
      </div>}
    </article>)}
    {(remaining > 0 || limit > 10) && <div className="fallback-more">
      {remaining > 0 && <button type="button" className="text-button" disabled={loading} onClick={() => setLimit((value) => (value === 10 ? 200 : value + 500))}>{loading && <LoaderCircle className="spin" size={14} />}{tx(remaining > 1 ? 'Afficher plus · {0} titres restants' : 'Afficher plus · {0} titre restant', remaining)}</button>}
      {limit > 10 && <button type="button" className="text-button" onClick={() => setLimit(10)}>{tx("Réduire")}</button>}
    </div>}
  </div>;
});

const FALLBACK_TYPES = { playlist: { label: 'Playlist', plural: 'Playlists', icon: ListMusic }, album: { label: 'Album', plural: 'Albums', icon: Disc3 }, artist: { label: tx("Artiste"), plural: tx("Artistes"), icon: UserRound } };

function FallbackCard({ fallback, source, onChoose, onClear }) {
  if (!fallback) return <button type="button" className="fallback-add" disabled={!source} title={source ? undefined : tx("Connectez d’abord Apple Music ou Deezer")} onClick={onChoose}><Plus size={15} />{tx("Ajouter une musique de fond")}</button>;
  const kind = FALLBACK_TYPES[fallback.type] || FALLBACK_TYPES.playlist;
  return <div className="fallback-row">
    <Repeat size={14} />
    <span className="fallback-row-label">{tx("Musique de fond")}</span>
    <strong title={tx("{0} · {1} titres", kind.label, fallback.count)}>{fallback.name}</strong>
    <button type="button" className="text-button" onClick={onChoose}>{tx("Changer")}</button>
    <IconButton label={tx("Retirer la musique de fond")} onClick={onClear}><X size={15} /></IconButton>
  </div>;
}

function SessionEndedView() {
  return <div className="guest-shell">
    <header className="guest-header"><Brand /></header>
    <main className="join-main">
      <div className="join-card waiting-card">
        <div className="modal-symbol danger"><X size={22} /></div>
        <h1>{tx("Session terminée")}</h1>
        <p>{tx("L’hôte a supprimé cette session. Vous pouvez en rejoindre une autre avec un nouveau code.")}</p>
        <a className="button primary join-button" href="/rejoindre">{tx("Rejoindre une autre session")}</a>
      </div>
    </main>
  </div>;
}

function Modal({ children, onClose, className = '' }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const backdropRef = useExitGhost((ghost) => {
    ghost.querySelector('.modal')?.animate([{ transform: 'none' }, { transform: 'translate3d(0, 24px, 0)' }], { duration: 170, easing: 'ease-in', fill: 'forwards' });
    return ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 170, easing: 'ease-in', fill: 'forwards' });
  });
  useEffect(() => {
    const previous = document.activeElement;
    // Échap ferme la fenêtre ouverte, sans faire sortir l’app du plein écran.
    const handler = (event) => { if (event.key !== 'Escape') return; event.preventDefault(); closeRef.current(); };
    document.addEventListener('keydown', handler);
    document.body.classList.add('modal-open');
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.classList.remove('modal-open');
      previous?.focus?.();
    };
  }, []);
  return <div ref={backdropRef} className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <div className={`modal ${className}`} role="dialog" aria-modal="true">
      <IconButton label={tx("Fermer")} className="modal-close" onClick={onClose}><X size={20} /></IconButton>
      {children}
    </div>
  </div>;
}

// Vue à projeter sur une TV : le titre en cours et le QR code, rien d’autre.
// Deezer et Apple Music acceptent la taille de la pochette dans l’URL : 1400 px pour un grand écran.
// Même pochette à la taille voulue : Deezer et Apple Music en servent de toutes les tailles.
// Une vignette de 44 px n’a aucune raison de télécharger puis décoder une image de 1000 px (97 Ko, 4 Mo en mémoire).
function coverAt(url, size) {
  if (!url) return '';
  return url.replace('{w}', size).replace('{h}', size).replace(/\/\d+x\d+(-000000-\d+-0-0\.jpg)$/, `/${size}x${size}$1`).replace(/\/\d+x\d+bb\.(jpg|webp|png)$/, `/${size}x${size}bb.$1`);
}

// Raccourcis clavier pour qui pilote la musique (hôte ou admin) : Espace = lecture/pause,
// flèche droite ou N = titre suivant, flèche gauche ou P = titre précédent. Ignorés pendant une saisie, une fenêtre
// ouverte, ou quand un bouton a le focus (Espace y garde son rôle habituel).
function useMediaKeys(controls, enabled) {
  const ref = useRef(controls);
  ref.current = controls;
  useEffect(() => {
    if (!enabled) return undefined;
    // Seule la saisie de texte garde ces touches : un bouton, un interrupteur ou la barre cliqués juste avant ne les retiennent pas.
    const typing = (target) => target?.closest('textarea, [contenteditable="true"], input:not([type="checkbox"], [type="radio"], [type="range"], [type="color"], [type="button"], [type="submit"])');
    const actionFor = (key) => {
      const { toggle, next, previous } = ref.current;
      if (key === 'MediaPlayPause' || key === ' ') return toggle;
      if (key === 'MediaTrackNext' || key === 'ArrowRight' || key.toLowerCase() === 'n') return next;
      if (key === 'MediaTrackPrevious' || key === 'ArrowLeft' || key.toLowerCase() === 'p') return previous;
      return null;
    };
    const ignored = (event) => event.metaKey || event.ctrlKey || event.altKey || document.body.classList.contains('modal-open') || typing(event.target instanceof Element ? event.target : null);
    const onKey = (event) => {
      if (ignored(event)) return;
      const action = actionFor(event.key);
      if (!action) return;
      // Avant tout le reste : le bouton ou la barre qui a gardé le focus ne réagit pas à la même touche.
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) action();
    };
    // Le navigateur valide un bouton au relâchement de la barre d’espace.
    const onKeyUp = (event) => {
      if (event.key === ' ' && !ignored(event)) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [enabled]);
}

// Même animation dans les deux sens : la fermeture rejoue l’ouverture à l’envers.
const TV_ZOOM = { duration: 750, easing: 'cubic-bezier(.32, .72, 0, 1)' };
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function Toast({ toast, onClose }) {
  const isError = toast.type === 'error';
  const ref = useExitGhost((ghost) => ghost.animate([{ opacity: 1, transform: 'translate(-50%, 0)' }, { opacity: 0, transform: 'translate(-50%, 10px)' }], { duration: 160, easing: 'ease-in', fill: 'forwards' }));
  return <div ref={ref} key={toast.id} className={`toast ${toast.type}`} role={isError ? 'alert' : 'status'}>
    <span>{isError ? <CircleAlert size={18} /> : <Check size={18} />}</span>
    <p>{txServer(toast.message)}</p>
    <button type="button" aria-label={tx("Fermer la notification")} onClick={onClose}><X size={16} /></button>
  </div>;
}

export default App;

// Utilisés aussi par les parties de l’hôte (host.jsx).
export { ACCENTS, ActivityIcon, ApprovalSwitch, Avatar, BACKGROUNDS, DEFAULT_APPEARANCE, Equalizer, FALLBACK_TYPES, FadeCover, IconButton, Modal, ParticipantList, ProviderLogo, SwapText, TV_ZOOM, Toast, activityTime, apiRequest, coverAt, getAppleMusic, readStorage, reducedMotion, trackKey, useImageMeasure, writeStorage };
