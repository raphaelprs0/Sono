import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, lazy, Suspense } from 'react';
import { tx, txServer, locale, lang, setLang } from './i18n.js';
import {
  ArrowDown, ArrowRight, ArrowUp, Check, CircleAlert, Clock3, Disc3, Airplay, GripVertical, Link2, ListMusic, LoaderCircle, LogOut, Music2, Pause, Play, Plus, QrCode, Radio, Repeat, Search, ShieldCheck, SkipBack, SkipForward, Trash2, UserRound, UsersRound, X,
} from 'lucide-react';
import { flushSync } from 'react-dom';
import appleMusicLogo from './assets/apple-music.webp';
import deezerIcon from './assets/deezer.webp';
import pleinsPharesBackground from './assets/pleins-phares-fond.webp';

// Parties réservées à l’hôte (host.jsx) : chargées à part, jamais sur la page des invités, et préchargées dès que l’hôte est là.
// Une fois chargées, elles s’affichent tout de suite (sans passage à vide qui ferait sauter une fenêtre à l’ouverture).
let hostParts = null;
let hostPartsLoading = null;
export const loadHostParts = () => (hostPartsLoading ??= import('./host.jsx').then((parts) => { hostParts = parts; return parts; }));
const hostPart = (name) => {
  const Lazy = lazy(() => loadHostParts().then((parts) => ({ default: parts[name] })));
  return (props) => {
    const Part = hostParts?.[name];
    return Part ? <Part {...props} /> : <Suspense fallback={null}><Lazy {...props} /></Suspense>;
  };
};
const TvView = hostPart('TvView');


const defaultSession = { name: tx("Session Sono"), code: 'SONO-4821', host: 'Hôte', guests: 0, active: true, source: null };


// ───────────── Apparence (réglages de l’appareil hôte, gardés dans le navigateur) ─────────────
const APPEARANCE_KEY = 'sono-appearance';
const DEFAULT_APPEARANCE = {
  // Thème par défaut : fond noir et accent citron, sans Liquid Glass.
  background: 'black', accent: '#d7f75b', glass: false,
  widgets: { nowPlaying: true, progress: true, queue: true, fallback: true, invite: true, participants: true, stats: false, activity: false },
  // Mode TV : chaque widget est placé dans une zone d’une grille 3 × 3, ou masqué.
  tvPlacement: { cover: 'left', info: 'center', player: 'center', next: 'center', qr: 'right' },
  // Tailles en % de l’espace disponible dans la zone (jamais plus grand que la zone : rien ne se chevauche).
  tvShowAddedBy: true, tvShowQrText: true, tvCoverScale: 100, tvQrScale: 70,
  // Fond du mode TV : la pochette en cours, animée (« cover »), ou un noir uni (« black »).
  tvBackground: 'cover',
};
const BACKGROUNDS = [
  { id: 'default', edges: ['#0f0f0d', '#0f0f0d'], label: tx("Sombre"), css: '#0f0f0d' },
  { id: 'black', edges: ['#000000', '#000000'], label: tx("Noir"), css: '#000000' },
  { id: 'night', edges: ['#0b0f22', '#06070f'], label: tx("Nuit"), css: 'radial-gradient(ellipse at 18% -5%, rgba(64, 86, 190, .55) 0, transparent 55%), radial-gradient(ellipse at 92% 105%, rgba(98, 46, 160, .5) 0, transparent 50%), linear-gradient(180deg, #0b0f22, #06070f)' },
  { id: 'aurora', edges: ['#05080e', '#05080e'], label: tx("Aurore"), css: 'radial-gradient(ellipse at 12% 8%, rgba(26, 196, 150, .42) 0, transparent 50%), radial-gradient(ellipse at 88% 18%, rgba(124, 72, 226, .42) 0, transparent 50%), radial-gradient(ellipse at 50% 115%, rgba(22, 118, 170, .4) 0, transparent 55%), #05080e' },
  { id: 'sunset', edges: ['#170a1d', '#3a1510'], label: tx("Coucher de soleil"), css: 'radial-gradient(ellipse at 50% 125%, rgba(255, 138, 58, .55) 0, transparent 55%), radial-gradient(ellipse at 8% 5%, rgba(150, 40, 118, .5) 0, transparent 50%), linear-gradient(180deg, #170a1d, #2a0e19 60%, #3a1510)' },
  { id: 'ocean', edges: ['#062a40', '#03141f'], label: tx("Océan"), css: 'radial-gradient(ellipse at 82% -5%, rgba(62, 196, 214, .32) 0, transparent 50%), radial-gradient(ellipse at 5% 100%, rgba(20, 90, 140, .45) 0, transparent 55%), linear-gradient(170deg, #062a40, #04354a 45%, #03141f)' },
  // Couleurs des pochettes : « Pleins Phares » (Favé) et « APOCALYPSE » (Gazo).
  // Exactement le rendu du mode « Pochette en cours » avec cette pochette (floutée, saturée, assombrie), calculé une fois.
  { id: 'pleins-phares', edges: ['#262d33', '#262d33'], label: 'Pleins Phares', title: 'Pleins Phares — Favé', css: `#3f4b55 url(${pleinsPharesBackground}) center / cover no-repeat`, image: pleinsPharesBackground },
  { id: 'apocalypse', edges: ['#2a0b10', '#030208'], label: 'Apocalypse', title: 'APOCALYPSE — Gazo', css: 'radial-gradient(ellipse at 18% 28%, rgba(249, 76, 14, .5) 0, transparent 45%), radial-gradient(ellipse at 86% 72%, rgba(163, 36, 24, .55) 0, transparent 50%), radial-gradient(ellipse at 58% 4%, rgba(223, 123, 71, .28) 0, transparent 40%), linear-gradient(180deg, #2a0b10, #120310 60%, #030208)' },
];
// Couleurs d’accent prédéfinies, chacune avec la couleur de texte qui reste la plus lisible posée dessus
// (boutons, lecture en cours), une teinte de survol ajustée à la main et, pour les accents sombres,
// une version plus claire utilisée quand l’accent sert de couleur de texte.
const ACCENTS = [
  { hex: '#d7f75b', label: tx("Citron"), ink: '#171a08', hover: '#e4ff7a' },
  { hex: '#5bf7b0', label: tx("Menthe"), ink: '#062519', hover: '#7dfcc3' },
  { hex: '#5bc8f7', label: tx("Ciel"), ink: '#05212f', hover: '#7dd6fb' },
  { hex: '#a78bfa', label: tx("Lavande"), ink: '#170f30', hover: '#bba3fc', text: '#c9b8fd' },
  { hex: '#f472b6', label: tx("Rose"), ink: '#2d0919', hover: '#f78fc6', text: '#f9a3d0' },
  { hex: '#fb923c', label: 'Orange', ink: '#2a1203', hover: '#fca763' },
  { hex: '#f5f5f4', label: tx("Blanc"), ink: '#151512', hover: '#ffffff' },
  { hex: '#bdd2e9', label: 'Pleins Phares', ink: '#0c1521', hover: '#d3e3f4' },
  { hex: '#f94c0e', label: 'Apocalypse', ink: '#1c0402', hover: '#ff6a33', text: '#ffa27d' },
];

