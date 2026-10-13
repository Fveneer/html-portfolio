// Proveedores de IA y prompts. Todas las llamadas salen directamente del navegador al proveedor elegido.

const PROVIDERS = {
  gemini: {
    label: 'Google Gemini (gratis con clave de AI Studio)',
    needsKey: true,
    models: ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-flash-lite-latest'],
    help: 'Gratis: entra a <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>, crea una clave y pégala aquí. Luego pulsa <b>Cargar modelos</b> para ver los disponibles con tu clave. El plan gratuito tiene límite de solicitudes por minuto; deja una pausa de 4–6 s en lote.',
  },
  groq: {
    label: 'Groq (gratis, muy rápido)',
    needsKey: true,
    models: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'qwen/qwen3-32b'],
    help: 'Gratis: crea una clave en <a href="https://console.groq.com/keys" target="_blank" rel="noopener">console.groq.com/keys</a>.',
  },
  openrouter: {
    label: 'OpenRouter (modelos :free)',
    needsKey: true,
    models: ['meta-llama/llama-3.3-70b-instruct:free', 'deepseek/deepseek-chat-v3-0324:free', 'google/gemma-3-27b-it:free'],
    help: 'Crea una clave en <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai/keys</a> y usa modelos que terminen en <code>:free</code> (sin costo).',
  },
  ollama: {
    label: 'Ollama (local, sin internet, gratis)',
    needsKey: false,
    baseUrl: 'http://localhost:11434',
    models: ['llama3.1:8b', 'qwen2.5:14b', 'mistral-nemo'],
    help: 'Instala <a href="https://ollama.com" target="_blank" rel="noopener">Ollama</a>, ejecuta <code>ollama pull llama3.1:8b</code> y arráncalo permitiendo este sitio: <code>OLLAMA_ORIGINS="*" ollama serve</code>.',
  },
  openai_compat: {
    label: 'Otro compatible con OpenAI (LM Studio, etc.)',
    needsKey: false,
    baseUrl: 'http://localhost:1234/v1',
    models: [],
    help: 'Cualquier servidor con endpoint <code>/chat/completions</code> (LM Studio, vLLM, Together, etc.). La clave es opcional.',
  },
  anthropic: {
    label: 'Anthropic Claude (de pago, opcional)',
    needsKey: true,
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    help: 'Opcional y de pago por uso. Clave en <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a>. Haiku es la opción más económica.',
  },
};

