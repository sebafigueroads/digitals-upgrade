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

const HAPEE_PIT          = process.env.HAPEE_PIT || '';
const HAPEE_LOCATION_ID  = process.env.HAPEE_LOCATION_ID || '';
const HAPEE_API_BASE     = process.env.HAPEE_API_BASE || 'https://services.leadconnectorhq.com';
const HAPEE_API_VERSION  = process.env.HAPEE_API_VERSION || '2021-07-28';
if (!HAPEE_PIT || !HAPEE_LOCATION_ID) console.warn('[upgrade-digitals] WARN: HAPEE_PIT / HAPEE_LOCATION_ID no configurados — /api/lead fallará.');

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

  // === Industria heurística para mencionar competencia real ===
  const industryGuess = guessIndustry(html, url);
  const competitors = competitorsByIndustry(industryGuess);

  return {
    url,
    modernScore,
    pillars,
    signals,
    opportunities: opportunities.slice(0, 12),
    verdict,
    recommendation,
    industry: industryGuess,
    competitors
  };
}

function guessIndustry(html, url) {
  const text = (html.toLowerCase() + ' ' + url.toLowerCase());
  const matches = [];
  const patterns = [
    { ind: 'retail / e-commerce',    keys: ['carrito','tienda','agregar al carro','checkout','envío gratis','shopify','woocommerce','catálogo'] },
    { ind: 'salud / clínica',         keys: ['clínica','medic','salud','consulta','agendar hora','paciente','doctor','dental','estética'] },
    { ind: 'B2B industrial',          keys: ['industrial','maquinaria','b2b','fábrica','mayorista','distribuidor','planta','grúa','forklift'] },
    { ind: 'inmobiliaria',            keys: ['departamento','proyecto inmobiliario','venta de casas','arriendo','inmobiliaria','m²','planos'] },
    { ind: 'restaurante / food',      keys: ['menú','restaurante','pedido','reserva','degustación','vinos','sommelier'] },
    { ind: 'educación',               keys: ['curso','universidad','colegio','postgrado','diplomado','académic','estudiantes','matrícula'] },
    { ind: 'servicios profesionales', keys: ['abogad','contador','asesoría legal','estudio jurídico','auditoría','consultor'] },
    { ind: 'SaaS / tech',             keys: ['saas','plataforma','dashboard','suscripción','api','pricing','startup','software'] },
    { ind: 'agencia marketing',       keys: ['agencia','marketing digital','paid media','seo','agencia creativa','full service'] },
    { ind: 'hotel / turismo',         keys: ['hotel','tour','viaje','reserva','habitación','resort','turismo'] },
    { ind: 'construcción',            keys: ['construcción','obra','arquitect','edificación','remodelación'] }
  ];
  for (const p of patterns) {
    const hits = p.keys.filter(k => text.includes(k)).length;
    if (hits) matches.push({ ind: p.ind, score: hits });
  }
  matches.sort((a, b) => b.score - a.score);
  return matches[0]?.ind || 'general';
}

function competitorsByIndustry(ind) {
  const map = {
    'retail / e-commerce':       ['Falabella','Paris','Ripley','Mercado Libre','Cencosud','Lippi'],
    'salud / clínica':            ['Clínica Las Condes','Clínica Alemana','RedSalud','Integramédica','Sonríe'],
    'B2B industrial':             ['Sodimac Empresa','Construmart','Easy','Komatsu Chile','Salfa'],
    'inmobiliaria':               ['Toctoc','PortalInmobiliario','Yapo','PropertyFinder','LeBon'],
    'restaurante / food':         ['Rappi','Uber Eats','PedidosYa','Cornershop','La Costanera'],
    'educación':                  ['UC','UAndes','UDD','UAI','Crehana','Coursera'],
    'servicios profesionales':    ['EY','PwC','Deloitte','KPMG','Andersen','Cariola'],
    'SaaS / tech':                ['Defontana','Bsale','Toteat','Khipu','Pago Express'],
    'agencia marketing':          ['Wunderman Thompson','VML','BBDO','Ogilvy','Mccann','Prolam'],
    'hotel / turismo':            ['Booking','Despegar','Atrapalo','Cocha','Andes Hoteles'],
    'construcción':               ['Salfa','Echeverría Izquierdo','Sigro','Moller','Bezanilla'],
    'general':                    ['tus principales competidores chilenos']
  };
  return map[ind] || map.general;
}