function readAppearance() {
  try { return normalizeAppearance(JSON.parse(localStorage.getItem(APPEARANCE_KEY) || 'null')); } catch { return DEFAULT_APPEARANCE; }
}
function normalizeAppearance(value) {
  try {
    const saved = value && typeof value === 'object' ? { ...value } : null;
    if (!saved) return DEFAULT_APPEARANCE;
    // Couleurs libres retirées : un ancien choix revient aux valeurs prédéfinies.
    if (!ACCENTS.some((item) => item.hex === saved.accent)) saved.accent = DEFAULT_APPEARANCE.accent;
    // Fond inconnu ou retiré (ancien choix) : retour au fond par défaut.
    if (saved.background !== 'cover' && !BACKGROUNDS.some((item) => item.id === saved.background)) saved.background = DEFAULT_APPEARANCE.background;
    delete saved.backgroundImage;
    const widgets = DEFAULT_APPEARANCE.widgets;
    return { ...DEFAULT_APPEARANCE, ...saved, widgets, tvPlacement: DEFAULT_APPEARANCE.tvPlacement, tvCoverScale: DEFAULT_APPEARANCE.tvCoverScale, tvQrScale: DEFAULT_APPEARANCE.tvQrScale };
  } catch { return DEFAULT_APPEARANCE; }
}

function hexToRgb(hex) {
  const value = /^#?([\da-f]{6})$/i.exec(hex)?.[1] || 'd7f75b';
  return [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16));
}

// Couleur d’accent : toutes les nuances (survol, fond doux, texte posé dessus) en découlent.
function applyAccent(hex) {
  const accent = ACCENTS.find((item) => item.hex === hex) || ACCENTS[0];
  const root = document.documentElement.style;
  root.setProperty('--accent-rgb', hexToRgb(accent.hex).join(', '));
  root.setProperty('--lime', accent.hex);
  root.setProperty('--lime-hover', accent.hover);
  root.setProperty('--lime-ink', accent.ink);
  root.setProperty('--lime-text', accent.text || accent.hex);
}

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
          resolve({ shade: 1 - keep, top: row(0), bottom: row(11), palette, blur: smoothBitmap(image, { size: 48, radius: 3 }), smooth: smoothBitmap(image, { size: 96, radius: 5, disc: true }) });
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
  // Pochette en cours : au moins l’assombrissement d’origine (50 %), davantage pour les pochettes claires.
  if (background === 'cover') return <div className={shownCover.current?.cover ? 'app-backdrop blurred has-image' : 'app-backdrop'} style={{ '--shade': Math.max(0.5, shownCover.current?.measure?.shade ?? shade) }} aria-hidden="true">{shownCover.current && <FadeCover className={shownCover.current.measure.blur ? 'soft' : ''} src={shownCover.current.measure.blur || shownCover.current.cover} />}</div>;
  return <div className={preset?.image ? 'app-backdrop has-image' : 'app-backdrop'} style={{ '--photo': preset?.image ? `url(${preset.image})` : undefined, background: preset?.css || 'var(--bg)', backgroundColor: 'var(--edge-bottom)', '--shade': preset?.image ? Math.max(shade, preset.minShade ?? 0) : 0 }} aria-hidden="true" />;
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

// Dans l’app iPhone, window.sonoNative parle au moteur Deezer du téléphone. Le navigateur d’un invité ne l’a pas.
const native = typeof window !== 'undefined' ? window.sonoNative || null : null;

async function searchProvider(source, query) {
  if (source === 'Deezer') {
    const data = await apiRequest(`/api/integrations/opendeezer/search?q=${encodeURIComponent(query)}`);
    const items = data.data || data.results || data.tracks || [];
    return items.map((track) => ({ id: String(track.id), providerId: String(track.id), title: track.title, artist: track.artist?.name || track.artist || tx("Artiste inconnu"), album: track.album?.title || track.album || '', durationMs: track.duration ? track.duration * 1000 : 0, duration: track.duration ? formatDuration(track.duration * 1000) : '—:—', cover: track.album?.cover_xl || track.album?.cover || track.cover || '', source: 'Deezer' }));
  }
  // Apple Music : la recherche part directement de l’appareil (API publique d’iTunes) ; Apple limite les demandes venant des serveurs.
  try {
    const response = await fetch(`https://itunes.apple.com/search?${new URLSearchParams({ term: query, entity: 'song', country: 'fr', limit: '25' })}`);
    if (!response.ok) throw new Error('iTunes');
    const { results } = await response.json();
    return results.filter((track) => track.trackId).map((track) => ({
      id: String(track.trackId), providerId: String(track.trackId), title: track.trackName, artist: track.artistName || tx("Artiste inconnu"), album: track.collectionName || '',
      durationMs: track.trackTimeMillis || 0, duration: formatDuration(track.trackTimeMillis || 0), cover: (track.artworkUrl100 || '').replace('100x100bb', '400x400bb'), source: 'Apple Music',
    }));
  } catch { /* on passe par le service en ligne */ }
  const data = await apiRequest(`/api/integrations/apple/search?q=${encodeURIComponent(query)}`);
  return data.tracks.map((track) => ({ ...track, id: track.providerId, durationMs: track.duration, duration: formatDuration(track.duration), source: 'Apple Music' }));
}