function providerConfig(settings) {
  const id = settings.provider in PROVIDERS ? settings.provider : 'gemini';
  const p = PROVIDERS[id];
  return {
    id,
    key: settings.keys?.[id] || '',
    model: settings.models?.[id] || p.models[0] || '',
    baseUrl: (settings.baseUrls?.[id] || p.baseUrl || '').replace(/\/+$/, ''),
  };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function http(url, opts) {
  let res;
  try {
    res = await fetch(url, opts);
  } catch (e) {
    throw new Error(`No se pudo conectar con ${new URL(url).host}. Revisa tu conexión${/localhost|127\.0\.0\.1/.test(url) ? ' y que el servidor local esté corriendo con CORS habilitado' : ''}. (${e.message})`);
  }
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* respuesta no JSON */ }
  if (!res.ok) {
    const msg = data?.error?.message || data?.error || data?.message || text.slice(0, 300);
    const err = new Error(`Error ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
    err.status = res.status;
    err.retryAfter = Number(res.headers.get('retry-after')) || 0;
    throw err;
  }
  return data;
}

async function callOnce(cfg, system, user, { json, maxTokens }) {
  if (PROVIDERS[cfg.id].needsKey && !cfg.key) throw new Error('Falta la API key. Configúrala en Ajustes.');

  if (cfg.id === 'gemini') {
    const data = await http(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: maxTokens, ...(json ? { responseMimeType: 'application/json' } : {}) },
      }),
    });
    const cand = data?.candidates?.[0];
    const text = (cand?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
    if (!text) throw new Error(`Gemini no devolvió texto (${cand?.finishReason || data?.promptFeedback?.blockReason || 'sin motivo'}).`);
    return text;
  }

  if (cfg.id === 'anthropic') {
    const data = await http('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        ...(/^claude-(opus|sonnet)-5-5$/.test(cfg.model) ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {}),
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: Math.max(maxTokens, 16000),
        system,
        output_config: { effort: 'medium' },
        ...(/^claude-(opus|sonnet)-5-5$/.test(cfg.model) ? { fallbacks: 'default' } : {}),
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (data.stop_reason === 'refusal') throw new Error('Claude rechazó la solicitud.');
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    if (!text) throw new Error(`Claude no devolvió texto (${data.stop_reason}).`);
    return text;
  }

  if (cfg.id === 'ollama') {
    const data = await http(`${cfg.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        stream: false,
        ...(json ? { format: 'json' } : {}),
        options: { temperature: 0.4, num_ctx: 16384 },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    });
    return data?.message?.content || '';
  }

  // Formato OpenAI chat/completions: Groq, OpenRouter, LM Studio, etc.
  const base = cfg.id === 'groq' ? 'https://api.groq.com/openai/v1'
    : cfg.id === 'openrouter' ? 'https://openrouter.ai/api/v1'
    : cfg.baseUrl;
  if (!base) throw new Error('Falta la URL base del servidor.');
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.key) headers.Authorization = `Bearer ${cfg.key}`;
  if (cfg.id === 'openrouter') { headers['HTTP-Referer'] = location.origin; headers['X-Title'] = 'Job Tailor'; }
  const body = {
    model: cfg.model,
    temperature: 0.4,
    max_tokens: maxTokens,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  };
  if (json && cfg.id !== 'openai_compat') body.response_format = { type: 'json_object' };
  const data = await http(`${base}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = data?.choices?.[0]?.message?.content || '';
  if (!text) throw new Error('El modelo no devolvió texto.');
  return text;
}

// Lista los modelos que el proveedor ofrece con la clave del usuario.
async function listModels(settings) {
  const cfg = providerConfig(settings);
  if (PROVIDERS[cfg.id].needsKey && !cfg.key) throw new Error('Falta la API key. Configúrala en Ajustes.');
  if (cfg.id === 'gemini') {
    const data = await http('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { headers: { 'x-goog-api-key': cfg.key } });
    return (data.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => m.name.replace(/^models\//, ''));
  }
  if (cfg.id === 'anthropic') {
    const data = await http('https://api.anthropic.com/v1/models?limit=100', {
      headers: { 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    });
    return (data.data || []).map(m => m.id);
  }
  if (cfg.id === 'ollama') {
    const data = await http(`${cfg.baseUrl}/api/tags`, {});
    return (data.models || []).map(m => m.name);
  }
  const base = cfg.id === 'groq' ? 'https://api.groq.com/openai/v1' : cfg.id === 'openrouter' ? 'https://openrouter.ai/api/v1' : cfg.baseUrl;
  const data = await http(`${base}/models`, { headers: cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {} });
  const ids = (data.data || []).map(m => m.id);
  return cfg.id === 'openrouter' ? ids.filter(id => id.endsWith(':free')) : ids;
}

// Elige el mejor modelo de texto de una lista (para reemplazar uno retirado o configurar por primera vez).
function pickModel(providerId, models) {
  const usable = models.filter(m => !/(embed|image|imagen|tts|audio|live|whisper|guard|vision|veo|aqa|robotics|computer-use|native|transcri|moderation)/i.test(m));
  if (!usable.length) return null;
  const preferred = PROVIDERS[providerId].models.find(m => usable.includes(m));
  if (providerId === 'gemini') {
    const version = m => parseFloat((m.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
    const score = m => version(m) * 10
      + (/flash/.test(m) ? 5 : 0) - (/lite/.test(m) ? 3 : 0)
      - (/(preview|exp)/.test(m) ? 2 : 0) - (/\d{3,}$/.test(m) ? 1 : 0)
      + (/-latest$/.test(m) ? 1 : 0) - (/pro/.test(m) ? 1 : 0);
    return [...usable].filter(m => /^gemini-/.test(m)).sort((a, b) => score(b) - score(a))[0] || preferred || usable[0];
  }
  if (preferred) return preferred;
  if (providerId === 'groq') return usable.find(m => /70b|120b/.test(m)) || usable[0];
  return usable[0];
}

const isModelGone = e => e.status === 404 || /model.*(not found|no longer available|deprecated|does not exist|not supported)/i.test(e.message || '');

async function callAI(settings, system, user, { json = true, maxTokens = 8000, onRetry, onModelChange } = {}) {
  let cfg = providerConfig(settings);
  let lastErr;
  let switchedModel = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const text = await callOnce(cfg, system, user, { json, maxTokens });
      return json ? parseJson(text) : text.trim();
    } catch (e) {
      lastErr = e;
      // Si el modelo fue retirado, busca uno disponible con la clave del usuario y reintenta.
      if (isModelGone(e) && !switchedModel) {
        switchedModel = true;
        let replacement = null;
        try { replacement = pickModel(cfg.id, await listModels(settings)); } catch (listErr) { console.warn(listErr); }
        if (replacement && replacement !== cfg.model) {
          onRetry?.(`El modelo ${cfg.model} ya no está disponible; cambiando a ${replacement}…`);
          settings.models = { ...(settings.models || {}), [cfg.id]: replacement };
          cfg = providerConfig(settings);
          onModelChange?.(replacement);
          attempt--;
          continue;
        }
        lastErr = new Error(`${e.message}\n\nEl modelo "${cfg.model}" no está disponible. Ve a Ajustes, pulsa "Cargar modelos" y elige otro.`);
        break;
      }
      const retryable = e.status === 429 || e.status === 408 || e.status >= 500 || e.name === 'JsonParseError';
      if (!retryable || attempt === 3) break;
      const wait = e.retryAfter ? e.retryAfter * 1000 : 3000 * 2 ** attempt;
      onRetry?.(`Reintentando en ${Math.round(wait / 1000)} s (${e.status === 429 ? 'límite de uso del plan gratis' : e.message.slice(0, 60)})…`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

function parseJson(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  t = t.replace(/<think>[\s\S]*?<\/think>/g, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  try {
    return JSON.parse(t);
  } catch {
    try { return JSON.parse(t.replace(/,\s*([}\]])/g, '$1')); } catch { /* sigue */ }
    const err = new Error('La IA devolvió un JSON inválido.');
    err.name = 'JsonParseError';
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const LANG_NAMES = { es: 'Spanish', en: 'English', pt: 'Portuguese', fr: 'French', de: 'German' };

function langInstruction(lang) {
  return lang && lang !== 'auto'
    ? `Write everything in ${LANG_NAMES[lang] || lang}.`
    : 'Write everything in the same language the job posting is written in.';
}

const RESUME_SCHEMA = `{
  "name": string,
  "headline": string,            // short professional title line
  "language": "es"|"en"|"pt"|"fr"|"de",   // language the resume is written in
  "contact": { "email": string, "phone": string, "location": string, "linkedin": string, "website": string, "other": string[] },
  "summary": string,
  "skills": [ { "category": string, "items": string[] } ],
  "experience": [ { "title": string, "company": string, "location": string, "start": string, "end": string, "bullets": string[] } ],
  "projects": [ { "name": string, "description": string, "tech": string[], "link": string, "bullets": string[] } ],
  "education": [ { "degree": string, "institution": string, "start": string, "end": string, "details": string } ],
  "certifications": string[],
  "languages": string[],         // e.g. "English – C1"
  "other": [ { "title": string, "items": string[] } ]   // volunteering, awards, publications…
}`;

function parseResumePrompt(raw, notes) {
  return {
    system: 'You convert resumes into clean structured JSON. Preserve every fact exactly (names, dates, companies, numbers). Do not add, embellish or drop information. Keep the original language. Output only JSON.',
    user: `Convert this resume into JSON with this exact shape (omit nothing that exists; use "" or [] when missing):
${RESUME_SCHEMA}

Put anything that does not fit a field into "other".

RESUME:
"""
${raw}
"""
${notes ? `\nEXTRA NOTES FROM THE CANDIDATE (facts they also want considered; include relevant ones):\n"""\n${notes}\n"""` : ''}`,
  };
}

const LEVELS = {
  conservative: 'Make minimal changes: keep the candidate\'s wording, mostly reorder bullets/skills, adjust the headline and summary, and swap in the posting\'s exact terminology where it means the same thing.',
  balanced: 'Rewrite bullets to emphasize the parts of each role most relevant to this job, using the posting\'s vocabulary, while keeping every claim truthful to the source.',
  aggressive: 'Optimize hard for ATS and recruiter fit: rewrite the headline, summary and every bullet around the posting\'s requirements, surface every relevant transferable skill, cut irrelevant content aggressively, and mirror the posting\'s keywords wherever the source supports them. Still never fabricate.',
};

function tailorPrompt({ profile, job, settings }) {
  const pages = settings.length === '2' ? 'two pages' : 'one page';
  const master = profile.resume ? JSON.stringify(profile.resume, null, 1) : profile.raw;
  return {
    system: `You are an elite recruiter and resume writer. You tailor a candidate's master resume to a single job posting so that it passes ATS filters and convinces a hiring manager that the candidate is a top match.

Non-negotiable honesty rules:
- Never invent employers, titles, dates, degrees, certifications, tools, technologies, responsibilities or metrics that are not supported by the master resume or the candidate's notes.
- You may rephrase, reorder, merge, shorten, omit, and generalize; you may use the job posting's terminology for things the candidate demonstrably did (e.g. "JS" -> "JavaScript", "led weekly syncs" -> "stakeholder communication").
- Keep company names, job titles and dates exactly as in the source. Only keep numbers that appear in the source.

Tailoring rules:
- ${LEVELS[settings.level] || LEVELS.balanced}
- Headline: aligned with the target role title when truthful.
- Summary: 2–4 sentences targeted to this specific role and company, leading with the candidate's strongest matching qualifications.
- Skills: group into categories; put skills the posting asks for (that the candidate has) first, using the posting's spelling.
- Experience: most relevant bullets first, 2–6 bullets per role, strong action verbs, outcome-focused. Older or irrelevant roles get fewer bullets.
- Fit everything into about ${pages}.
- ${langInstruction(settings.lang)} Translate the content if needed (keep proper nouns).
${settings.extra ? `- Candidate's extra instructions: ${settings.extra}` : ''}

Output only JSON.`,
    user: `Return JSON with this shape:
{
  "jobTitle": string,           // detected from the posting
  "company": string,            // detected from the posting ("" if unknown)
  "fitScore": number,           // 0-100, honest estimate of how well the candidate matches the requirements
  "fitSummary": string,         // 1-2 sentences, in Spanish, explaining the score
  "keywords": string[],         // the 10-20 most important keywords/requirements of the posting
  "changes": string[],          // in Spanish: short list of what you changed and why
  "gaps": string[],             // in Spanish: requirements the candidate does not show; suggest what to add ONLY if it is true
  "resume": ${RESUME_SCHEMA}
}

MASTER RESUME:
"""
${master}
"""
${profile.notes ? `\nCANDIDATE NOTES (true facts and preferences):\n"""\n${profile.notes}\n"""` : ''}

JOB POSTING${job.title ? ` — ${job.title}` : ''}${job.company ? ` at ${job.company}` : ''}:
"""
${job.description}
"""`,
  };
}

const TONES = {
  professional: 'professional, confident and specific',
  warm: 'warm, enthusiastic and personable while staying professional',
  concise: 'brief and direct (max ~170 words)',
};

function coverLetterPrompt({ profile, job, resume, settings }) {
  return {
    system: `You write cover letters that get interviews. Tone: ${TONES[settings.tone] || TONES.professional}. Use only facts present in the candidate's resume/notes. Connect 2–3 of the candidate's most relevant achievements to the company's needs from the posting. No clichés ("I am writing to express my interest"), no placeholders like [Company] — if the company or hiring manager name is unknown, write naturally without it. 3–4 short paragraphs plus greeting and sign-off with the candidate's name. ${langInstruction(settings.lang)} Output only JSON.`,
    user: `Return JSON: { "subject": string, "body": string }   // body uses \\n\\n between paragraphs

CANDIDATE RESUME (tailored for this job):
"""
${JSON.stringify(resume || profile.resume || profile.raw)}
"""
${profile.notes ? `\nCANDIDATE NOTES:\n"""\n${profile.notes}\n"""` : ''}

JOB POSTING${job.title ? ` — ${job.title}` : ''}${job.company ? ` at ${job.company}` : ''}:
"""
${job.description}
"""`,
  };
}

function interviewPrompt({ profile, job, resume, settings }) {
  return {
    system: `You are an interview coach. Predict the questions this candidate is most likely to be asked for this job (mix of behavioral, technical/role-specific, and about gaps in their profile) and draft strong answers using only facts from the candidate's resume (use the STAR method for behavioral ones). ${langInstruction(settings.lang)} Output only JSON.`,
    user: `Return JSON: { "questions": [ { "question": string, "why": string, "answer": string } ], "questionsToAsk": string[] }
Give 10 questions and 4 smart questions the candidate can ask the interviewer.

CANDIDATE RESUME:
"""
${JSON.stringify(resume || profile.resume || profile.raw)}
"""

JOB POSTING:
"""
${job.description}
"""`,
  };
}

function formAnswerPrompt({ profile, job, resume, question, settings }) {
  return {
    system: `You help a candidate answer questions in job application forms. Answer in first person, truthfully, using only facts from the resume and notes, tailored to this company and role. Be concise (60–150 words unless the question asks for something else). ${langInstruction(settings.lang)} Output only JSON.`,
    user: `Return JSON: { "answer": string }

QUESTION: ${question}

CANDIDATE RESUME:
"""
${JSON.stringify(resume || profile.resume || profile.raw)}
"""
${profile.notes ? `\nCANDIDATE NOTES:\n"""\n${profile.notes}\n"""` : ''}

JOB POSTING:
"""
${job.description}
"""`,
  };
}
