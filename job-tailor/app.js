
// Librerías para leer PDF y DOCX; se cargan solo cuando hacen falta, con un CDN de respaldo.
const CDNS = ['https://cdn.jsdelivr.net/npm/', 'https://unpkg.com/'];
const PDFJS = 'pdfjs-dist@4.4.168/build/';
const MAMMOTH = 'mammoth@1.8.0/mammoth.browser.min.js';
const LIB_ERROR = 'No se pudo descargar el lector de archivos (revisa tu conexión a internet). Mientras tanto, abre tu CV, copia todo el texto y pégalo en el recuadro.';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

let S = defaultState();
let currentJobId = null;
let detailTab = 'resume';
let editingResume = false;
let batchStop = false;
const busy = new Set();

const save = () => saveState(S);
const statusLabel = id => STATUSES.find(s => s.id === id)?.label || id;
const getJob = id => S.jobs.find(j => j.id === id);

function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), isError ? 7000 : 3000);
}

async function withBusy(key, fn) {
  if (busy.has(key)) return;
  busy.add(key);
  refreshDetailIfOpen();
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    toast(e.message || String(e), true);
  } finally {
    busy.delete(key);
    refreshDetailIfOpen();
  }
}

function copy(text) {
  navigator.clipboard.writeText(text).then(() => toast('Copiado al portapapeles'), () => toast('No se pudo copiar', true));
}

function profileText() {
  return [S.profile.resume ? resumeToText(S.profile.resume) : S.profile.raw, S.profile.notes].filter(Boolean).join('\n');
}

// La IA cambió de modelo porque el configurado fue retirado por el proveedor.
function modelChanged(model) {
  save();
  if ($('#set-provider').value === S.settings.provider) $('#set-model').value = model;
  toast(`El modelo anterior ya no está disponible. Ahora se usa ${model}.`);
}

function hasProfile() {
  return !!(S.profile.resume || S.profile.raw.trim());
}

function aiReady() {
  const cfg = providerConfig(S.settings);
  return !PROVIDERS[cfg.id].needsKey || !!cfg.key;
}

function updateBanner() {
  const b = $('#banner');
  const msgs = [];
  if (!aiReady()) msgs.push('Configura un proveedor de IA (hay opciones gratis) en <a href="#" data-goto="settings">Ajustes</a>.');
  if (!hasProfile()) msgs.push('Pega o sube tu CV maestro en <a href="#" data-goto="profile">Mi CV</a>.');
  b.innerHTML = msgs.join(' ');
  b.classList.toggle('hidden', !msgs.length);
}

// ---------------------------------------------------------------------------
// Navegación
// ---------------------------------------------------------------------------
function showView(view) {
  $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  if (view === 'jobs') currentJobId ? renderDetail() : renderJobs();
  if (view === 'tracker') renderTracker();
  if (view === 'profile') renderProfilePreview();
  window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------------------
// Lectura de archivos (PDF / DOCX / TXT)
// ---------------------------------------------------------------------------
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('No se pudo cargar ' + src));
    document.head.appendChild(s);
  });
}

async function extractText(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) {
    let pdfjs = null;
    let base = '';
    for (const cdn of CDNS) {
      try { pdfjs = await import(cdn + PDFJS + 'pdf.min.mjs'); base = cdn + PDFJS; break; } catch (e) { console.warn(e); }
    }
    if (!pdfjs) throw new Error(LIB_ERROR);
    pdfjs.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      let lastY = null;
      let line = '';
      const lines = [];
      for (const it of content.items) {
        const y = it.transform?.[5];
        if (lastY !== null && Math.abs(y - lastY) > 2) { lines.push(line); line = ''; }
        line += it.str;
        lastY = y;
      }
      lines.push(line);
      pages.push(lines.join('\n'));
    }
    return pages.join('\n\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  if (name.endsWith('.docx')) {
    for (const cdn of CDNS) {
      if (window.mammoth) break;
      try { await loadScript(cdn + MAMMOTH); } catch (e) { console.warn(e); }
    }
    if (!window.mammoth) throw new Error(LIB_ERROR);
    const res = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return res.value.replace(/\n{3,}/g, '\n\n').trim();
  }
  if (name.endsWith('.doc')) throw new Error('Los archivos .doc antiguos no se pueden leer. Guárdalo como .docx o PDF desde Word, o pega el texto.');
  return (await file.text()).trim();
}

// Lee el texto de una oferta publicada en una URL usando r.jina.ai (gratis, permite CORS).
async function fetchJobFromUrl(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error('URL inválida');
  const res = await fetch('https://r.jina.ai/' + url, { headers: { Accept: 'text/plain' } });
  if (!res.ok) throw new Error(`No se pudo leer la URL (${res.status}). Copia y pega la descripción manualmente.`);
  const text = (await res.text()).trim();
  if (text.length < 200) throw new Error('La página no devolvió suficiente texto (puede requerir inicio de sesión). Pega la descripción manualmente.');
  const title = (text.match(/^Title:\s*(.+)$/m) || [])[1] || '';
  const body = text.replace(/^(Title|URL Source|Published Time|Markdown Content):.*$/gm, '').trim();
  return { title: title.trim(), description: body.slice(0, 20000) };
}