// La session décide, le moteur de l’iPhone de l’hôte suit (voir ios/Sono/Driver.swift). Sur l’iPhone, pause et reprise
// sont appliquées tout de suite, sans attendre l’aller-retour par Internet.
async function controlProvider({ track, action, playing }) {
  if (!track) throw new Error(tx("Aucun titre n’est sélectionné."));
  if (!native) return;
  // Pause et reprise partent tout de suite : le moteur connaît déjà son état.
  if (action === 'toggle') { await native.call('setPlaying', { playing: !playing }); return; }
  const status = await native.call('status');
  if (!status.connected) throw new Error(tx("Connectez votre app de musique dans Connexions pour lancer la musique."));
}

function Brand() {
  return <div className="brand"><span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span><span className="brand-name">sono<span className="brand-dot">.</span></span></div>;
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

// Pochette qui change en fondu : la nouvelle est chargée d’abord, puis apparaît par-dessus l’ancienne.
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
  // Page ouverte par l’app iPhone sur l’écran de la TV (recopie de l’écran) : seulement le mode TV, en grand.
  const tvDisplay = params.get('tv') === '1';
  // Lien court « adresse/1234 » ; l’ancien « ?invitation=SONO-1234 » reste accepté.
  const shortInvite = window.location.pathname.match(/^\/(\d{4})\/?$/)?.[1];
  const invitedCode = params.get('invitation')?.toUpperCase() || (shortInvite ? `SONO-${shortInvite}` : undefined);
  const isGuest = Boolean(invitedCode);
  // Ce site ne sert plus que les invités, la page Rejoindre et l’écran TV de l’app iPhone (qui héberge les sessions).
  const [hostState, setHostState] = useState(() => isGuest ? 'guest' : tvDisplay && readStorage('sono-host-code') ? 'checking' : 'home');
  // Admin : clé personnelle reçue du serveur, qui lui ouvre les commandes.
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
  const [live, setLive] = useState(false);
  const [toast, setToast] = useState(null);
  const [fallbackQueue, setFallbackQueue] = useState(null);
  const [previous, setPrevious] = useState(null);
  const [admission, setAdmission] = useState(null);
  const [ended, setEnded] = useState(false);
  const knownRequests = useRef(null);
  const [appearance] = useState(readAppearance);
  const resumeHostingRef = useRef(() => {});
  const playbackBusyRef = useRef(false);
  const dropUnavailableRef = useRef(() => {});
  const playbackRef = useRef(() => {});
  const preloadedRef = useRef(null);
  const historyRef = useRef([]);
  const skipState = useRef({ delta: 0, timer: 0, active: false, sending: false, toggle: false, watchUntil: 0 });
  // Mode TV ouvert par-dessus le tableau de bord : origin est l’élément d’où il s’agrandit (lecteur ou aperçu des réglages).
  // Position dans le titre en cours (lue sur l’app de lecture), pour la barre de progression.
  const [progress] = useState(createProgressStore);
  const setProgress = progress.set;
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
    setHostState('home');
    notify(tx("Cette session a été supprimée."));
  }, [isGuest, session.code, notify]);

  // Cet appareil a-t-il déjà une session dont il est l’hôte ? Sinon, on affiche l’accueil Créer / Rejoindre.
  useEffect(() => {
    if (hostState !== 'checking') return undefined;
    let cancelled = false;
    const token = readStorage(`sono-host-${session.code}`);
    if (!token) { setHostState('home'); return undefined; }
    apiRequest('/api/host/resume', { method: 'POST', headers: { 'x-host-token': token }, body: JSON.stringify({ code: session.code }) }).then((data) => {
      if (cancelled) return;
      setHostToken(token);
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
    return () => { closed = true; window.clearTimeout(reconnect); socket?.close(); };
  }, [session.code, isGuest, hostState, guestReady, applyPayload, notify, sessionGone]);

  // Détecte la fin du titre en cours sur l’app de lecture pour enchaîner automatiquement.
  const currentId = current?.id;
  // L’hôte pilote la lecture : c’est son téléphone qui joue la musique.
  useEffect(() => {
    if (!native || hostState !== 'host' || !currentId) return undefined;
    let timer = 0;
    let stopped = false;
    const poll = async () => {
      const data = await native.call('status').catch(() => null);
      if (stopped) return;
      const state = skipState.current;
      // Pendant un enchaînement de titres, ou tant que le moteur n’a pas encore changé, sa position concerne l’ancien titre.
      const stale = state.active || (data?.trackId && current?.source === session.source && String(current.providerId) !== String(data.trackId));
      if (!stale && Number.isFinite(data?.positionMs)) setProgress({ positionMs: data.positionMs, durationMs: data.durationMs || 0, at: Date.now(), running: !['loading', 'stopped'].includes(String(data.state).toLowerCase()) });
      // Juste après un changement de titre, on regarde souvent : la barre démarre avec le son.
      timer = window.setTimeout(poll, Date.now() < state.watchUntil ? 200 : 1000);
    };
    poll();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [hostState, currentId]);
  const currentKey = trackKey(current);
  // Une position donnée à l’instant pour ce titre (changement affiché d’avance) reste valable.
  useEffect(() => { setProgress((value) => (Date.now() - value.at < 300 ? value : { positionMs: 0, durationMs: 0, at: Date.now() })); }, [currentKey]);


  // Prochain titre : la file d’abord, puis la musique de fond.
  const nextUp = queue[0] || session.fallback?.next || null;
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
  const look = (!ended && guestTheme) || appearance;
  // Fond « pochette en cours » : la dernière pochette reste en mémoire, pour garder le même décor hors session.
  useEffect(() => { if (!isGuest && current?.cover) writeStorage('sono-last-cover', current.cover); }, [current?.cover, isGuest]);
  const backdropCover = current?.cover || (isGuest ? undefined : readStorage('sono-last-cover') || undefined);
  const edges = useBackdropEdges(look, backdropCover);
  useEffect(() => applyEdges(edges), [edges[0], edges[1]]);
  useEffect(() => {
    applyAccent(look.accent);
    document.documentElement.toggleAttribute('data-glass', look.glass);
    document.documentElement.toggleAttribute('data-custom-bg', look.background !== 'default');
  }, [look.accent, look.glass, look.background]);
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

  const inviteBase = window.location.origin;
  const inviteUrl = `${inviteBase}/${session.code.replace(/^SONO-/, '')}`;
  const hostHeaders = useMemo(() => ({ 'x-host-token': hostToken }), [hostToken]);
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
  const removeTrack = async (id) => {
    try {
      const track = queue.find((item) => item.id === id);
      const data = await apiRequest(`/api/sessions/${session.code}/tracks/${id}`, { method: 'DELETE', headers: hostHeaders });
      applyPayload(data);
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
    setProgress({ positionMs: 0, durationMs: trackDurationMs(track), at: Date.now(), running: native && !isGuest ? false : undefined });
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
        // Le moteur démarre sans attendre le serveur, qui est prévenu en même temps.
        if (native && !isGuest) {
          state.watchUntil = Date.now() + 5000;
          native.call('playNow', { track: current, nextProviderId: nextUp?.providerId }).catch(() => {});
        }
        [, data] = await Promise.all([
          isGuest ? null : controlProvider({ track: current, action: 'next', playing, source: session.source, hostToken, sessionCode: session.code }),
          apiRequest(`/api/sessions/${session.code}/playback`, { method: 'POST', headers: hostHeaders, body: JSON.stringify({ action: delta > 0 ? 'next' : 'previous', count: Math.abs(delta) }) }),
        ]);
      } else {
        // Retour au titre de départ : il repart où il en était, ou reste en pause s’il l’était.
        if (native && !isGuest) native.call('playNow', state.wasPlaying ? { track: current, nextProviderId: nextUp?.providerId } : {}).catch(() => {});
        data = await apiRequest(`/api/sessions/${session.code}`, { headers: hostHeaders });
      }
      // De nouveaux appuis pendant l’envoi : cette réponse est déjà dépassée.
      if (!state.delta && !state.timer) applyPayload(data);
    } catch (error) {
      state.delta = 0;
      window.clearTimeout(state.timer);
      state.timer = 0;
      state.toggle = false;
      if (native && !isGuest) native.call('playNow', {}).catch(() => {});
      notify(error.message, 'error');
      apiRequest(`/api/sessions/${session.code}`, { headers: hostHeaders }).then(applyPayload).catch(() => {});
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
    showSkip(action, track);
    state.delta += action === 'next' ? 1 : -1;
    if (!state.active) {
      state.active = true;
      state.wasPlaying = playing;
      beginChange();
      // Le son en cours se coupe à l’appui ; le titre choisi part dès que l’hôte s’arrête de changer.
      if (native && !isGuest && current) native.call('holdForSkip').catch(() => {});
    }
    window.clearTimeout(state.timer);
    // Rien en cours : pas de raison d’attendre pour lancer le premier titre.
    state.timer = window.setTimeout(() => flushSkipsRef.current(), current ? SKIP_SETTLE_MS : 0);
  };
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
    beginChange();
    const track = action === 'next' ? nextUp : action === 'previous' ? previous : current;
    // L’écran réagit tout de suite ; le serveur confirme ensuite (ou corrige en cas d’erreur).
    if (action === 'toggle') setPlaying(!playing);
    else if ((action === 'next' || action === 'previous') && track && !alreadyPlaying) {
      setCurrent(track);
      setPlaying(true);
      setQueue((items) => items.filter((item) => item.id !== track.id));
      // Sinon « Ensuite » annoncerait encore le titre qu’on vient de lancer, le temps de la réponse.
      if (track.fromFallback && fallbackQueue) {
        const tracks = fallbackQueue.tracks.filter((item) => item.id !== track.id);
        setFallbackQueue({ ...fallbackQueue, tracks, total: Math.max(0, fallbackQueue.total - 1) });
        if (tracks[0]) setSession((value) => (value.fallback ? { ...value, fallback: { ...value.fallback, next: tracks[0] } } : value));
      }
      setProgress({ positionMs: 0, durationMs: trackDurationMs(track), at: Date.now() });
    }
    try {
      // Une lecture lancée à la main remplace le titre préchargé dans le moteur.
      if (!alreadyPlaying && action !== 'toggle') preloadedRef.current = null;
      // Le moteur est commandé en premier ; le serveur est prévenu en même temps, sans se faire attendre l’un l’autre.
      const [, data] = await Promise.all([
        action !== 'ended' && !alreadyPlaying && !isGuest ? controlProvider({ track, action: action === 'previous' ? 'next' : action, playing, source: session.source, hostToken, sessionCode: session.code }) : null,
        apiRequest(`/api/sessions/${session.code}/playback`, { method: 'POST', headers: hostHeaders, body: JSON.stringify({ action, expected: action === 'previous' ? current?.id ?? null : expected }) }),
      ]);
      applyPayload(data);
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
    finally { playbackBusyRef.current = false; endChange(); }
  };
  playbackRef.current = playback;
  dropUnavailableRef.current = async (track) => {
    try {
      const path = track.fromFallback && Number.isInteger(track.fallbackIndex) ? `fallback/tracks/${track.fallbackIndex}?unavailable=1` : `tracks/${track.id}`;
      applyPayload(await apiRequest(`/api/sessions/${session.code}/${path}`, { method: 'DELETE', headers: hostHeaders }));
      notify(tx("« {0} » n’est pas disponible sur votre compte {1} : il est passé.", track.title, session.source), 'error');
    } catch {}
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
  const resumeHosting = (code) => {
    writeStorage('sono-host-code', code);
    setHostToken(readStorage(`sono-host-${code}`));
    setSession((state) => ({ ...state, code }));
    setHostState('checking');
  };
  resumeHostingRef.current = resumeHosting;
  useEffect(() => {
    if (hostState === 'host' && hostToken && session.code) rememberHostSession(session.code, hostToken);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostState, session.code, hostToken]);
  // L’hôte est là : ses écrans (paramètres, connexions, mode TV…) sont préchargés pour s’ouvrir sans attente.
  useEffect(() => { if (hostState === 'host') loadHostParts().catch(() => {}); }, [hostState]);
  // La session animée est retenue par le serveur pour cet ordinateur ; oubliée quand l’hôte la quitte.
  const rememberHostSession = () => Promise.resolve();
  // L’invité apprend qu’il vient d’être nommé admin (ou ne l’est plus).
  const wasAdmin = useRef(null);
  useEffect(() => {
    if (!isGuest || !adminLoaded) return;
    // Premier état reçu : simple point de départ (pas de message à chaque rechargement de la page).
    if (wasAdmin.current !== null) {
      if (adminInfo && !wasAdmin.current) notify(tx("L’hôte vous a nommé admin : vous gérez la lecture et la file."));
      else if (!adminInfo && wasAdmin.current) notify(tx("Vous n’êtes plus admin."));
    }
    wasAdmin.current = Boolean(adminInfo);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminInfo, adminLoaded, isGuest]);
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
  useMediaKeys({
    toggle: () => playback(current ? 'toggle' : 'next'),
    next: () => { if (nextUp) playback('next'); },
    previous: () => { if (previous) playback('previous'); },
  }, hostState === 'host' || adminControl);

  if (tvDisplay) {
    if (hostState !== 'host') return <div className="tv-display-idle"><Brand /><p>{tx("Ouvrez une session dans Sono sur l’iPhone.")}</p></div>;
    return <TvView display origin={[]} current={current} previousKey={previous && trackKey(previous)} next={nextUp} playing={playing} inviteUrl={inviteUrl}
      controls={{ canPrevious: false, canNext: false, onToggle: () => {}, onNext: () => {}, onPrevious: () => {} }} appearance={appearance} onAppearance={() => {}} showTools={false}
      progressBar={current && <ProgressBar className="tv-progress" track={current} progress={progress} playing={playing} onSeek={() => {}} />} onExit={() => {}} toast={null} closeToast={() => {}} />;
  }
  if (hostState === 'checking') return <><AppBackdrop appearance={look} cover={backdropCover} /><div className="guest-shell boot-screen"><Brand /><LoaderCircle className="spin" size={22} /></div></>;
  if (hostState === 'home') return <><AppBackdrop appearance={look} cover={backdropCover} /><HomeView guestName={guestName} onConfirmName={confirmGuestName} toast={toast} closeToast={closeToast} /></>;


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

  return null;
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  });
  return <div className={`swap-text ${className}`}><div ref={layerRef} className="swap-layer">{children}</div></div>;
}

// Jouer la musique sur une TV (ou une enceinte) AirPlay : la liste des appareils d’iOS s’ouvre.
// iOS n’ouvre sa liste que depuis son propre bouton : l’app pose ce bouton système, invisible, exactement par-dessus celui-ci.
let airplayIds = 0;
function AirplayButton({ className }) {
  const ref = useRef(null);
  useEffect(() => {
    const id = `airplay-${(airplayIds += 1)}`;
    let frame = 0;
    let last = '';
    const report = () => {
      frame = 0;
      const button = ref.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const fixed = Boolean(button.closest('.tv-view'));
      const visible = rect.width > 0 && getComputedStyle(button).visibility !== 'hidden' && !document.body.classList.contains('modal-open') && (fixed || !document.documentElement.hasAttribute('data-tv-open'));
      // Le bouton natif n’est déplacé que si la place a changé (le contrôle régulier ne coûte alors rien).
      const place = visible ? { id, x: rect.left + (fixed ? 0 : window.scrollX), y: rect.top + (fixed ? 0 : window.scrollY), width: rect.width, height: rect.height, fixed } : { id };
      const key = JSON.stringify(place);
      if (key === last) return;
      last = key;
      native.call('routeButton', place).catch(() => {});
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(report); };
    const resize = new ResizeObserver(schedule);
    resize.observe(document.body);
    const attributes = new MutationObserver(schedule);
    attributes.observe(document.documentElement, { attributes: true, attributeFilter: ['data-tv-open'] });
    attributes.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', schedule);
    const timer = window.setInterval(schedule, 1500);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      attributes.disconnect();
      window.removeEventListener('resize', schedule);
      window.clearInterval(timer);
      native.call('routeButton', { id }).catch(() => {});
    };
  }, []);
  return <button ref={ref} type="button" className={className} aria-label={tx("Écouter sur une TV ou une enceinte AirPlay")} onClick={() => native.call('showRoutes').catch(() => {})}><Airplay size={16} /></button>;
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
    const cancel = () => { window.clearTimeout(timer); timer = null; start = null; };
    const onStart = (event) => {
      const row = event.target.closest?.('[data-reorder]');
      if (!row || event.touches.length !== 1 || event.target.closest('button, a, input')) return;
      start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      timer = window.setTimeout(() => {
        const all = [...list.querySelectorAll('[data-reorder]')];
        const rects = all.map((item) => { const rect = item.getBoundingClientRect(); return { top: rect.top + window.scrollY, bottom: rect.bottom + window.scrollY, height: rect.height }; });
        active = { row, all, rects, from: all.indexOf(row), to: all.indexOf(row), startY: start.y + window.scrollY, y: start.y };
        row.classList.add('touch-lifted');
        list.classList.add('is-reordering');
        native?.call('haptic').catch(() => {});
        place(start.y);
        // Près du haut ou du bas de l’écran, la page défile toute seule.
        scroller = window.setInterval(() => {
          const margin = 90;
          const speed = active.y < margin ? -7 : active.y > window.innerHeight - margin - 90 ? 7 : 0;
          if (speed) { window.scrollBy(0, speed); place(active.y); }
        }, 16);
      }, 260);
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
    list.addEventListener('touchstart', onStart, { passive: true });
    list.addEventListener('touchmove', onMove, { passive: false });
    list.addEventListener('touchend', onEnd);
    list.addEventListener('touchcancel', onEnd);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(scroller);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, list]);
}