// === Recomendación de preset basada en diagnose ===
function recommendPreset(diag) {
  const op = diag.opportunities || [];
  const score = diag.modernScore || 50;
  const has = (key) => op.some(o => o.key === key);

  // Multimedia recomendado
  let multimedia = 'photo';
  if (has('threeJs') || has('videoHero')) multimedia = 'aiWow';
  if (score < 40 && !has('threeJs')) multimedia = 'aiWow';
  if (op.length > 8) multimedia = 'aiWow';

  // Sections (basado en complexity industry)
  const ind = diag.industry || 'general';
  let sections = 'standard';
  if (['B2B industrial','servicios profesionales','agencia marketing','SaaS / tech'].includes(ind)) sections = 'extended';
  if (['retail / e-commerce','educación'].includes(ind)) sections = 'full';
  if (['restaurante / food'].includes(ind)) sections = 'micro';

  // Features auto-selected basados en lo que le falta
  const features = [];
  if (has('darkMode'))         features.push('darkLight');
  if (has('gsap') || has('lenis') || has('scrollTrigger')) features.push('motionLib');
  if (has('customCursor') || has('tilt3d')) features.push('customCursor');
  if (has('holos'))            features.push('holos');
  if (has('schemaOrg') || has('faqPage') || has('llmsTxt') || has('aiBots')) features.push('schemas');
  // Always-recommended
  if (!features.includes('motionLib')) features.push('motionLib');
  if (!features.includes('schemas'))   features.push('schemas');
  // Add CRM + analytics como default para B2B
  if (['B2B industrial','servicios profesionales','SaaS / tech','agencia marketing'].includes(ind)) {
    features.push('crm','analytics','forms');
  }
  if (ind === 'retail / e-commerce') features.push('ecom','analytics','crm');
  if (ind === 'salud / clínica')      features.push('forms','crm','accessibility');

  // Speed
  let speed = 'optimized';
  if (score < 35) speed = 'award';
  if (op.length > 10) speed = 'award';

  // Copy
  let copy = 'asistido';
  if (op.length > 10 || score < 30) copy = 'full';

  return { multimedia, sections, features: [...new Set(features)], speed, copy };
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

app.post('/api/recommend', (req, res) => {
  try {
    const diag = req.body?.diag || {};
    const preset = recommendPreset(diag);
    res.json({ preset });
  } catch (e) {
    res.status(400).json({ error: e.message });
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

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function buildQuoteEmailHtml({ name, url, total = 0, totalClp = 0, weeks = 0, tier = '', config = {}, diagnose = null }) {
  const greet = (name || '').trim().split(/\s+/)[0] || 'Hola';
  const cfg = config || {};
  const sections = Object.entries(cfg).filter(([k, v]) => v && k !== 'features').map(([k, v]) => `<tr><td style="padding:6px 0;color:#aaaaaa;font-size:13px;text-transform:capitalize;">${escapeHtml(k)}</td><td style="text-align:right;color:#fff;font-size:13px;font-weight:600;">${escapeHtml(typeof v === 'string' ? v : String(v))}</td></tr>`).join('');
  const features = Array.isArray(cfg.features) ? cfg.features : [];
  const diagBlock = diagnose && diagnose.opportunities ? `
    <div style="margin:24px 0 12px;">
      <div style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#7a7a7a;font-weight:700;margin-bottom:12px;">Oportunidades detectadas en tu web actual</div>
      ${(diagnose.opportunities || []).slice(0,6).map(op => `
        <div style="background:#0d0d0d;border-left:3px solid #e5bb55;border-radius:6px;padding:12px 16px;margin-bottom:8px;">
          <div style="font-size:9.5px;letter-spacing:0.22em;text-transform:uppercase;color:#e5bb55;font-weight:700;margin-bottom:4px;">${escapeHtml(op.area || '')}</div>
          <div style="font-size:13.5px;color:#fff;font-weight:600;">${escapeHtml(op.title || '')}</div>
          ${op.tip ? `<div style="font-size:12px;color:#aaa;line-height:1.55;margin-top:4px;">${escapeHtml(op.tip)}</div>` : ''}
        </div>`).join('')}
    </div>` : '';

  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cotización Upgrade Web · Digitals</title></head>
<body style="margin:0;padding:0;background:#0d0d0d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#f4f4f4;">
<div style="max-width:640px;margin:0 auto;background:#141414;">
  <div style="padding:32px 36px;border-bottom:1px solid rgba(255,255,255,0.08);">
    <img src="https://upgrade.digitals.cl/assets/logo/digitals-logo.png" alt="Digitals" width="80" height="80" style="display:block;border-radius:10px;"/>
    <div style="margin-top:22px;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#7a7a7a;font-weight:600;">Cotización Upgrade · upgrade.digitals.cl</div>
  </div>
  <div style="padding:32px 36px;">
    <p style="margin:0 0 16px;color:#cccccc;font-size:15px;line-height:1.6;">${escapeHtml(greet)}, gracias por usar Digitals Upgrade.</p>
    <p style="margin:0 0 24px;color:#cccccc;font-size:15px;line-height:1.6;">Esta es la cotización del rebuild de <a href="${escapeHtml(url)}" style="color:#12c1d8;text-decoration:none;">${escapeHtml(url)}</a> según la configuración que armaste:</p>
    <div style="background:#0d0d0d;border:1px solid rgba(255,255,255,0.10);border-radius:14px;padding:28px;text-align:center;margin:24px 0;">
      <div style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#7a7a7a;font-weight:600;margin-bottom:8px;">Inversión estimada</div>
      <div style="font-family:'Bebas Neue','Arial Narrow',sans-serif;font-size:64px;line-height:1;font-weight:400;color:#e5bb55;letter-spacing:0.01em;">USD ${Number(total).toLocaleString('es-CL')}</div>
      <div style="font-size:13px;color:#999999;margin-top:6px;">≈ CLP ${Number(totalClp).toLocaleString('es-CL')}</div>
      <div style="margin-top:14px;font-size:12px;color:#aaa;">Tier <strong style="color:#fff;">${escapeHtml(tier)}</strong> · ${weeks} semanas estimadas</div>
    </div>
    ${sections ? `<div style="background:#0d0d0d;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:18px 22px;margin:20px 0;">
      <div style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#7a7a7a;font-weight:700;margin-bottom:10px;">Configuración</div>
      <table role="presentation" style="width:100%;border-collapse:collapse;">${sections}</table>
    </div>` : ''}
    ${features.length ? `<div style="margin:20px 0;">
      <div style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#7a7a7a;font-weight:700;margin-bottom:10px;">Features incluidas</div>
      ${features.map(f => `<span style="display:inline-block;background:rgba(18,128,155,0.14);color:#12c1d8;padding:5px 11px;border-radius:100px;font-size:11.5px;font-weight:600;margin:3px 4px 3px 0;">${escapeHtml(f)}</span>`).join('')}
    </div>` : ''}
    ${diagBlock}
    <div style="background:linear-gradient(135deg,rgba(18,128,155,0.14),rgba(229,187,85,0.10));border:1px solid rgba(18,128,155,0.32);border-radius:14px;padding:24px;margin:32px 0 16px;">
      <div style="font-size:13px;color:#cccccc;line-height:1.6;">Un especialista de Digitals te contactará dentro de las próximas 24h hábiles para coordinar una reunión, validar el alcance final y armar el contrato.</div>
      <div style="margin-top:18px;">
        <a href="https://digitals.cl" style="display:inline-block;background:#12809b;color:#fff;text-decoration:none;padding:13px 26px;border-radius:100px;font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Conocer más sobre Digitals →</a>
      </div>
    </div>
  </div>
  <div style="padding:24px 36px;border-top:1px solid rgba(255,255,255,0.08);text-align:center;color:#7a7a7a;font-size:11px;line-height:1.7;">
    <div>Digitals · agencia de marketing digital + IA en Chile</div>
    <div style="margin-top:4px;"><a href="https://digitals.cl" style="color:#7a7a7a;text-decoration:none;">digitals.cl</a> · <a href="https://upgrade.digitals.cl" style="color:#7a7a7a;text-decoration:none;">upgrade.digitals.cl</a></div>
  </div>
</div>
</body></html>`;
}

async function sendQuoteEmail({ contactId, name, url, total, totalClp, weeks, tier, config, diagnose }) {
  if (!contactId) return { sent: false, reason: 'no-contact-id' };
  const html = buildQuoteEmailHtml({ name, url, total, totalClp, weeks, tier, config, diagnose });
  const subject = `Tu cotización Upgrade Web · USD ${Number(total).toLocaleString('es-CL')} · Digitals`;
  const body = {
    type: 'Email',
    contactId,
    subject,
    html,
    emailFrom: process.env.HAPEE_EMAIL_FROM || 'hola@digitals.cl'
  };
  const r = await fetchWithTimeout(`${HAPEE_API_BASE}/conversations/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${HAPEE_PIT}`,
      'Version': HAPEE_API_VERSION,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  }, 20000);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('[hapee email upgrade error]', r.status, d);
    return { sent: false, reason: 'hapee-error', status: r.status };
  }
  return { sent: true, messageId: d?.messageId || d?.id || null };
}

app.post('/api/lead', async (req, res) => {
  try {
    const { name = '', email = '', phone = '', url = '', total = 0, totalClp = 0, weeks = 0, tier = '', config = {}, diagnose = null } = req.body || {};
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
    const contactId = d?.contact?.id || d?.id || null;

    let emailResult = { sent: false };
    try {
      emailResult = await sendQuoteEmail({ contactId, name, url, total, totalClp, weeks, tier, config, diagnose });
    } catch (emailErr) {
      console.error('[upgrade email send error]', emailErr);
      emailResult = { sent: false, reason: 'exception', detail: emailErr.message };
    }
    res.json({ ok: true, contactId, email: emailResult });
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