// ---------------------------------------------------------------------------
// Perfil / CV maestro
// ---------------------------------------------------------------------------
function initProfile() {
  $('#cv-raw').value = S.profile.raw;
  $('#cv-notes').value = S.profile.notes;
  $('#cv-raw').addEventListener('input', e => { S.profile.raw = e.target.value; save(); updateBanner(); });
  $('#cv-notes').addEventListener('input', e => { S.profile.notes = e.target.value; save(); });

  $('#cv-file').addEventListener('change', e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) loadCvFile(file);
  });
  const raw = $('#cv-raw');
  raw.addEventListener('dragover', e => { e.preventDefault(); raw.classList.add('dropping'); });
  raw.addEventListener('dragleave', () => raw.classList.remove('dropping'));
  raw.addEventListener('drop', e => {
    raw.classList.remove('dropping');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    e.preventDefault();
    loadCvFile(file);
  });

  $('#btn-save-cv').addEventListener('click', () => { save(); toast('CV guardado'); });

  $('#btn-parse-cv').addEventListener('click', async e => {
    if (!S.profile.raw.trim()) return toast('Primero pega o sube tu CV.', true);
    const btn = e.target;
    btn.disabled = true;
    $('#cv-status').textContent = 'Analizando tu CV con IA…';
    try {
      const { system, user } = parseResumePrompt(S.profile.raw, S.profile.notes);
      const resume = await callAI(S.settings, system, user, { onModelChange: modelChanged, onRetry: m => ($('#cv-status').textContent = m) });
      S.profile.resume = resume;
      S.profile.updatedAt = new Date().toISOString();
      save();
      renderProfilePreview();
      $('#cv-status').textContent = '✓ CV estructurado. Revísalo a la derecha.';
    } catch (err) {
      $('#cv-status').textContent = '';
      toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  $('#btn-toggle-json').addEventListener('click', () => {
    const wrap = $('#profile-json-wrap');
    wrap.classList.toggle('hidden');
    if (!wrap.classList.contains('hidden')) $('#profile-json').value = JSON.stringify(S.profile.resume || {}, null, 2);
  });
  $('#btn-save-json').addEventListener('click', () => {
    try {
      S.profile.resume = JSON.parse($('#profile-json').value);
      save();
      renderProfilePreview();
      toast('JSON aplicado');
    } catch (err) {
      toast('JSON inválido: ' + err.message, true);
    }
  });

  fillTemplateSelect($('#profile-template'), S.settings.template);
  $('#profile-template').addEventListener('change', e => { S.settings.template = e.target.value; save(); renderProfilePreview(); });
}

async function loadCvFile(file) {
  const st = $('#cv-file-status');
  st.textContent = 'Leyendo ' + file.name + '…';
  try {
    const text = await extractText(file);
    if (!text) throw new Error('No se encontró texto en el archivo (¿es un PDF escaneado como imagen?). Copia y pega el texto manualmente.');
    $('#cv-raw').value = S.profile.raw = text;
    save();
    updateBanner();
    st.textContent = `✓ ${file.name} cargado. Ahora pulsa "Estructurar con IA".`;
  } catch (err) {
    console.error(err);
    st.textContent = '✕ ' + err.message;
    toast(err.message, true);
  }
}

function renderProfilePreview() {
  const el = $('#profile-preview');
  el.innerHTML = S.profile.resume
    ? `<div class="paper">${renderResume(S.profile.resume, S.settings.template)}</div>`
    : '<div class="empty">Aún no has estructurado tu CV. Puedes adaptar CVs igual con el texto plano, pero estructurarlo mejora los resultados.</div>';
}

function fillTemplateSelect(sel, value) {
  sel.innerHTML = TEMPLATES.map(t => `<option value="${t.id}">${t.label}</option>`).join('');
  sel.value = value || 'classic';
}

// ---------------------------------------------------------------------------
// Ofertas
// ---------------------------------------------------------------------------
function addJob({ title = '', company = '', url = '', description = '' }) {
  const job = {
    id: uid(), title: title.trim(), company: company.trim(), url: url.trim(), description: description.trim(),
    status: 'saved', createdAt: new Date().toISOString(), appliedAt: null, notes: '',
    result: null, editedHtml: null, template: null, cover: null, interview: null, formAnswers: [],
    scoreBefore: null, scoreAfter: null,
  };
  S.jobs.unshift(job);
  save();
  return job;
}

function initJobs() {
  $('#jobs-filter').innerHTML = '<option value="">Todos los estados</option>' + STATUSES.map(s => `<option value="${s.id}">${s.label}</option>`).join('');
  $('#jobs-filter').addEventListener('change', renderJobs);
  $('#jobs-search').addEventListener('input', renderJobs);

  $('#btn-fetch-url').addEventListener('click', async e => {
    const url = $('#job-url').value.trim();
    if (!url) return toast('Pega primero la URL', true);
    e.target.disabled = true;
    try {
      const { title, description } = await fetchJobFromUrl(url);
      $('#job-desc').value = description;
      if (!$('#job-title').value && title) $('#job-title').value = title.slice(0, 120);
      toast('Texto importado. Revisa y limpia lo que no sea parte de la oferta.');
    } catch (err) {
      toast(err.message, true);
    } finally {
      e.target.disabled = false;
    }
  });

  const readForm = () => ({ title: $('#job-title').value, company: $('#job-company').value, url: $('#job-url').value, description: $('#job-desc').value });
  const clearForm = () => ['#job-title', '#job-company', '#job-url', '#job-desc'].forEach(s => ($(s).value = ''));

  $('#btn-add-job').addEventListener('click', () => {
    const f = readForm();
    if (f.description.trim().length < 50) return toast('Pega la descripción completa de la oferta.', true);
    addJob(f);
    clearForm();
    renderJobs();
    toast('Oferta agregada');
  });
  $('#btn-add-gen').addEventListener('click', () => {
    const f = readForm();
    if (f.description.trim().length < 50) return toast('Pega la descripción completa de la oferta.', true);
    const job = addJob(f);
    clearForm();
    openJob(job.id);
    runTailor(job.id);
  });

  $('#btn-bulk-add').addEventListener('click', async e => {
    const raw = $('#bulk-text').value.trim();
    if (!raw) return;
    const st = $('#bulk-status');
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    const onlyUrls = lines.every(l => /^https?:\/\/\S+$/i.test(l));
    let added = 0;
    e.target.disabled = true;
    if (onlyUrls) {
      for (const [i, url] of lines.entries()) {
        st.textContent = `Leyendo ${i + 1}/${lines.length}…`;
        try {
          const { title, description } = await fetchJobFromUrl(url);
          addJob({ title, url, description });
          added++;
        } catch (err) {
          addJob({ url, description: '' });
          toast(`${url}: ${err.message}`, true);
        }
      }
    } else {
      for (const chunk of raw.split(/^\s*-{3,}\s*$/m)) {
        const text = chunk.trim();
        if (text.length < 50) continue;
        const url = (text.match(/https?:\/\/\S+/) || [])[0] || '';
        addJob({ url, description: text });
        added++;
      }
    }
    e.target.disabled = false;
    st.textContent = `✓ ${added} oferta(s) importada(s).`;
    $('#bulk-text').value = '';
    renderJobs();
  });

  $('#btn-batch').addEventListener('click', runBatch);
  $('#btn-batch-stop').addEventListener('click', () => { batchStop = true; toast('Se detendrá al terminar la oferta actual.'); });
}

function scorePill(job) {
  const s = job.scoreAfter?.score ?? job.scoreBefore?.score;
  if (s == null) return '';
  const cls = s >= 70 ? 'ok' : s >= 45 ? 'warn' : 'bad';
  return `<span class="pill ${cls}" title="Coincidencia de palabras clave (ATS)">ATS ${s}%</span>`;
}

function renderJobs() {
  const q = $('#jobs-search').value.toLowerCase();
  const f = $('#jobs-filter').value;
  const list = S.jobs.filter(j => (!f || j.status === f) && (!q || `${j.title} ${j.company} ${j.description}`.toLowerCase().includes(q)));
  $('#jobs-count').textContent = S.jobs.length;
  const el = $('#jobs-list');
  if (!list.length) {
    el.innerHTML = `<div class="empty">${S.jobs.length ? 'Ninguna oferta coincide con el filtro.' : 'Aún no tienes ofertas. Agrega la primera arriba.'}</div>`;
    return;
  }
  el.innerHTML = list.map(j => `
    <div class="job-item" data-id="${j.id}">
      <div>
        <b>${esc(j.title || j.result?.jobTitle || 'Oferta sin título')}</b>${j.company ? ` · ${esc(j.company)}` : ''}
        <div class="meta">${new Date(j.createdAt).toLocaleDateString()} · ${j.description ? esc(j.description.slice(0, 110).replace(/\s+/g, ' ')) + '…' : '<i>sin descripción</i>'}</div>
      </div>
      <div class="actions">
        ${scorePill(j)}
        <span class="pill">${statusLabel(j.status)}</span>
        ${j.result ? '' : `<button class="btn small" data-act="tailor">Adaptar</button>`}
        <button class="btn danger small" data-act="del" title="Eliminar">✕</button>
      </div>
    </div>`).join('');
}

function onJobsListClick(e) {
  const item = e.target.closest('.job-item');
  if (!item) return;
  const id = item.dataset.id;
  const act = e.target.dataset.act;
  if (act === 'del') {
    if (confirm('¿Eliminar esta oferta?')) { S.jobs = S.jobs.filter(j => j.id !== id); save(); renderJobs(); }
    return;
  }
  openJob(id);
  if (act === 'tailor') runTailor(id);
}

function openJob(id) {
  currentJobId = id;
  detailTab = 'resume';
  editingResume = false;
  $('#jobs-list-pane').classList.add('hidden');
  $('#job-detail-pane').classList.remove('hidden');
  if (!$('#view-jobs').classList.contains('active')) showView('jobs'); else renderDetail();
}

function closeJob() {
  currentJobId = null;
  $('#job-detail-pane').classList.add('hidden');
  $('#jobs-list-pane').classList.remove('hidden');
  renderJobs();
}

// ---------------------------------------------------------------------------
// Generación con IA
// ---------------------------------------------------------------------------
function ensureReady(job) {
  if (!hasProfile()) throw new Error('Primero agrega tu CV maestro en "Mi CV".');
  if (!aiReady()) throw new Error('Configura tu proveedor de IA en Ajustes.');
  if (!job.description || job.description.length < 50) throw new Error('La oferta no tiene descripción.');
}

async function tailor(job, onStatus) {
  ensureReady(job);
  const { system, user } = tailorPrompt({ profile: S.profile, job, settings: S.settings });
  const out = await callAI(S.settings, system, user, { maxTokens: 12000, onRetry: onStatus, onModelChange: modelChanged });
  if (!out?.resume) throw new Error('La respuesta de la IA no incluyó el CV.');
  job.result = {
    resume: out.resume,
    fitScore: Number(out.fitScore) || null,
    fitSummary: out.fitSummary || '',
    keywords: out.keywords || [],
    changes: out.changes || [],
    gaps: out.gaps || [],
    generatedAt: new Date().toISOString(),
  };
  if (!job.title && out.jobTitle) job.title = out.jobTitle;
  if (!job.company && out.company) job.company = out.company;
  job.editedHtml = null;
  job.scoreBefore = scoreMatch(job.description, profileText());
  job.scoreAfter = scoreMatch(job.description, resumeToText(out.resume));
  if (job.status === 'saved') job.status = 'ready';
  save();
}

async function cover(job, onStatus) {
  ensureReady(job);
  const { system, user } = coverLetterPrompt({ profile: S.profile, job, resume: job.result?.resume, settings: S.settings });
  const out = await callAI(S.settings, system, user, { maxTokens: 3000, onRetry: onStatus, onModelChange: modelChanged });
  job.cover = { subject: out.subject || '', body: out.body || out.coverLetter || '', generatedAt: new Date().toISOString() };
  save();
}

async function interview(job, onStatus) {
  ensureReady(job);
  const { system, user } = interviewPrompt({ profile: S.profile, job, resume: job.result?.resume, settings: S.settings });
  const out = await callAI(S.settings, system, user, { maxTokens: 6000, onRetry: onStatus, onModelChange: modelChanged });
  job.interview = { questions: out.questions || [], questionsToAsk: out.questionsToAsk || [], generatedAt: new Date().toISOString() };
  save();
}

const runTailor = id => withBusy(id + ':tailor', async () => { await tailor(getJob(id), toast); detailTab = 'resume'; toast('CV adaptado ✓'); });
const runCover = id => withBusy(id + ':cover', async () => { await cover(getJob(id), toast); detailTab = 'cover'; toast('Carta generada ✓'); });
const runInterview = id => withBusy(id + ':interview', async () => { await interview(getJob(id), toast); detailTab = 'interview'; toast('Preparación lista ✓'); });

async function runBatch() {
  const pending = S.jobs.filter(j => !j.result && j.description && j.description.length >= 50).reverse();
  if (!pending.length) return toast('No hay ofertas pendientes por adaptar.');
  try { ensureReady(pending[0]); } catch (e) { return toast(e.message, true); }
  const withCover = $('#batch-cover').checked;
  const withInterview = $('#batch-interview').checked;
  const prog = $('#batch-progress');
  const bar = $('.bar', prog);
  const label = $('span', prog);
  batchStop = false;
  prog.classList.remove('hidden');
  $('#btn-batch').disabled = true;
  $('#btn-batch-stop').classList.remove('hidden');
  let ok = 0;
  let fail = 0;
  for (const [i, job] of pending.entries()) {
    if (batchStop) break;
    const name = job.title || job.company || `oferta ${i + 1}`;
    const status = m => (label.textContent = `${i + 1}/${pending.length} · ${name}: ${m}`);
    bar.style.width = `${(i / pending.length) * 100}%`;
    try {
      status('adaptando CV…');
      await tailor(job, status);
      if (withCover) { status('escribiendo carta…'); await cover(job, status); }
      if (withInterview) { status('preparando entrevista…'); await interview(job, status); }
      ok++;
    } catch (e) {
      fail++;
      console.error(e);
      toast(`${name}: ${e.message}`, true);
      if (/api key|401|403/i.test(e.message)) break;
    }
    renderJobs();
    if (i < pending.length - 1 && S.settings.delay > 0 && !batchStop) {
      status(`pausa de ${S.settings.delay} s…`);
      await new Promise(r => setTimeout(r, S.settings.delay * 1000));
    }
  }
  bar.style.width = '100%';
  label.textContent = `Listo: ${ok} adaptadas${fail ? `, ${fail} con error` : ''}${batchStop ? ' (detenido)' : ''}.`;
  $('#btn-batch').disabled = false;
  $('#btn-batch-stop').classList.add('hidden');
  renderJobs();
}

// ---------------------------------------------------------------------------
// Detalle de oferta
// ---------------------------------------------------------------------------
function refreshDetailIfOpen() {
  if (currentJobId && $('#view-jobs').classList.contains('active')) renderDetail();
  else if ($('#view-jobs').classList.contains('active')) renderJobs();
}

function btn(id, kind, label, cls = '') {
  const b = busy.has(id + ':' + kind);
  return `<button class="btn ${cls}" data-act="${kind}" ${b ? 'disabled' : ''}>${b ? 'Generando…' : label}</button>`;
}

function renderDetail() {
  const job = getJob(currentJobId);
  if (!job) return closeJob();
  const pane = $('#job-detail-pane');
  const tpl = job.template || S.settings.template;
  const tabs = [['resume', 'CV adaptado'], ['cover', 'Carta'], ['interview', 'Entrevista'], ['analysis', 'Análisis ATS'], ['form', 'Preguntas del formulario'], ['posting', 'Oferta']];

  pane.innerHTML = `
    <div class="card">
      <div class="row space wrap">
        <button class="btn secondary small" data-act="back">← Volver</button>
        <div class="row wrap" style="margin:0">
          ${scorePill(job)}
          <select data-field="status" style="width:auto">${STATUSES.map(s => `<option value="${s.id}" ${s.id === job.status ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
          ${job.url ? `<a class="btn secondary small" href="${esc(job.url)}" target="_blank" rel="noopener">Abrir oferta ↗</a>` : ''}
          <button class="btn small" data-act="applied">Marcar como aplicada</button>
        </div>
      </div>
      <div class="grid-2 tight">
        <div><label>Cargo</label><input data-field="title" value="${esc(job.title)}"></div>
        <div><label>Empresa</label><input data-field="company" value="${esc(job.company)}"></div>
      </div>
      <div class="row wrap">
        ${btn(job.id, 'tailor', job.result ? 'Volver a adaptar CV' : 'Adaptar CV')}
        ${btn(job.id, 'cover', job.cover ? 'Nueva carta' : 'Carta de presentación', 'secondary')}
        ${btn(job.id, 'interview', job.interview ? 'Nuevas preguntas' : 'Preparar entrevista', 'secondary')}
      </div>
    </div>
    <div class="card">
      <div class="subtabs">${tabs.map(([id, l]) => `<button data-tab="${id}" class="${detailTab === id ? 'active' : ''}">${l}</button>`).join('')}</div>
      <div id="detail-body">${detailBody(job, tpl)}</div>
    </div>`;
}

function detailBody(job, tpl) {
  if (detailTab === 'resume') {
    if (!job.result) return `<div class="empty">Pulsa <b>Adaptar CV</b> para generar una versión de tu hoja de vida optimizada para esta oferta.</div>`;
    const html = job.editedHtml || renderResume(job.result.resume, tpl);
    return `
      <div class="row wrap" style="margin-top:0">
        <select data-field="template" style="width:auto">${TEMPLATES.map(t => `<option value="${t.id}" ${t.id === tpl ? 'selected' : ''}>${t.label}</option>`).join('')}</select>
        <button class="btn secondary small" data-act="edit">${editingResume ? 'Guardar edición' : 'Editar texto'}</button>
        ${job.editedHtml ? '<button class="btn secondary small" data-act="reset-edit">Descartar ediciones</button>' : ''}
        <button class="btn small" data-act="pdf">Descargar PDF</button>
        <button class="btn secondary small" data-act="word">Word</button>
        <button class="btn secondary small" data-act="txt">TXT</button>
        <button class="btn secondary small" data-act="copy-cv">Copiar texto</button>
      </div>
      <div class="cv-layout">
        <div class="paper-wrap"><div class="paper" id="cv-paper" ${editingResume ? 'contenteditable="true"' : ''}>${html}</div></div>
        <div>
          ${job.result.fitScore != null ? `<h3>Compatibilidad estimada: ${job.result.fitScore}/100</h3><p class="muted small">${esc(job.result.fitSummary)}</p>` : ''}
          ${listBlock('Qué se cambió', job.result.changes)}
          ${listBlock('Brechas (agrega solo si es verdad)', job.result.gaps)}
        </div>
      </div>`;
  }
  if (detailTab === 'cover') {
    if (!job.cover) return `<div class="empty">Pulsa <b>Carta de presentación</b> para generarla${job.result ? '' : ' (mejor después de adaptar el CV)'}.</div>`;
    return `
      <label>Asunto (para correo)</label><input data-field="cover-subject" value="${esc(job.cover.subject)}">
      <label>Carta</label><textarea data-field="cover-body" rows="16">${esc(job.cover.body)}</textarea>
      <div class="row wrap">
        <button class="btn small" data-act="cover-pdf">Descargar PDF</button>
        <button class="btn secondary small" data-act="cover-word">Word</button>
        <button class="btn secondary small" data-act="cover-copy">Copiar</button>
      </div>`;
  }
  if (detailTab === 'interview') {
    if (!job.interview) return '<div class="empty">Pulsa <b>Preparar entrevista</b> para generar preguntas probables y respuestas basadas en tu experiencia.</div>';
    return `${job.interview.questions.map((q, i) => `
      <div class="qa"><b>${i + 1}. ${esc(q.question)}</b>${q.why ? `<div class="why">${esc(q.why)}</div>` : ''}<div>${esc(q.answer).replace(/\n/g, '<br>')}</div></div>`).join('')}
      ${listBlock('Preguntas para hacerle al entrevistador', job.interview.questionsToAsk)}`;
  }
  if (detailTab === 'analysis') {
    const before = job.scoreBefore || scoreMatch(job.description, profileText());
    const after = job.scoreAfter;
    return `
      <div class="score">
        <div><div class="muted small">CV maestro</div><div class="big">${before.score}%</div></div>
        ${after ? `<div><div class="muted small">CV adaptado</div><div class="big" style="color:var(--ok)">${after.score}%</div></div>` : ''}
        ${job.result?.fitScore != null ? `<div><div class="muted small">Compatibilidad (IA)</div><div class="big">${job.result.fitScore}</div></div>` : ''}
      </div>
      <p class="muted small">Porcentaje de las palabras clave más importantes de la oferta que aparecen en tu CV (calculado localmente, similar a un ATS).</p>
      <h3>Palabras clave encontradas</h3><div class="chips">${(after || before).hits.map(k => `<span class="chip hit">${esc(k)}</span>`).join('') || '<span class="muted small">Ninguna</span>'}</div>
      <h3>Palabras clave faltantes</h3><div class="chips">${(after || before).misses.map(k => `<span class="chip miss">${esc(k)}</span>`).join('') || '<span class="muted small">Ninguna</span>'}</div>
      ${job.result?.keywords?.length ? `<h3>Requisitos clave según la IA</h3><div class="chips">${job.result.keywords.map(k => `<span class="chip">${esc(k)}</span>`).join('')}</div>` : ''}`;
  }
  if (detailTab === 'form') {
    return `
      <p class="muted small">¿El formulario de postulación hace preguntas como "¿Por qué quieres trabajar aquí?" o "Describe un reto que resolviste"? Pégala y obtén una respuesta basada en tu CV.</p>
      <textarea id="form-question" rows="3" placeholder="Pega la pregunta del formulario"></textarea>
      <div class="row">${btn(job.id, 'form', 'Responder')}</div>
      ${(job.formAnswers || []).map((qa, i) => `
        <div class="qa"><b>${esc(qa.q)}</b><div>${esc(qa.a).replace(/\n/g, '<br>')}</div>
          <div class="row"><button class="btn secondary small" data-act="form-copy" data-i="${i}">Copiar</button><button class="btn danger small" data-act="form-del" data-i="${i}">Eliminar</button></div></div>`).join('')}`;
  }
  return `
    <label>URL</label><input data-field="url" value="${esc(job.url)}">
    <label>Descripción de la oferta</label><textarea data-field="description" rows="18">${esc(job.description)}</textarea>
    <label>Notas personales</label><textarea data-field="notes" rows="3" placeholder="Contacto, salario, fecha de entrevista…">${esc(job.notes)}</textarea>`;
}

function listBlock(title, items) {
  if (!items?.length) return '';
  return `<h3>${esc(title)}</h3><ul class="clean">${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`;
}

function docTitle(job, kind) {
  const name = job.result?.resume?.name || S.profile.resume?.name || 'CV';
  return `${kind} - ${name} - ${job.company || job.title || 'Oferta'}`;
}

function currentResumeHtml(job) {
  return job.editedHtml || renderResume(job.result.resume, job.template || S.settings.template);
}

function onDetailClick(e) {
  const tab = e.target.closest('[data-tab]');
  if (tab) { detailTab = tab.dataset.tab; editingResume = false; renderDetail(); return; }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const job = getJob(currentJobId);
  if (!job) return;
  const act = el.dataset.act;
  try {
    switch (act) {
      case 'back': return closeJob();
      case 'tailor': return runTailor(job.id);
      case 'cover': return runCover(job.id);
      case 'interview': return runInterview(job.id);
      case 'applied':
        job.status = 'applied';
        job.appliedAt = new Date().toISOString();
        save();
        renderDetail();
        return toast('Marcada como aplicada');
      case 'edit':
        if (editingResume) {
          job.editedHtml = $('#cv-paper').innerHTML;
          save();
          toast('Edición guardada');
        }
        editingResume = !editingResume;
        return renderDetail();
      case 'reset-edit':
        if (confirm('¿Descartar tus ediciones manuales?')) { job.editedHtml = null; editingResume = false; save(); renderDetail(); }
        return;
      case 'pdf': return printHtml(docTitle(job, 'CV'), currentResumeHtml(job));
      case 'word': return downloadWord(safeFile(docTitle(job, 'CV')) + '.doc', docTitle(job, 'CV'), currentResumeHtml(job));
      case 'txt': return download(safeFile(docTitle(job, 'CV')) + '.txt', resumeToText(job.result.resume));
      case 'copy-cv': return copy(job.editedHtml ? $('#cv-paper').innerText : resumeToText(job.result.resume));
      case 'cover-pdf': return printHtml(docTitle(job, 'Carta'), letterHtml(job.cover.body));
      case 'cover-word': return downloadWord(safeFile(docTitle(job, 'Carta')) + '.doc', docTitle(job, 'Carta'), letterHtml(job.cover.body));
      case 'cover-copy': return copy(job.cover.body);
      case 'form': {
        const q = $('#form-question').value.trim();
        if (!q) return toast('Escribe la pregunta', true);
        return withBusy(job.id + ':form', async () => {
          ensureReady(job);
          const { system, user } = formAnswerPrompt({ profile: S.profile, job, resume: job.result?.resume, question: q, settings: S.settings });
          const out = await callAI(S.settings, system, user, { maxTokens: 2000, onRetry: toast, onModelChange: modelChanged });
          job.formAnswers = [{ q, a: out.answer || '' }, ...(job.formAnswers || [])];
          save();
        });
      }
      case 'form-copy': return copy(job.formAnswers[+el.dataset.i].a);
      case 'form-del': job.formAnswers.splice(+el.dataset.i, 1); save(); return renderDetail();
    }
  } catch (err) {
    toast(err.message, true);
  }
}

function onDetailInput(e) {
  const field = e.target.dataset.field;
  const job = getJob(currentJobId);
  if (!field || !job) return;
  const v = e.target.value;
  if (field === 'cover-subject') job.cover.subject = v;
  else if (field === 'cover-body') job.cover.body = v;
  else if (field === 'template') { job.template = v; job.editedHtml = null; save(); return renderDetail(); }
  else if (field === 'status') { job.status = v; if (v === 'applied' && !job.appliedAt) job.appliedAt = new Date().toISOString(); save(); return renderDetail(); }
  else if (field === 'description') { job.description = v; job.scoreBefore = null; job.scoreAfter = job.result ? scoreMatch(v, resumeToText(job.result.resume)) : null; }
  else job[field] = v;
  save();
}

// ---------------------------------------------------------------------------
// Seguimiento (kanban)
// ---------------------------------------------------------------------------
function renderTracker() {
  const count = id => S.jobs.filter(j => j.status === id).length;
  const applied = S.jobs.filter(j => ['applied', 'interview', 'offer', 'rejected'].includes(j.status)).length;
  const rate = applied ? Math.round(((count('interview') + count('offer')) / applied) * 100) : 0;
  $('#tracker-stats').innerHTML = `
    <div class="stat"><b>${S.jobs.length}</b>Ofertas</div>
    <div class="stat"><b>${S.jobs.filter(j => j.result).length}</b>CVs adaptados</div>
    <div class="stat"><b>${applied}</b>Postulaciones</div>
    <div class="stat"><b>${count('interview')}</b>Entrevistas</div>
    <div class="stat"><b>${count('offer')}</b>Ofertas recibidas</div>
    <div class="stat"><b>${rate}%</b>Tasa de respuesta</div>`;
  $('#kanban').innerHTML = STATUSES.map(s => `
    <div class="col" data-status="${s.id}">
      <h3>${s.label} <span class="pill">${count(s.id)}</span></h3>
      ${S.jobs.filter(j => j.status === s.id).map(j => `
        <div class="kcard" draggable="true" data-id="${j.id}">
          <b>${esc(j.title || 'Sin título')}</b>
          <small>${esc(j.company || '')}${j.appliedAt ? ' · ' + new Date(j.appliedAt).toLocaleDateString() : ''}</small>
        </div>`).join('')}
    </div>`).join('');
}

function initTracker() {
  const k = $('#kanban');
  k.addEventListener('dragstart', e => { const c = e.target.closest('.kcard'); if (c) e.dataTransfer.setData('text/plain', c.dataset.id); });
  k.addEventListener('dragover', e => { const col = e.target.closest('.col'); if (col) { e.preventDefault(); col.classList.add('drag'); } });
  k.addEventListener('dragleave', e => e.target.closest('.col')?.classList.remove('drag'));
  k.addEventListener('drop', e => {
    const col = e.target.closest('.col');
    if (!col) return;
    e.preventDefault();
    const job = getJob(e.dataTransfer.getData('text/plain'));
    if (job) {
      job.status = col.dataset.status;
      if (job.status === 'applied' && !job.appliedAt) job.appliedAt = new Date().toISOString();
      save();
    }
    renderTracker();
  });
  k.addEventListener('click', e => { const c = e.target.closest('.kcard'); if (c) openJob(c.dataset.id); });
}

// ---------------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------------
function initSettings() {
  const sel = $('#set-provider');
  sel.innerHTML = Object.entries(PROVIDERS).map(([id, p]) => `<option value="${id}">${p.label}</option>`).join('');
  sel.value = S.settings.provider;
  const fillProvider = () => {
    const id = sel.value;
    const p = PROVIDERS[id];
    const cfg = providerConfig({ ...S.settings, provider: id });
    $('#provider-help').innerHTML = p.help;
    $('#set-key').value = cfg.key;
    $('#set-key-wrap').querySelector('label').textContent = p.needsKey ? 'API key' : 'API key (opcional)';
    $('#set-baseurl-wrap').classList.toggle('hidden', !p.baseUrl);
    $('#set-baseurl').value = cfg.baseUrl;
    $('#set-model').value = cfg.model;
    $('#model-suggestions').innerHTML = p.models.map(m => `<option value="${m}">`).join('');
  };
  sel.addEventListener('change', fillProvider);
  fillProvider();

  const storeProvider = () => {
    const id = sel.value;
    S.settings.provider = id;
    S.settings.keys[id] = $('#set-key').value.trim();
    S.settings.models[id] = $('#set-model').value.trim();
    if (PROVIDERS[id].baseUrl) S.settings.baseUrls[id] = $('#set-baseurl').value.trim();
    save();
    updateBanner();
  };
  $('#btn-list-models').addEventListener('click', async e => {
    storeProvider();
    e.target.disabled = true;
    $('#settings-status').textContent = 'Buscando modelos…';
    try {
      const models = await listModels(S.settings);
      if (!models.length) throw new Error('El proveedor no devolvió modelos.');
      $('#model-suggestions').innerHTML = models.map(m => `<option value="${esc(m)}">`).join('');
      // El proveedor puede seguir listando modelos retirados, así que siempre se propone el más reciente recomendado.
      const best = pickModel(sel.value, models);
      if (best) $('#set-model').value = best;
      storeProvider();
      $('#settings-status').textContent = `✓ ${models.length} modelos disponibles. Recomendado: ${$('#set-model').value}. Para elegir otro, borra el campo y verás la lista.`;
    } catch (err) {
      $('#settings-status').textContent = '';
      toast(err.message, true);
    } finally {
      e.target.disabled = false;
    }
  });
  $('#btn-save-settings').addEventListener('click', () => { storeProvider(); toast('Ajustes guardados'); });
  $('#btn-test-ai').addEventListener('click', async e => {
    storeProvider();
    e.target.disabled = true;
    $('#settings-status').textContent = 'Probando…';
    try {
      const out = await callAI(S.settings, 'Reply with JSON only.', 'Return {"ok": true, "msg": "hola"}', { maxTokens: 2000, onModelChange: modelChanged });
      $('#settings-status').textContent = out?.ok ? '✓ Conexión correcta' : '⚠ Respondió, pero en formato inesperado';
    } catch (err) {
      $('#settings-status').textContent = '';
      toast(err.message, true);
    } finally {
      e.target.disabled = false;
    }
  });

  fillTemplateSelect($('#set-template'), S.settings.template);
  const prefs = { lang: '#set-lang', level: '#set-level', length: '#set-length', tone: '#set-tone', template: '#set-template', extra: '#set-extra', delay: '#set-delay' };
  for (const [k, s] of Object.entries(prefs)) $(s).value = S.settings[k];
  $('#btn-save-prefs').addEventListener('click', () => {
    for (const [k, s] of Object.entries(prefs)) S.settings[k] = k === 'delay' ? Math.max(0, Number($(s).value) || 0) : $(s).value;
    $('#profile-template').value = S.settings.template;
    save();
    toast('Preferencias guardadas');
  });

  $('#btn-export').addEventListener('click', () => {
    const copyState = JSON.parse(JSON.stringify(S));
    if (confirm('¿Excluir tus API keys de la copia? (recomendado si la vas a compartir)')) copyState.settings.keys = {};
    download(`job-tailor-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(copyState, null, 2), 'application/json');
  });
  $('#import-file').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!confirm('Esto reemplazará tus datos actuales. ¿Continuar?')) return;
      S = mergeDefaults(data);
      save();
      location.reload();
    } catch (err) {
      toast('Archivo inválido: ' + err.message, true);
    }
  });
  $('#btn-reset').addEventListener('click', () => {
    if (!confirm('¿Borrar TODO (CV, ofertas, ajustes)? No se puede deshacer.')) return;
    S = defaultState();
    save();
    setTimeout(() => location.reload(), 400);
  });
}

// ---------------------------------------------------------------------------
async function main() {
  S = await loadState();
  const style = document.createElement('style');
  style.textContent = TEMPLATE_CSS;
  document.head.appendChild(style);
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { if (b.dataset.view === 'jobs' && currentJobId) closeJob(); showView(b.dataset.view); } });
  $('#banner').addEventListener('click', e => { const a = e.target.closest('[data-goto]'); if (a) { e.preventDefault(); showView(a.dataset.goto); } });
  $('#jobs-list').addEventListener('click', onJobsListClick);
  const pane = $('#job-detail-pane');
  pane.addEventListener('click', onDetailClick);
  pane.addEventListener('input', e => { if (e.target.tagName !== 'SELECT') onDetailInput(e); });
  pane.addEventListener('change', e => { if (e.target.tagName === 'SELECT') onDetailInput(e); });
  initProfile();
  initJobs();
  initTracker();
  initSettings();
  renderProfilePreview();
  updateBanner();
  showView(!hasProfile() ? 'profile' : 'jobs');
}

main();