// À la fermeture d’une fenêtre ou d’un message : une copie s’efface à sa place, sans retarder la suite.
function useExitGhost(animateExit, skipRef) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const element = ref.current;
    return () => {
      if (!element?.isConnected || reducedMotion()) return;
      if (skipRef?.current) return;
      const ghost = element.cloneNode(true);
      ghost.style.pointerEvents = 'none';
      ghost.setAttribute('aria-hidden', 'true');
      element.after(ghost);
      animateExit(ghost).onfinish = () => ghost.remove();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ref;
}

const QueueList = memo(function QueueList({ queue, host, fallback, onRemove, onReorder, onBrowse }) {
  const skipFlip = useRef(false);
  const [reorderRef, listElement] = useTouchReorder((from, to) => { skipFlip.current = true; onReorder(from, to); }, Boolean(host && onReorder));
  useListMotion(listElement, queue.map((track) => track.id).join(','), skipFlip);
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const endDrag = () => { setDragIndex(null); setOverIndex(null); };

  if (!queue.length && fallback) return <p className="queue-empty-inline">{host ? tx("Aucun titre proposé pour l’instant. Les titres ajoutés passeront avant la musique de fond.") : tx("Aucun titre proposé : ajoutez-en un, il passera avant la musique de fond.")}</p>;
  if (!queue.length) return <div className="empty-state">
    <span><Music2 size={26} /></span>
    <h3>{tx("La file est vide")}</h3>
    <p>{fallback ? tx("En attendant vos titres, « {0} » prend le relais.", fallback.name) : host ? tx("Partagez le code QR ou ajoutez vous-même un premier titre.") : tx("Soyez le premier à proposer un titre !")}</p>
    {onBrowse && <button className="button secondary" onClick={onBrowse}><Search size={16} />{tx("Parcourir le catalogue")}</button>}
  </div>;

  return <div ref={reorderRef} className={host ? 'queue-list is-host' : 'queue-list is-guest'}>
    {queue.map((track, index) => {
      const classes = ['queue-item', index === 0 && 'is-next', dragIndex === index && 'dragging', overIndex === index && dragIndex !== index && (dragIndex < index ? 'drop-after' : 'drop-before')].filter(Boolean).join(' ');
      return <article key={track.id} className={classes} data-track={track.id} data-reorder={host ? '' : undefined} draggable={host && !native}
        onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', track.id); setDragIndex(index); }}
        onDragOver={(event) => { if (!host || dragIndex === null) return; event.preventDefault(); if (overIndex !== index) setOverIndex(index); }}
        onDrop={(event) => { event.preventDefault(); if (dragIndex !== null) onReorder(dragIndex, index); endDrag(); }}
        onDragEnd={endDrag}>
        {host && <span className="drag-handle" aria-hidden="true"><GripVertical size={16} /></span>}
        {host && <span className="track-number">{index + 1}</span>}
        <TrackCover track={track} />
        <div className="track-main"><strong>{track.title}</strong><span>{track.artist}</span></div>
        {host && <span className="track-album">{track.album || '—'}</span>}
        <span className="added-by" title={tx("Proposé par {0}", track.addedBy)}><Avatar name={track.addedBy} /><span>{track.addedBy}</span></span>
        <span className="track-duration">{track.duration || '—:—'}</span>
        {host && <div className="track-actions">
          <IconButton label={tx("Monter le titre")} disabled={index === 0} onClick={() => onReorder(index, index - 1)}><ArrowUp size={16} /></IconButton>
          <IconButton label={tx("Descendre le titre")} disabled={index === queue.length - 1} onClick={() => onReorder(index, index + 1)}><ArrowDown size={16} /></IconButton>
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
      {admin && <section className={session.hostOnline ? 'admin-card' : 'admin-card alert'} aria-label="Admin">
        <span className="admin-card-icon"><ShieldCheck size={20} /></span>
        <div>
          <strong>{session.hostOnline === false ? tx("L’hôte est absent") : tx("Vous êtes admin")}</strong>
          <p>{session.hostOnline === false ? tx("La musique reprendra sur son téléphone à son retour. Vous gardez les commandes de la file et des arrivées.") : tx("Vous gérez la lecture, les nouveaux arrivants et la file d’attente.")}</p>
        </div>
      </section>}
      {control && control.requests.length > 0 && <JoinRequests requests={control.requests} onDecide={control.onDecide} />}
      <div className={current ? 'guest-now' : 'guest-now idle'}>
        {current?.cover && <CoverGlow cover={current.cover} />}
        <TrackCover track={current} iconSize={22} size={250} fade />
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


function HomeView({ guestName, onConfirmName, toast, closeToast }) {
  return <div className="guest-shell home-shell">
    <main className="home-main">
      <section className="home-hero">
        <h1 aria-label="Sono"><Brand /></h1>
        <p>{tx("Rejoignez la file d’attente d’un proche : entrez le code affiché par l’hôte.")}</p>
      </section>
      <div className="home-panel"><JoinForm guestName={guestName} onConfirmName={onConfirmName} /></div>
    </main>
    {toast && <Toast toast={toast} onClose={closeToast} />}
  </div>;
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
const openInvite = (address, name) => { native ? native.call('openInvite', { url: `${address}#prenom=${encodeURIComponent(name)}` }).catch(() => {}) : window.location.assign(address); };

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
      setError(requestError.status === 404 ? tx("Aucune session ne correspond à ce code. Si elle est hébergée sur un ordinateur, collez son lien d’invitation.") : requestError.message);
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
    {native && <label className="join-link">{tx("Session sur un autre appareil ? Lien d’invitation")}<input value={link} type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(event) => { setLink(event.target.value); setError(''); }} placeholder="https://…" autoComplete="off" /></label>}
    {error && <p className="field-error" role="alert">{error}</p>}
    <button className="button primary join-button" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <ArrowRight size={18} />}{tx("Rejoindre")}</button>
    <p className="join-hint"><QrCode size={16} />{tx("Vous avez le code QR ? Scannez-le simplement avec l’appareil photo.")}</p>
  </form>;
}

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
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const endDrag = () => { setDragIndex(null); setOverIndex(null); };
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsAll, total, sessionCode]);
  const items = (needsAll && all) || tracks;
  const visible = items.slice(0, limit);
  const remaining = total - visible.length;
  visibleRef.current = visible;
  useListMotion(listElement, visible.map((track) => track.id).join(','), skipFlip);
  return <div ref={reorderRef} className={host ? 'queue-list fallback-list is-host' : 'queue-list fallback-list is-guest'}>
    {visible.map((track, index) => <article key={track.id} data-track={track.id} data-reorder={host && onMove ? '' : undefined} draggable={host && !native}
      className={['queue-item is-fallback', startIndex === 0 && index === 0 && 'is-next', dragIndex === index && 'dragging', overIndex === index && dragIndex !== index && (dragIndex < index ? 'drop-after' : 'drop-before')].filter(Boolean).join(' ')}
      onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', track.id); setDragIndex(index); }}
      onDragOver={(event) => { if (!host || dragIndex === null) return; event.preventDefault(); if (overIndex !== index) setOverIndex(index); }}
      onDrop={(event) => { event.preventDefault(); if (dragIndex !== null && dragIndex !== index) onMove(visible[dragIndex], index); endDrag(); }}
      onDragEnd={endDrag}>
      {host && <span className="drag-handle" aria-hidden="true"><GripVertical size={16} /></span>}
      {host && <span className="track-number">{startIndex + index + 1}</span>}
      <TrackCover track={track} />
      <div className="track-main"><strong>{track.title}</strong><span>{track.artist}</span></div>
      {host && <span className="track-album">{track.album || '—'}</span>}
      <span className="added-by fallback-by" title={tx("Musique de fond")}><span className="fallback-badge"><Repeat size={12} /></span><span>{tx("Fond")}</span></span>
      <span className="track-duration">{track.durationMs ? formatDuration(track.durationMs) : '—:—'}</span>
      {host && <div className="track-actions">
        <IconButton label={tx("Monter {0}", track.title)} disabled={index === 0} onClick={() => onMove(track, index - 1)}><ArrowUp size={16} /></IconButton>
        <IconButton label={tx("Descendre {0}", track.title)} disabled={index === total - 1} onClick={() => onMove(track, index + 1)}><ArrowDown size={16} /></IconButton>
        <IconButton label={tx("Ne pas jouer {0}", track.title)} className="remove-action" onClick={() => onSkip(track)}><X size={16} /></IconButton>
      </div>}
    </article>)}
    {(remaining > 0 || limit > 10) && <div className="fallback-more">
      {remaining > 0 && <button type="button" className="text-button" disabled={loading} onClick={() => setLimit((value) => (value === 10 ? 200 : value + 500))}>{loading && <LoaderCircle className="spin" size={14} />}{tx(remaining > 1 ? 'Afficher plus · {0} titres restants' : 'Afficher plus · {0} titre restant', remaining)}</button>}
      {limit > 10 && <button type="button" className="text-button" onClick={() => setLimit(10)}>{tx("Réduire")}</button>}
    </div>}
  </div>;
});



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
  // Fenêtre déjà partie vers le bas sous le doigt : pas de copie à animer.
  const swipedAway = useRef(false);
  const scrollerRef = useRef(null);
  const dimRef = useRef(null);
  const lastScroll = useRef(0);
  const backdropRef = useExitGhost((ghost) => {
    const sheet = ghost.querySelector('.modal');
    const scroller = ghost.querySelector('.sheet-scroller');
    // Téléphone : la copie reprend la position de la fenêtre, puis descend.
    if (scroller && getComputedStyle(scroller).display !== 'contents') {
      scroller.scrollTop = lastScroll.current;
      // C’est la zone qui défile qui descend, pas la fenêtre : déplacer un élément aimanté ferait recaler le défilement.
      const offset = Math.max(0, scroller.clientHeight - (sheet ? sheet.getBoundingClientRect().top : 0));
      scroller.animate([{ transform: 'none' }, { transform: `translate3d(0, ${offset}px, 0)` }], { duration: 260, easing: 'cubic-bezier(.32, .72, 0, 1)', fill: 'forwards' });
      return ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'ease-out', fill: 'forwards' });
    }
    sheet?.animate([{ transform: 'none' }, { transform: 'translate3d(0, 24px, 0)' }], { duration: 170, easing: 'ease-in', fill: 'forwards' });
    return ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 170, easing: 'ease-in', fill: 'forwards' });
  }, swipedAway);
  // Téléphone : la fenêtre est dans une zone qui défile, avec deux arrêts (ouverte, et sortie par le bas). C’est donc
  // iOS qui la fait suivre le doigt, garder l’élan et revenir en place, comme ses propres fenêtres : jamais d’à-coup,
  // même si la page est occupée. Arrêtée en bas, elle se ferme.
  const sheetRef = useRef(null);
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || getComputedStyle(scroller).display === 'contents') return undefined;
    let frame = 0;
    let settle = 0;
    // Position « ouverte » : une fenêtre courte posée en bas de l’écran, une longue en haut (son contenu défile ensuite).
    const sheet = sheetRef.current;
    const openAt = () => (sheet.classList.contains('is-tall') ? sheet.offsetTop - parseFloat(getComputedStyle(scroller).scrollPaddingTop || 0) : scroller.scrollHeight - scroller.clientHeight);
    const fit = () => {
      const tall = sheet.offsetHeight > scroller.clientHeight * 0.92;
      if (tall === sheet.classList.contains('is-tall')) return;
      sheet.classList.toggle('is-tall', tall);
      scroller.classList.toggle('has-tall', tall);
    };
    fit();
    scroller.scrollTop = openAt();
    lastScroll.current = scroller.scrollTop;
    // Ouverture comme les fenêtres d’iOS : elle monte du bas de l’écran pendant que le fond s’assombrit.
    if (!reducedMotion()) {
      // On fait monter la zone qui défile entière : animer la fenêtre elle-même (aimantée) ferait sauter le défilement d’iOS.
      const offset = Math.max(1, scroller.clientHeight - sheet.getBoundingClientRect().top);
      scroller.animate([{ transform: `translate3d(0, ${offset}px, 0)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.32, .72, 0, 1)' });
      dimRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' });
    }
    // La fenêtre change de taille (résultats de recherche…) : si elle était ouverte, elle le reste, à la bonne place.
    let atOpen = true;
    const resize = new ResizeObserver(() => { fit(); if (atOpen && !swipedAway.current) scroller.scrollTop = openAt(); });
    resize.observe(sheet);
    const max = () => Math.max(1, openAt());
    const finish = () => {
      if (swipedAway.current) return;
      sequence = false;
      if (scroller.scrollTop <= 2) { swipedAway.current = true; closeRef.current(); return; }
      atOpen = Math.abs(scroller.scrollTop - openAt()) < 4;
    };
    // Un lancer parti du contenu s’arrête d’abord sur la position ouverte (comme les fenêtres d’iOS) :
    // fermer demande un nouveau geste. Le doigt posé, on peut continuer à tirer la fenêtre vers le bas.
    let fingerDown = false;
    let fromContent = false;
    let sequence = false;
    const onTouchStart = () => { fingerDown = true; };
    const onTouchEnd = () => { fingerDown = false; };
    scroller.addEventListener('touchstart', onTouchStart, { passive: true });
    scroller.addEventListener('touchend', onTouchEnd, { passive: true });
    scroller.addEventListener('touchcancel', onTouchEnd, { passive: true });
    const onScroll = () => {
      // Début d’un mouvement : part-il du contenu (fenêtre déjà ouverte et défilée) ?
      if (!sequence) { sequence = true; fromContent = lastScroll.current > openAt() + 20; }
      if (fromContent && !fingerDown && scroller.scrollTop < openAt() - 2) { fromContent = false; scroller.scrollTop = openAt(); }
      lastScroll.current = scroller.scrollTop;
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (dimRef.current) dimRef.current.style.opacity = String(Math.min(1, scroller.scrollTop / max())); });
      window.clearTimeout(settle);
      settle = window.setTimeout(finish, 140);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    scroller.addEventListener('scrollend', finish);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      resize.disconnect();
      scroller.removeEventListener('touchstart', onTouchStart);
      scroller.removeEventListener('touchend', onTouchEnd);
      scroller.removeEventListener('touchcancel', onTouchEnd);
      scroller.removeEventListener('scroll', onScroll);
      scroller.removeEventListener('scrollend', finish);
    };
  }, []);
  // Appui au-dessus de la fenêtre : elle descend (même mouvement qu’au doigt), puis se ferme.
  const dismiss = () => {
    const scroller = scrollerRef.current;
    if (scroller && getComputedStyle(scroller).display !== 'contents') scroller.scrollTo({ top: 0, behavior: 'smooth' });
    else onClose();
  };
  useEffect(() => {
    const previous = document.activeElement;
    const handler = (event) => event.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', handler);
    document.body.classList.add('modal-open');
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.classList.remove('modal-open');
      previous?.focus?.();
    };
  }, []);
  return <div ref={backdropRef} className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <div ref={dimRef} className="sheet-dim" aria-hidden="true" />
    <div ref={scrollerRef} className="sheet-scroller" onClick={(e) => { if (e.target === e.currentTarget || e.target.classList.contains('sheet-gap')) dismiss(); }}>
      <div className="sheet-gap" aria-hidden="true" />
      <div ref={sheetRef} className={`modal ${className}`} role="dialog" aria-modal="true">
        <span className="sheet-grabber" aria-hidden="true" />
        <IconButton label={tx("Fermer")} className="modal-close" onClick={onClose}><X size={20} /></IconButton>
        {children}
      </div>
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

// Raccourcis clavier pour qui pilote la musique (hôte, ou admin qui a pris la main) : Espace = lecture/pause,
// flèche droite ou N = titre suivant, flèche gauche ou P = titre précédent. Ignorés pendant une saisie, une fenêtre
// ouverte, ou quand un bouton a le focus (Espace y garde son rôle habituel).
function useMediaKeys(controls, enabled) {
  const ref = useRef(controls);
  ref.current = controls;
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (event) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]') || document.body.classList.contains('modal-open')) return;
      const onButton = Boolean(target?.closest('button, a, summary, [role="button"], [role="switch"]'));
      const { toggle, next, previous } = ref.current;
      let action = null;
      if (event.key === 'MediaPlayPause' || (event.key === ' ' && !onButton)) action = toggle;
      else if (event.key === 'MediaTrackNext' || event.key === 'ArrowRight' || event.key.toLowerCase() === 'n') action = next;
      else if (event.key === 'MediaTrackPrevious' || event.key === 'ArrowLeft' || event.key.toLowerCase() === 'p') action = previous;
      if (!action) return;
      event.preventDefault();
      action();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

// Même animation dans les deux sens : la fermeture rejoue l’ouverture à l’envers.
const TV_ZOOM = { duration: 600, easing: 'cubic-bezier(.32, .72, 0, 1)' };
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
export { AirplayButton, DEFAULT_APPEARANCE, Equalizer, FadeCover, IconButton, SwapText, TV_ZOOM, Toast, coverAt, native, reducedMotion, trackKey, useImageMeasure };
