/**
 * Icon set — hand-drawn inline SVG paths (no external icon library, no emoji).
 * Icons inherit `currentColor` so they theme with the UI.
 */

const ICONS: Record<string, string> = {
  play: '<polygon points="6 4 20 12 6 20 6 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.4-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  map: '<path d="M9 4 3 7v13l6-3 6 3 6-3V4l-6 3z"/><path d="M9 4v13M15 7v13"/>',
  compass: '<circle cx="12" cy="12" r="9"/><polygon points="16 8 10 10 8 16 14 14 16 8"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  cloud: '<path d="M7 18a4 4 0 1 1 .8-7.9A5.5 5.5 0 0 1 18.5 12a3 3 0 0 1-.5 6z"/>',
  rain: '<path d="M7 15a4 4 0 1 1 .8-7.9A5.5 5.5 0 0 1 18.5 9a3 3 0 0 1-.5 6"/><path d="M8 18l-1 2M12 18l-1 2M16 18l-1 2"/>',
  storm: '<path d="M7 14a4 4 0 1 1 .8-7.9A5.5 5.5 0 0 1 18.5 8a3 3 0 0 1-.5 6"/><path d="M12 12l-2 4h3l-2 4"/>',
  snow: '<path d="M7 14a4 4 0 1 1 .8-7.9A5.5 5.5 0 0 1 18.5 8a3 3 0 0 1-.5 6"/><path d="M9 18h.01M12 20h.01M15 18h.01"/>',
  fog: '<path d="M4 10h16M6 14h14M4 18h12"/>',
  wind: '<path d="M3 8h10a3 3 0 1 0-3-3M3 12h14a3 3 0 1 1-3 3M3 16h8a2.5 2.5 0 1 1-2.5 2.5"/>',
  tree: '<path d="M12 2 6 10h3l-4 6h5v4h4v-4h5l-4-6h3z"/>',
  leaf: '<path d="M5 19C5 9 13 4 20 4c0 8-4 15-13 15z"/><path d="M5 19c3-5 7-8 11-10"/>',
  flower: '<circle cx="12" cy="10" r="2.2"/><path d="M12 7.8c0-2 1-3.3 2.5-3.3S17 6 15.5 7.5M12 7.8c0-2-1-3.3-2.5-3.3S7 6 8.5 7.5M14 11.5c2-.7 3.6 0 3.6 1.5s-1.8 2-3.2 1M10 11.5c-2-.7-3.6 0-3.6 1.5s1.8 2 3.2 1M12 12.5V19"/>',
  water: '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>',
  home: '<path d="M4 11 12 4l8 7"/><path d="M6 10v10h12V10"/><path d="M10 20v-6h4v6"/>',
  barn: '<path d="M4 21V9l8-5 8 5v12"/><path d="M4 21h16"/><path d="M9 21v-6h6v6"/><path d="M8 11h8"/>',
  shop: '<path d="M4 9h16l-1 12H5z"/><path d="M4 9l2-5h12l2 5"/><path d="M9 13h6"/>',
  tower: '<path d="M8 21V6h8v15"/><path d="M8 6 12 2l4 4"/><rect x="10" y="10" width="4" height="4"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-4 3-6 7-6s7 2 7 6"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.5 2.5-5.5 6-5.5s6 2 6 5.5"/><path d="M16 5.5a3 3 0 0 1 0 5.6M18 14.8c2 .8 3 2.5 3 5.2"/>',
  paw: '<circle cx="8" cy="8" r="2"/><circle cx="16" cy="8" r="2"/><circle cx="5.5" cy="13" r="1.8"/><circle cx="18.5" cy="13" r="1.8"/><path d="M12 12c-3 0-5 2.5-5 4.5S9 21 12 21s5-2 5-4.5S15 12 12 12z"/>',
  fish: '<path d="M3 12c4-6 12-6 16 0-4 6-12 6-16 0z"/><path d="M19 12l2-3v6z"/><circle cx="8" cy="11.5" r="0.8"/>',
  heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 9v5M12 17h.01"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  save: '<path d="M5 3h11l4 4v14H5z"/><path d="M8 3v6h7V3"/><rect x="8" y="13" width="8" height="8"/>',
  download: '<path d="M12 4v10M8 11l4 4 4-4"/><path d="M4 18v2h16v-2"/>',
  upload: '<path d="M12 14V4M8 7l4-4 4 4"/><path d="M4 18v2h16v-2"/>',
  trash: '<path d="M5 7h14M9 7V4h6v3M7 7l1 14h8l1-14"/><path d="M10 11v6M14 11v6"/>',
  refresh: '<path d="M4 12a8 8 0 1 1 2.3 5.7"/><path d="M4 20v-5h5"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  hand: '<path d="M8 12V6a1.5 1.5 0 0 1 3 0v5"/><path d="M11 11V5a1.5 1.5 0 0 1 3 0v6"/><path d="M14 11V7a1.5 1.5 0 0 1 3 0v7c0 4-2.5 7-6.5 7S4 18 4 14v-3a1.5 1.5 0 0 1 3 0"/>',
  axe: '<path d="M14 3l7 7-3 3-7-7z"/><path d="M11 6 3 20l3 2 8-12"/>',
  pickaxe: '<path d="M3 21 15 9"/><path d="M6 8c2-3 8-4 12-1l-2 2c-3-2-7-1-9 2z"/>',
  build: '<rect x="4" y="10" width="16" height="11" rx="1"/><path d="M4 10l8-6 8 6"/><rect x="10" y="14" width="4" height="7"/>',
  terrain: '<path d="M2 19c3-6 6-9 10-9s7 3 10 9z"/><path d="M2 19h20"/>',
  'terrain-up': '<path d="M2 19c3-6 6-9 10-9s7 3 10 9z"/><path d="M12 4v4M10 6l2-2 2 2"/>',
  'terrain-down': '<path d="M2 19c3-6 6-9 10-9s7 3 10 9z"/><path d="M12 4v4M10 6l2 2 2-2"/>',
  'terrain-smooth': '<path d="M2 19c4-2 7-7 10-7s6 5 10 7z"/><path d="M4 13c2 0 3-2 5-2"/>',
  'terrain-flat': '<path d="M2 17h20"/><path d="M4 17v-3h16v3"/>',
  paint: '<rect x="4" y="4" width="12" height="12" rx="2"/><path d="M16 12h3l1 4-6 4-2-3 3-2"/>',
  bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6z"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  camera: '<rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13.5" r="3.5"/><path d="M8 7l2-3h4l2 3"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19a2 2 0 0 1 2-2h13"/>',
  star: '<polygon points="12 3 14.5 9 21 9.5 16 14 17.5 21 12 17.5 6.5 21 8 14 3 9.5 9.5 9"/>',
  cube: '<path d="M12 2 21 7v10l-9 5-9-5V7z"/><path d="M12 2v20M3 7l9 5 9-5"/>',
  god: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="M20 20l-5-5"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h12l-2 4 2 4H5"/>',
};

export function icon(name: string, size = 18): string {
  const path = ICONS[name] ?? ICONS.cube;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

export function hasIcon(name: string): boolean {
  return name in ICONS;
}
