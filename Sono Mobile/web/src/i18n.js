// Langue de l’interface : le texte source est en français, l’anglais vient du dictionnaire i18n-en.js (chargé à part).
// La langue est fixée au chargement de la page : en changer recharge la page (voir setLang).

const KEY = 'sono-lang';
const LANGS = ['fr', 'en'];
const stored = () => { try { const value = localStorage.getItem(KEY); return LANGS.includes(value) ? value : null; } catch { return null; } };
const systemLang = () => (/^fr\b/i.test(navigator.language || '') ? 'fr' : 'en');

export const lang = stored() || systemLang();
export const locale = lang === 'en' ? 'en-US' : 'fr-FR';
// Le dictionnaire anglais n’est téléchargé que si l’interface est en anglais.
const en = lang === 'en' ? (await import('./i18n-en.js')).default : {};
document.documentElement.lang = lang;

const fill = (text, args) => (args.length ? text.replace(/\{(\d)\}/g, (_, i) => args[i] ?? '') : text);
export const tx = (text, ...args) => fill((lang === 'en' && en[text]) || text, args);

// Messages venus du serveur (erreurs, fil d’activité) : texte exact, ou gabarit avec des parties variables.
let patterns;
export const txServer = (message) => {
  if (lang !== 'en' || typeof message !== 'string' || !message) return message;
  if (en[message]) return en[message];
  patterns ??= Object.keys(en).filter((key) => key.includes('{0}')).map((key) => [new RegExp(`^${key.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{\d\}/g, '(.+?)')}$`), key]);
  for (const [pattern, key] of patterns) { const match = message.match(pattern); if (match) return fill(en[key], match.slice(1)); }
  return message;
};

// Choix de l’hôte : enregistré puis page rechargée. Pour les invités, la langue suit celle de l’hôte.
export const setLang = (value) => {
  if (!LANGS.includes(value) || value === lang) return;
  try { localStorage.setItem(KEY, value); } catch { return; }
  if (stored() === value) location.reload();
};
