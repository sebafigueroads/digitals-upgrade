/* Digitals Upgrade · backend
   Endpoints:
     POST /api/diagnose   { url }                                        → diagnóstico UX/UI heurístico moderno
     POST /api/quote      { multimedia, sections, features[], speed, copy } → cotización + plan recomendado
     POST /api/lead       { name, email, phone, url, config?, total? }   → Hapee contact
*/
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const app = express();
app.use(express.json({ limit: '300kb' }));
const PORT = process.env.PORT || 3000;
const __dirname = dirname(fileURLToPath(import.meta.url));

const HAPEE_PIT          = process.env.HAPEE_PIT || 'pit-60913a06-a23c-4de4-9f60-7b484dac855b';
const HAPEE_LOCATION_ID  = process.env.HAPEE_LOCATION_ID || 'tPqE8ZXL6r8h5e9k0SGQ';
const HAPEE_API_BASE     = process.env.HAPEE_API_BASE || 'https://services.leadconnectorhq.com';
const HAPEE_API_VERSION  = process.env.HAPEE_API_VERSION || '2021-07-28';

const USD_TO_CLP = 950; // base estimación, valor configurable

function normalizeUrl(input) {
  if (!input || typeof input !== 'string') throw new Error('URL inválida');
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try { new URL(url); } catch { throw new Error('URL inválida'); }
  return url;
}

