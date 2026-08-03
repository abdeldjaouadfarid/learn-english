// Minimal inline SVG icon set. Colored via `currentColor`, sized via CSS `.icon`.
window.Icons = (() => {
  const base = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

  const set = {
    home: `<svg ${base}><path d="M3 12l9-9 9 9"/><path d="M5 10v10h5v-6h4v6h5V10"/></svg>`,
    test: `<svg ${base}><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1"/><path d="M8.5 13l2 2 4-4"/></svg>`,
    book: `<svg ${base}><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5v-17z"/><path d="M4 21.5A2.5 2.5 0 0 1 6.5 19H20"/></svg>`,
    target: `<svg ${base}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg>`,
    speaker: `<svg ${base}><path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>`,
    bell: `<svg ${base}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>`,
    compass: `<svg ${base}><circle cx="12" cy="12" r="9"/><polygon points="16 8 12.5 15 8 16 11.5 9" fill="currentColor" stroke="none"/></svg>`,
  };

  function svg(name, cls = 'icon') {
    const raw = set[name] || '';
    if (!cls) return raw;
    return raw.replace('<svg', `<svg class="${cls}"`);
  }

  return { svg, set };
})();
