// Render del CV (JSON -> HTML) con plantillas, y exportación (PDF, Word, texto).

const TEMPLATES = [
  { id: 'classic', label: 'Clásica (ATS)' },
  { id: 'modern', label: 'Moderna' },
  { id: 'compact', label: 'Compacta' },
];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const LABELS = {
  es: { summary: 'Perfil profesional', experience: 'Experiencia', skills: 'Habilidades', education: 'Educación', projects: 'Proyectos', certifications: 'Certificaciones', languages: 'Idiomas', present: 'Actualidad' },
  en: { summary: 'Summary', experience: 'Experience', skills: 'Skills', education: 'Education', projects: 'Projects', certifications: 'Certifications', languages: 'Languages', present: 'Present' },
  pt: { summary: 'Resumo profissional', experience: 'Experiência', skills: 'Competências', education: 'Formação', projects: 'Projetos', certifications: 'Certificações', languages: 'Idiomas', present: 'Atual' },
  fr: { summary: 'Profil', experience: 'Expérience', skills: 'Compétences', education: 'Formation', projects: 'Projets', certifications: 'Certifications', languages: 'Langues', present: "Aujourd'hui" },
  de: { summary: 'Profil', experience: 'Berufserfahrung', skills: 'Kenntnisse', education: 'Ausbildung', projects: 'Projekte', certifications: 'Zertifikate', languages: 'Sprachen', present: 'Heute' },
};

const TEMPLATE_CSS = `
.cv { font-family: Calibri, "Segoe UI", Arial, sans-serif; font-size: 10.5pt; line-height: 1.35; color: #1a1a1a; }
.cv h1 { margin: 0; font-size: 21pt; letter-spacing: .3px; }
.cv .headline { font-size: 11.5pt; margin-top: 2px; }
.cv .contact { font-size: 9.5pt; color: #444; margin-top: 4px; }
.cv .contact span + span::before { content: " · "; color: #999; }
.cv section { margin-top: 12px; break-inside: auto; }
.cv h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: .8px; margin: 0 0 5px; padding-bottom: 2px; border-bottom: 1px solid #bbb; }
.cv .item { margin-bottom: 8px; break-inside: avoid; }
.cv .item-head { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.cv .item-head b { font-size: 10.5pt; }
.cv .dates { color: #555; font-size: 9.5pt; white-space: nowrap; }
.cv .sub { color: #333; font-style: italic; font-size: 10pt; }
.cv ul { margin: 3px 0 0; padding-left: 16px; }
.cv li { margin: 1px 0; }
.cv p { margin: 0; }
.cv .skills-line { margin: 2px 0; }
.cv.tpl-modern h1 { color: #2b3a8c; }
.cv.tpl-modern .headline { color: #2b3a8c; font-weight: 600; }
.cv.tpl-modern h2 { color: #2b3a8c; border-bottom: 2px solid #2b3a8c; }
.cv.tpl-modern header { border-left: 5px solid #2b3a8c; padding-left: 12px; }
.cv.tpl-compact { font-size: 9.6pt; line-height: 1.25; }
.cv.tpl-compact h1 { font-size: 17pt; }
.cv.tpl-compact section { margin-top: 8px; }
.cv.tpl-compact h2 { font-size: 10pt; }
.cv.tpl-compact .item { margin-bottom: 5px; }
.cv.tpl-classic header { text-align: center; }
.cv.tpl-classic .contact { justify-content: center; }
`;

function list(arr) { return Array.isArray(arr) ? arr.filter(x => x != null && String(typeof x === 'object' ? JSON.stringify(x) : x).trim() !== '') : []; }
function dates(start, end, L) {
  const e = end && /^(present|actual|current|presente|hoy|now)/i.test(end) ? L.present : end;
  return [start, e].filter(Boolean).map(esc).join(' – ');
}

