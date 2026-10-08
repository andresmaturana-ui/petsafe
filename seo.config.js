// Preparación para Google (SEO), Search Console y Meta, en cada build:
// - Pone la dirección pública (VITE_SITE_URL) en las etiquetas de index.html.
// - Agrega las etiquetas de verificación de Google y Meta si están configuradas.
// - Escribe robots.txt y sitemap.xml (con la página de cada clínica aprobada).
// - Crea …/veterinarios/, …/clinica/, …/municipio/, …/kiltrazo/ y …/vi/, direcciones
//   "de verdad" sin "#": Google no indexa lo que va después de "#" e
//   Instagram lo corta.
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Clínicas aprobadas y visibles en el mapa, para el sitemap. Si Supabase no
// responde, el sitemap sale igual, sin ellas.
async function clinicSlugs(env) {
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_KEY) return [];
  try {
    const res = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/nearby_clinics`, {
      method: 'POST',
      headers: { apikey: env.VITE_SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_lat: null, p_lng: null, p_km: 50 }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()).map((c) => c.slug).filter(Boolean);
  } catch (err) {
    console.warn(`sitemap.xml sin clínicas (${err.message})`);
    return [];
  }
}

// Páginas sin "#". La de /kiltrazo/ es la misma presentación de la portada,
// así que no lleva título propio ni va en el sitemap.
const PAGES = [
  {
    path: 'veterinarios',
    priority: '0.9',
    title: 'Encuentra veterinario cerca de ti · Kiltrazo',
    description: 'Clínicas veterinarias y veterinarios a domicilio en Chile. Busca por comuna o especialidad, mira urgencias y pide hora en línea, con o sin la app.',
  },
  {
    path: 'clinica',
    priority: '0.8',
    title: 'Kiltrazo Clínica · agenda y fichas para veterinarias',
    description: 'Agenda, fichas clínicas, vacunas y horas en línea para clínicas veterinarias y veterinarios a domicilio. Funciona en el computador y en el celular, y es gratis.',
  },
  {
    path: 'municipio',
    priority: '0.8',
    title: 'Kiltrazo Municipal · operativos y registro de mascotas',
    description: 'Operativos de vacunación y esterilización con reserva en línea, registro de animales de la comuna y mascotas perdidas y encontradas.',
  },
  { path: 'kiltrazo' },
  // Enlace de las publicaciones de mascotas perdidas en Facebook.
  { path: 'vi' },
];

export function seo(env) {
  const site = (env.VITE_SITE_URL || 'https://kiltrazo.cl').replace(/\/+$/, '');
  let outDir = 'dist';
  let building = false;
  return {
    name: 'kiltrazo-seo',
    configResolved(config) {
      outDir = config.build.outDir;
      building = config.command === 'build';
    },
    transformIndexHtml(html) {
      const verify = [
        env.VITE_GOOGLE_VERIFICATION && `<meta name="google-site-verification" content="${xml(env.VITE_GOOGLE_VERIFICATION)}" />`,
        env.VITE_META_VERIFICATION && `<meta name="facebook-domain-verification" content="${xml(env.VITE_META_VERIFICATION)}" />`,
      ].filter(Boolean).join('\n    ');
      return html.replaceAll('__SITE_URL__', site).replace('</head>', verify ? `  ${verify}\n  </head>` : '</head>');
    },
    async closeBundle() {
      if (!building) return;
      const today = new Date().toISOString().slice(0, 10);
      const urls = [
        { loc: `${site}/`, priority: '1.0' },
        ...PAGES.filter((p) => p.title).map((p) => ({ loc: `${site}/${p.path}/`, priority: p.priority })),
        ...(await clinicSlugs(env)).map((slug) => ({ loc: `${site}/?c=${encodeURIComponent(slug)}`, priority: '0.7' })),
      ];
      await writeFile(`${outDir}/sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${xml(u.loc)}</loc><lastmod>${today}</lastmod><priority>${u.priority}</priority></url>`).join('\n')}
</urlset>
`);
      await writeFile(`${outDir}/robots.txt`, `User-agent: *
Allow: /

Sitemap: ${site}/sitemap.xml
`);

      // Direcciones sin "#" (…/veterinarios/, …/clinica/, …): la misma app, con su
      // propio título y descripción. Sirven para Google y para Instagram, que
      // cortan lo que va después de "#".
      const index = await readFile(`${outDir}/index.html`, 'utf8');
      for (const p of PAGES) {
        let html = index.replace('<head>', '<head>\n    <base href="../" />');
        if (p.title) {
          html = html
            .replace(/<title>[^<]*<\/title>/, `<title>${p.title}</title>`)
            .replace(/(<meta name="description" content=")[^"]*/, `$1${p.description}`)
            .replace(/(<meta property="og:description" content=")[^"]*/, `$1${p.description}`)
            .replace(/(<meta name="twitter:description" content=")[^"]*/, `$1${p.description}`)
            .replace(/(<meta property="og:title" content=")[^"]*/, `$1${p.title}`)
            .replace(/(<meta name="twitter:title" content=")[^"]*/, `$1${p.title}`)
            .replace(`<link rel="canonical" href="${site}/" />`, `<link rel="canonical" href="${site}/${p.path}/" />`)
            .replace(`<meta property="og:url" content="${site}/" />`, `<meta property="og:url" content="${site}/${p.path}/" />`);
        }
        await mkdir(`${outDir}/${p.path}`, { recursive: true });
        await writeFile(`${outDir}/${p.path}/index.html`, html);
      }
    },
  };
}