async function fetchWithTimeout(url, opts = {}, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

/* === Diagnóstico UX/UI HEURÍSTICO (sin LLM en MVP)
   Detecta señales objetivas de una web "vieja" vs "moderna 2026":
   - Performance (size, image format)
   - Visual modernity (Google Fonts modernos, CSS variables, dark mode, animations, GSAP/Framer/Lenis)
   - Interactividad (lazy loading, motion, gestures)
   - AI-readiness (Schema, llms.txt, FAQ)
   - UX patterns (sticky header, smooth scroll, custom cursor, holos, 3D, tilt, video hero)
*/
async function diagnose(url) {
  const r = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0 DigitalsUpgrade/1.0 (+https://upgrade.digitals.cl)' } }, 18000);
  if (!r.ok) throw new Error('No se pudo cargar la URL · HTTP ' + r.status);
  const html = await r.text();
  const lower = html.toLowerCase();

  const has = (re) => re.test(html);
  const lowerHas = (s) => lower.includes(s);

  const signals = {
    // === Performance signals ===
    pageWeight:        { value: html.length, label: `Peso HTML ${(html.length/1024).toFixed(0)}KB`, good: html.length < 200000, weight: 6 },
    lazyImages:        { value: (html.match(/loading=["']lazy["']/g) || []).length, label: 'Lazy-loading en imágenes', good: has(/loading=["']lazy["']/), weight: 5 },
    webp:              { value: (html.match(/\.webp/gi) || []).length, label: 'Imágenes WebP modernas', good: has(/\.webp/i), weight: 4 },
    preconnect:        { value: 0, label: 'Preconnect a CDN de fuentes', good: has(/<link[^>]+rel=["']preconnect["']/i), weight: 3 },

    // === Modern visual stack ===
    googleFontsModern: { label: 'Tipografía display moderna (Inter Tight/Bricolage/Geist/Bebas Neue/Manrope)', good: /Inter\+Tight|Bricolage|Geist|Bebas\+Neue|Bebas Neue|Manrope|Plus\+Jakarta|Instrument\+Serif/i.test(html), weight: 5 },
    customFonts:       { label: 'Tipografía custom (Google Fonts o @font-face)', good: has(/fonts\.googleapis\.com|@font-face/), weight: 3 },
    cssVariables:      { label: 'Variables CSS modernas (custom props)', good: has(/--[\w-]+\s*:/), weight: 4 },
    darkMode:          { label: 'Soporte dark/light mode', good: has(/prefers-color-scheme|data-theme|@media.*dark/), weight: 5 },
    cssGrid:           { label: 'CSS Grid moderno', good: has(/display\s*:\s*grid/) || has(/grid-template/), weight: 3 },
    glassmorphism:     { label: 'Glassmorphism / backdrop-filter', good: has(/backdrop-filter\s*:\s*blur/), weight: 3 },

    // === Animations / motion ===
    gsap:              { label: 'Motion library moderna (GSAP / Framer / Motion)', good: lowerHas('gsap') || lowerHas('framer-motion') || lowerHas('motion'), weight: 5 },
    lenis:             { label: 'Smooth scroll moderno (Lenis / Locomotive)', good: lowerHas('lenis') || lowerHas('locomotive'), weight: 4 },
    threeJs:           { label: '3D / WebGL (Three.js / Spline)', good: lowerHas('three.js') || lowerHas('three.min') || lowerHas('spline'), weight: 4 },
    scrollTrigger:     { label: 'Scroll-triggered animations', good: lowerHas('scrolltrigger') || lowerHas('intersectionobserver'), weight: 4 },
    cssAnimations:     { label: 'CSS keyframe animations', good: has(/@keyframes|animation\s*:/), weight: 2 },

    // === UX patterns 2026 ===
    stickyNav:         { label: 'Navbar sticky', good: has(/position\s*:\s*sticky/) || has(/position\s*:\s*fixed[^}]*top\s*:\s*0/), weight: 3 },
    customCursor:      { label: 'Custom cursor', good: has(/cursor\s*:\s*none/) || has(/custom-cursor|cursor-main|cursor-trail/i), weight: 3 },
    videoHero:         { label: 'Video hero / background', good: has(/<video[^>]*(autoplay|background)/i), weight: 4 },
    holos:             { label: 'Tipografía giant / outlined holos', good: has(/-webkit-text-stroke/), weight: 3 },
    tilt3d:            { label: '3D tilt cards', good: has(/perspective\s*:\s*\d+|transform\s*:\s*rotateY/), weight: 3 },

    // === AI-readiness ===
    schemaOrg:         { label: 'Schema.org JSON-LD', good: has(/application\/ld\+json/), weight: 6 },
    faqPage:           { label: 'FAQPage schema (citaciones IA)', good: has(/"FAQPage"/), weight: 6 },
    llmsTxt:           { label: 'Estándar llms.txt', good: false, weight: 5, _async: 'llms' },
    aiBots:            { label: 'Robots.txt permite crawlers IA (GPTBot, Claude, Gemini)', good: false, weight: 4, _async: 'robots' },
    speakable:         { label: 'Speakable spec para voice AI', good: has(/SpeakableSpecification|"speakable"/i), weight: 3 },

    // === Mobile + Accessibility ===
    viewport:          { label: 'Meta viewport mobile', good: has(/<meta[^>]+name=["']viewport["']/i), weight: 5 },
    altTexts:          { label: 'Alt text en imágenes', good: (() => { const imgs = html.match(/<img[^>]+>/g) || []; if (!imgs.length) return false; const withAlt = imgs.filter(t => /\salt=["'][^"']+["']/i.test(t)).length; return (withAlt / imgs.length) >= 0.85; })(), weight: 4 },
    hreflang:          { label: 'hreflang multilenguaje', good: has(/hreflang=/), weight: 2 },

    // === Modern frameworks/tech ===
    modernFramework:   { label: 'Stack moderno (Next/Nuxt/Astro/SvelteKit)', good: lowerHas('next.js') || lowerHas('nuxt') || lowerHas('astro') || lowerHas('sveltekit') || has(/__next|_nuxt|astro-island/), weight: 3 }
  };

  // === Async checks ===
  try {
    const u = new URL(url);
    const base = `${u.protocol}//${u.host}`;
    const [robotsR, llmsR] = await Promise.all([
      fetchWithTimeout(`${base}/robots.txt`, {}, 5000).catch(() => null),
      fetchWithTimeout(`${base}/llms.txt`, {}, 5000).catch(() => null)
    ]);
    if (llmsR && llmsR.ok) signals.llmsTxt.good = true;
    if (robotsR && robotsR.ok) {
      const txt = await robotsR.text();
      const aiBots = ['GPTBot','ChatGPT-User','ClaudeBot','PerplexityBot','Google-Extended','Applebot-Extended'];
      const count = aiBots.filter(b => new RegExp(`User-agent:\\s*${b}[\\s\\S]*?Allow:\\s*\\/`, 'i').test(txt)).length;
      signals.aiBots.good = count >= 3;
      signals.aiBots.value = count;
    }
  } catch {}

  // === Score moderno (0-100) ===
  let total = 0, achieved = 0;
  for (const k in signals) {
    const w = signals[k].weight;
    total += w;
    if (signals[k].good) achieved += w;
  }
  const modernScore = Math.round((achieved / total) * 100);

  // === Pillar scores ===
  const pillars = {
    Performance:  pillarScore(signals, ['pageWeight','lazyImages','webp','preconnect']),
    'UX/UI':      pillarScore(signals, ['googleFontsModern','customFonts','cssVariables','darkMode','cssGrid','glassmorphism','stickyNav','customCursor','videoHero','holos','tilt3d']),
    Motion:       pillarScore(signals, ['gsap','lenis','threeJs','scrollTrigger','cssAnimations']),
    'AI-ready':   pillarScore(signals, ['schemaOrg','faqPage','llmsTxt','aiBots','speakable']),
    Mobile:       pillarScore(signals, ['viewport','altTexts','hreflang']),
    'Stack':      pillarScore(signals, ['modernFramework','cssVariables'])
  };

  // === Diagnóstico narrativo + oportunidades ===
  const opportunities = [];
  const benefits = [];
  for (const [k, s] of Object.entries(signals)) {
    if (!s.good) {
      opportunities.push({ key: k, area: areaOf(k), label: s.label, weight: s.weight, why: whyOf(k), benefit: benefitOf(k) });
    }
  }
  opportunities.sort((a, b) => b.weight - a.weight);

  // === Verdict + recommendation level ===
  let verdict, recommendation;
  if (modernScore >= 80) {
    verdict = 'Tu web ya está bien posicionada para 2026. Hay refinamientos puntuales que podemos pulir.';
    recommendation = 'refresh';
  } else if (modernScore >= 55) {
    verdict = 'Tu web tiene buenos fundamentos pero está perdiendo terreno frente a competidores con stack moderno. Necesita un upgrade táctico.';
    recommendation = 'upgrade';
  } else if (modernScore >= 30) {
    verdict = 'Tu web tiene gaps importantes vs estándares 2026. Es momento de un rediseño que la posicione a la vanguardia.';
    recommendation = 'redesign';
  } else {
    verdict = 'Tu web necesita un rebuild completo para competir en 2026. La brecha con la competencia moderna es grande, pero esa misma brecha es tu mayor oportunidad de diferenciación.';
    recommendation = 'rebuild';
  }

  return {
    url,
    modernScore,
    pillars,
    signals,
    opportunities: opportunities.slice(0, 12),
    verdict,
    recommendation
  };
}

function pillarScore(signals, keys) {
  let total = 0, achieved = 0;
  for (const k of keys) {
    if (!signals[k]) continue;
    total += signals[k].weight;
    if (signals[k].good) achieved += signals[k].weight;
  }
  return total ? Math.round((achieved / total) * 100) : 0;
}

function areaOf(k) {
  if (['pageWeight','lazyImages','webp','preconnect'].includes(k)) return 'Performance';
  if (['gsap','lenis','threeJs','scrollTrigger','cssAnimations'].includes(k)) return 'Motion';
  if (['schemaOrg','faqPage','llmsTxt','aiBots','speakable'].includes(k)) return 'AI-ready';
  if (['viewport','altTexts','hreflang'].includes(k)) return 'Mobile/A11y';
  if (['modernFramework'].includes(k)) return 'Stack';
  return 'UX/UI';
}

function whyOf(k) {
  const map = {
    pageWeight: 'Páginas con peso alto cargan lento y bajan conversiones. Google penaliza en Core Web Vitals.',
    lazyImages: 'Sin lazy loading, todas las imágenes se descargan de una vez, ralentizando el primer render.',
    webp: 'WebP pesa 25-50% menos que JPG/PNG manteniendo la calidad.',
    googleFontsModern: 'Tipografías como Bricolage, Bebas Neue o Inter Tight son señal de inversión en marca premium.',
    darkMode: 'En 2026 los usuarios esperan poder elegir tema. Es un diferenciador competitivo claro.',
    gsap: 'Las marcas premium usan motion libraries para transiciones suaves y experiencias memorables.',
    lenis: 'El smooth scroll moderno transforma la sensación táctil del sitio. Es un signature de webs award-winning.',
    threeJs: '3D web y WebGL son el mayor diferenciador visual disponible hoy. Casi nadie en tu industria lo usa.',
    holos: 'Tipografía giant outlined es la firma visual de las webs editorial premium 2024-2026.',
    tilt3d: 'Cards con 3D tilt aumentan la percepción de calidad y duplican el tiempo de hover.',
    schemaOrg: 'Sin Schema.org tu sitio es invisible para featured snippets de Google.',
    faqPage: 'FAQPage es lo que ChatGPT, Claude y Gemini citan cuando alguien pregunta sobre tu industria.',
    llmsTxt: 'Estándar emergente para que LLMs entiendan tu negocio. Quien lo implementa primero gana citas.',
    aiBots: 'Sin permitir explícitamente GPTBot/ClaudeBot/Google-Extended, los LLM ignoran tu contenido al responder.',
    videoHero: 'Hero con video aumenta el engagement promedio en 73% según estudios de Vidyard.',
    customCursor: 'Un cursor custom es un signal instantáneo de craftsmanship y atención al detalle.',
    modernFramework: 'Stack moderno permite iterar 5x más rápido y aprovechar features como SSR/ISR/edge.'
  };
  return map[k] || '';
}

function benefitOf(k) {
  const map = {
    pageWeight: '+15% conversión por reducción de bounce rate.',
    lazyImages: 'LCP -1.2s promedio.',
    webp: 'Peso de imágenes -40%, carga 2x más rápida.',
    googleFontsModern: 'Percepción de marca premium +28%.',
    darkMode: '+12% tiempo en sitio para usuarios que activan dark.',
    gsap: 'Tiempo en página +40% por engagement táctil.',
    lenis: 'Sensación táctil award-winning, +18% scroll depth.',
    threeJs: 'Diferenciación visual del 99% de tu competencia.',
    holos: 'Marca memorable instantánea.',
    tilt3d: 'Hover engagement 2.1x mayor.',
    schemaOrg: 'Featured snippets en Google +35% click-through.',
    faqPage: 'Citaciones automáticas en ChatGPT/Claude/Gemini.',
    llmsTxt: 'Primer-mover advantage en LLMO.',
    aiBots: 'Visibilidad en respuestas IA +60%.',
    videoHero: 'Engagement +73% vs imagen estática.',
    customCursor: 'Memorabilidad de marca +24%.',
    modernFramework: 'Time-to-market de nuevas features 5x más rápido.'
  };
  return map[k] || '';
}

/* === Quote / calculadora dinámica ===
   Precios base (USD * USD_TO_CLP). Los ajustamos al alza/baja según tu margen.
   Cada componente tiene base + per-unit.
*/
const PRICING = {
  // Multimedia / hero treatment
  multimedia: {
    text:        { name: 'Solo texto editorial',           usd: 0,    label: 'Solo texto · sin multimedia (más editorial)' },
    photo:       { name: 'Fotografía estática',            usd: 450,  label: 'Fotos optimizadas + lazy loading' },
    video:       { name: 'Video hero',                     usd: 850,  label: 'Video MP4 optimizado + poster' },
    aiWow:       { name: 'Efecto WOW con IA (Higgsfield)', usd: 1900, label: 'Hero con imágenes/video generativo + holos giant' },
    threeD:      { name: '3D / WebGL interactivo',          usd: 3200, label: 'Three.js / Spline · diferenciador top vs competencia' }
  },
  // Sections (web complexity)
  sections: {
    landing:   { name: '1 sección · Landing simple',   usd: 800,  count: 1 },
    micro:     { name: '3-5 secciones · Micro-site',   usd: 1800, count: 4 },
    standard:  { name: '6-10 secciones · Web estándar',usd: 3200, count: 8 },
    extended:  { name: '11-15 secciones · Web extendida',usd: 5200, count: 13 },
    full:      { name: '16+ secciones · Web completa', usd: 7800, count: 18 }
  },
  // Feature add-ons (multi-select)
  features: {
    darkLight:    { name: 'Toggle dark/light mode',                            usd: 320 },
    motionLib:    { name: 'GSAP + ScrollTrigger + Lenis smooth scroll',         usd: 480 },
    customCursor: { name: 'Custom cursor + 3D tilt cards',                     usd: 280 },
    holos:        { name: 'Tipografía giant outlined / holos signature',       usd: 240 },
    multi:        { name: 'Multi-idioma (es/en)',                              usd: 600 },
    cms:          { name: 'CMS headless (editable por cliente)',                usd: 1400 },
    crm:          { name: 'Integración CRM (Hapee/HubSpot/Salesforce)',         usd: 900 },
    ecom:         { name: 'E-commerce Shopify integrado',                      usd: 1800 },
    blog:         { name: 'Blog editorial (artículos · paid SEO)',              usd: 750 },
    analytics:    { name: 'GA4 + Tag Manager + Looker dashboard',              usd: 650 },
    schemas:      { name: 'Schema.org @graph + FAQPage + llms.txt (AEO/GEO)',  usd: 380 },
    accessibility:{ name: 'Accesibilidad WCAG 2.2 AA',                          usd: 480 },
    forms:        { name: 'Formularios con captura + workflows automatizados', usd: 420 },
    chatbot:      { name: 'Chatbot IA personalizado (Claude/GPT)',              usd: 1400 }
  },
  // Performance level
  speed: {
    standard:  { name: 'Performance estándar',  usd: 0,    label: 'Optimización básica' },
    optimized: { name: 'Performance optimizada', usd: 480,  label: 'Core Web Vitals verde · LCP <2.5s' },
    award:     { name: 'Performance award-winning', usd: 1200, label: 'CWV verde · LCP <1.5s · Lighthouse 95+' }
  },
  // Copy/content depth
  copy: {
    cliente:   { name: 'Copy proporcionado por el cliente',     usd: 0 },
    asistido:  { name: 'Copy asistido (editamos tu material)', usd: 450 },
    full:      { name: 'Copywriting completo desde cero',      usd: 1200 }
  }
};

function calcQuote(cfg) {
  const items = [];
  let total = 0;
  let timelineWeeks = 2;

  const add = (cat, key) => {
    const p = PRICING[cat]?.[key];
    if (!p) return;
    const clp = Math.round(p.usd * USD_TO_CLP);
    items.push({ category: cat, key, name: p.name, label: p.label || '', usd: p.usd, clp });
    total += p.usd;
  };

  if (cfg.multimedia) { add('multimedia', cfg.multimedia); timelineWeeks += cfg.multimedia === 'threeD' ? 3 : cfg.multimedia === 'aiWow' ? 2 : cfg.multimedia === 'video' ? 1 : 0; }
  if (cfg.sections)   { add('sections', cfg.sections); timelineWeeks += { landing: 0, micro: 1, standard: 2, extended: 4, full: 6 }[cfg.sections] || 2; }
  if (cfg.speed)      { add('speed', cfg.speed); }
  if (cfg.copy)       { add('copy', cfg.copy); timelineWeeks += cfg.copy === 'full' ? 2 : cfg.copy === 'asistido' ? 1 : 0; }
  if (Array.isArray(cfg.features)) {
    for (const f of cfg.features) { add('features', f); timelineWeeks += 0.5; }
  }

  // Recomendaciones plan (basado en complexity score)
  const complexity = total / 100; // proxy
  let recommendedTier;
  if (complexity < 25)      recommendedTier = { name: 'Landing Express', code: 'express', usd: 2400 };
  else if (complexity < 55) recommendedTier = { name: 'Web Pro', code: 'pro', usd: 5800 };
  else if (complexity < 110) recommendedTier = { name: 'Web Premium', code: 'premium', usd: 9800 };
  else                       recommendedTier = { name: 'Award-winning Build', code: 'award', usd: 16500 };

  const totalClp = Math.round(total * USD_TO_CLP);
  // Aplicamos descuento si toma plan completo
  const discountedUsd = Math.round(total * 0.92);

  return {
    items,
    subtotalUsd: total,
    subtotalClp: totalClp,
    discountUsd: total - discountedUsd,
    finalUsd: discountedUsd,
    finalClp: Math.round(discountedUsd * USD_TO_CLP),
    timelineWeeks: Math.round(timelineWeeks),
    recommendedTier
  };
}

// === ROUTES ===
app.post('/api/diagnose', async (req, res) => {
  try {
    const url = normalizeUrl(req.body?.url || '');
    const data = await diagnose(url);
    res.json(data);
  } catch (e) {
    console.error('[diagnose]', e);
    res.status(400).json({ error: e.message || 'Error procesando la URL' });
  }
});

app.post('/api/quote', (req, res) => {
  try {
    const cfg = req.body || {};
    const q = calcQuote(cfg);
    res.json(q);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/lead', async (req, res) => {
  try {
    const { name = '', email = '', phone = '', url = '', total = 0, config = {} } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Email inválido' });
    const [firstName, ...rest] = name.trim().split(/\s+/);
    const payload = {
      firstName: firstName || '',
      lastName: rest.join(' '),
      email,
      phone: phone || undefined,
      locationId: HAPEE_LOCATION_ID,
      tags: ['upgrade-tool','lead-magnet','web-rebuild-quote'],
      source: 'upgrade.digitals.cl',
      customFields: [
        { key: 'scanned_url', field_value: url },
        { key: 'estimated_total_usd', field_value: String(total) },
        { key: 'web_config', field_value: JSON.stringify(config).slice(0, 600) }
      ]
    };
    const r = await fetchWithTimeout(`${HAPEE_API_BASE}/contacts/upsert`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HAPEE_PIT}`,
        'Version': HAPEE_API_VERSION,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }, 12000);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ error: 'No se pudo crear el contacto', detail: d?.message });
    res.json({ ok: true, contactId: d?.contact?.id || d?.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.use(express.static(join(__dirname, 'public'), {
  maxAge: '1h',
  setHeaders: (res, path) => { if (path.endsWith('.html')) res.set('Cache-Control', 'no-cache'); }
}));

app.listen(PORT, () => console.log(`[upgrade-digitals] :${PORT}`));