function langOf(resume, fallback = 'es') {
  const l = (resume?.language || fallback || 'es').slice(0, 2).toLowerCase();
  return LABELS[l] ? l : 'en';
}

function renderResume(r, template = 'classic') {
  if (!r) return '<div class="empty">Sin datos</div>';
  const L = LABELS[langOf(r)];
  const c = r.contact || {};
  const contact = [c.email, c.phone, c.location, c.linkedin, c.website, ...list(c.other)]
    .filter(Boolean).map(x => `<span>${esc(x)}</span>`).join('');
  const out = [];
  out.push(`<header><h1>${esc(r.name)}</h1>${r.headline ? `<div class="headline">${esc(r.headline)}</div>` : ''}<div class="contact">${contact}</div></header>`);
  if (r.summary) out.push(`<section><h2>${L.summary}</h2><p>${esc(r.summary)}</p></section>`);

  const skills = list(r.skills);
  const skillsHtml = skills.length ? `<section><h2>${L.skills}</h2>${skills.map(s =>
    typeof s === 'string' ? `<div class="skills-line">${esc(s)}</div>`
      : `<div class="skills-line">${s.category ? `<b>${esc(s.category)}:</b> ` : ''}${list(s.items).map(esc).join(', ')}</div>`).join('')}</section>` : '';

  const exp = list(r.experience);
  const expHtml = exp.length ? `<section><h2>${L.experience}</h2>${exp.map(e => `
    <div class="item">
      <div class="item-head"><span><b>${esc(e.title)}</b>${e.company ? ` — ${esc(e.company)}` : ''}</span><span class="dates">${dates(e.start, e.end, L)}</span></div>
      ${e.location ? `<div class="sub">${esc(e.location)}</div>` : ''}
      ${list(e.bullets).length ? `<ul>${list(e.bullets).map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
    </div>`).join('')}</section>` : '';

  // Plantilla compacta y moderna ponen habilidades primero (más ATS-friendly para perfiles técnicos).
  if (template === 'classic') out.push(expHtml, skillsHtml); else out.push(skillsHtml, expHtml);

  const proj = list(r.projects);
  if (proj.length) out.push(`<section><h2>${L.projects}</h2>${proj.map(p => `
    <div class="item">
      <div class="item-head"><span><b>${esc(p.name)}</b>${list(p.tech).length ? ` <span class="sub">(${list(p.tech).map(esc).join(', ')})</span>` : ''}</span>${p.link ? `<span class="dates">${esc(p.link)}</span>` : ''}</div>
      ${p.description ? `<p>${esc(p.description)}</p>` : ''}
      ${list(p.bullets).length ? `<ul>${list(p.bullets).map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
    </div>`).join('')}</section>`);

  const edu = list(r.education);
  if (edu.length) out.push(`<section><h2>${L.education}</h2>${edu.map(e => `
    <div class="item">
      <div class="item-head"><span><b>${esc(e.degree)}</b>${e.institution ? ` — ${esc(e.institution)}` : ''}</span><span class="dates">${dates(e.start, e.end, L)}</span></div>
      ${e.details ? `<div class="sub">${esc(e.details)}</div>` : ''}
    </div>`).join('')}</section>`);

  const certs = list(r.certifications);
  if (certs.length) out.push(`<section><h2>${L.certifications}</h2><ul>${certs.map(x => `<li>${esc(typeof x === 'string' ? x : [x.name, x.issuer, x.date].filter(Boolean).join(' — '))}</li>`).join('')}</ul></section>`);
  const langs = list(r.languages);
  if (langs.length) out.push(`<section><h2>${L.languages}</h2><p>${langs.map(x => esc(typeof x === 'string' ? x : [x.language, x.level].filter(Boolean).join(' – '))).join(' · ')}</p></section>`);
  for (const sec of list(r.other)) {
    if (!sec.title) continue;
    out.push(`<section><h2>${esc(sec.title)}</h2><ul>${list(sec.items).map(i => `<li>${esc(i)}</li>`).join('')}</ul></section>`);
  }
  return `<div class="cv tpl-${esc(template)}">${out.join('')}</div>`;
}

function resumeToText(r) {
  if (!r) return '';
  const L = LABELS[langOf(r)];
  const c = r.contact || {};
  const lines = [r.name, r.headline, [c.email, c.phone, c.location, c.linkedin, c.website, ...list(c.other)].filter(Boolean).join(' | '), ''];
  if (r.summary) lines.push(L.summary.toUpperCase(), r.summary, '');
  if (list(r.skills).length) {
    lines.push(L.skills.toUpperCase());
    for (const s of list(r.skills)) lines.push(typeof s === 'string' ? s : `${s.category ? s.category + ': ' : ''}${list(s.items).join(', ')}`);
    lines.push('');
  }
  if (list(r.experience).length) {
    lines.push(L.experience.toUpperCase());
    for (const e of list(r.experience)) {
      lines.push(`${e.title}${e.company ? ' — ' + e.company : ''} (${[e.start, e.end].filter(Boolean).join(' – ')})${e.location ? ' · ' + e.location : ''}`);
      for (const b of list(e.bullets)) lines.push('• ' + b);
      lines.push('');
    }
  }
  if (list(r.projects).length) {
    lines.push(L.projects.toUpperCase());
    for (const p of list(r.projects)) {
      lines.push(p.name + (list(p.tech).length ? ` (${list(p.tech).join(', ')})` : ''));
      if (p.description) lines.push(p.description);
      for (const b of list(p.bullets)) lines.push('• ' + b);
      lines.push('');
    }
  }
  if (list(r.education).length) {
    lines.push(L.education.toUpperCase());
    for (const e of list(r.education)) lines.push(`${e.degree}${e.institution ? ' — ' + e.institution : ''} (${[e.start, e.end].filter(Boolean).join(' – ')})${e.details ? ' · ' + e.details : ''}`);
    lines.push('');
  }
  if (list(r.certifications).length) lines.push(L.certifications.toUpperCase(), ...list(r.certifications).map(x => '• ' + (typeof x === 'string' ? x : x.name)), '');
  if (list(r.languages).length) lines.push(L.languages.toUpperCase(), list(r.languages).map(x => typeof x === 'string' ? x : `${x.language} ${x.level || ''}`).join(' · '), '');
  for (const sec of list(r.other)) lines.push(String(sec.title || '').toUpperCase(), ...list(sec.items).map(i => '• ' + i), '');
  return lines.filter(l => l != null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function docShell(title, bodyHtml, extraCss = '') {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
@page { size: A4; margin: 14mm 15mm; }
body { margin: 0; background: #fff; }
.page { max-width: 800px; margin: 0 auto; padding: 24px; }
@media print { .page { padding: 0; max-width: none; } .noprint { display: none; } }
${TEMPLATE_CSS}
${extraCss}
</style></head><body><div class="page">${bodyHtml}</div></body></html>`;
}

// Abre una ventana con el documento y lanza el diálogo de impresión (Guardar como PDF).
function printHtml(title, bodyHtml, extraCss = '') {
  const w = window.open('', '_blank');
  if (!w) throw new Error('El navegador bloqueó la ventana emergente. Permite pop-ups para este sitio.');
  w.document.open();
  w.document.write(docShell(title, bodyHtml, extraCss));
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 350);
}

function download(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// Word abre sin problema un HTML con extensión .doc.
function downloadWord(filename, title, bodyHtml) {
  const html = docShell(title, bodyHtml).replace('<html>', '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">');
  download(filename, '﻿' + html, 'application/msword');
}

function letterHtml(text) {
  return `<div class="cv letter">${String(text || '').split(/\n{2,}/).map(p => `<p style="margin:0 0 10px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}</div>`;
}

function safeFile(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'documento';
}
