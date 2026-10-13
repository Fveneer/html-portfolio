// Análisis de palabras clave tipo ATS, 100% local (no usa IA).
// Extrae los términos más relevantes de la oferta y mide cuántos aparecen en el CV.

const STOP = new Set(`
a al algo imprescindible indispensable requerido requerida requeridos obligatorio deseado ideal idealmente sera debe deben must-have nice-to-have algunas algunos ante antes como con contra cual cuando de del desde donde durante e el ella ellas ellos en entre era es esa esas ese eso esos esta estas este esto estos fue ha hay la las le les lo los mas más me mi muy nos nuestra nuestro nuestros nuestras o otra otro para pero por porque que qué se sea ser si sí sin sobre su sus también tanto te tiene tienen todo todos tu tus un una unas uno unos y ya será serán estar estamos somos buscamos buscando ofrecemos requisitos responsabilidades funciones deseable deseables experiencia años año empresa equipo trabajo puesto cargo candidato candidata persona personas conocimiento conocimientos manejo nivel capacidad habilidades habilidad ofrecemos beneficios salario contrato tiempo completo lunes viernes horario modalidad presencial remoto híbrido hibrido oferta vacante postular aplica aplicar mínimo minimo valorará valoraremos plus etc así cada mismo misma dentro través hacia hasta según tener hacer forma parte nos gustaría queremos the and or of to in for with on at by from as an be is are was were will would can could should may might must have has had do does did this that these those it its our your you we they their them who whom which what when where why how all any both each few more most other some such no nor not only own same so than too very just about above after again against below between into through during before under over up down out off further then once here there also etc able ability work working team teams company role position candidate candidates experience years year job jobs including include includes strong excellent good great new using use used well within across plus preferred required requirements responsibilities qualifications skills skill knowledge understanding looking join help make ensure support provide based level per day days week weeks month months full time part etc e.g i.e us want need needs we're you'll you're it's what's
`.split(/\s+/).filter(Boolean));

function normalize(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9+#./\-\s]/g, ' ')
    .replace(/\s+/g, ' ');
}

function tokens(text) {
  return normalize(text)
    .split(' ')
    .map(t => t.replace(/^[./\-]+|[./\-]+$/g, ''))
    .filter(t => t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t));
}

// Devuelve [{term, weight}] ordenado por relevancia.
export function extractKeywords(jobText, max = 30) {
  const toks = tokens(jobText);
  const uni = new Map();
  const bi = new Map();
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    let w = 1;
    if (/[+#.]|\d/.test(t)) w += 1.5; // c++, c#, node.js, s3, es6…
    if (t.length <= 2 && !/[+#]/.test(t)) w -= 0.6;
    uni.set(t, (uni.get(t) || 0) + w);
    if (i + 1 < toks.length) {
      const b = t + ' ' + toks[i + 1];
      bi.set(b, (bi.get(b) || 0) + 1);
    }
  }
  // Términos con mayúscula en el original (tecnologías, herramientas) ganan peso.
  const caps = (jobText || '').match(/\b[A-Z][A-Za-z0-9+#.]{1,}\b/g) || [];
  for (const c of caps) {
    const k = normalize(c).trim();
    if (uni.has(k)) uni.set(k, uni.get(k) + 0.8);
  }
  const out = [];
  for (const [b, n] of bi) if (n >= 2) out.push({ term: b, weight: n * 2.2 });
  for (const [t, n] of uni) out.push({ term: t, weight: n });
  out.sort((a, b) => b.weight - a.weight);
  // Quita unigramas ya cubiertos por un bigrama elegido.
  const chosen = [];
  for (const k of out) {
    if (chosen.length >= max) break;
    if (!k.term.includes(' ') && chosen.some(c => c.term.includes(' ') && c.term.split(' ').includes(k.term))) continue;
    chosen.push(k);
  }
  return chosen;
}

export function scoreMatch(jobText, resumeText, max = 30) {
  const kws = extractKeywords(jobText, max);
  const hay = ' ' + normalize(resumeText) + ' ';
  const hits = [];
  const misses = [];
  let got = 0;
  let total = 0;
  for (const k of kws) {
    total += k.weight;
    const re = new RegExp(`(^|[^a-z0-9])${k.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`);
    if (re.test(hay)) { hits.push(k.term); got += k.weight; } else misses.push(k.term);
  }
  return { score: total ? Math.round((got / total) * 100) : 0, hits, misses };
}
