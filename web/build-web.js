#!/usr/bin/env node
// Builds web/index.html — the standalone website — from ../ui.html, which stays
// the single source of truth for the tracer AND the UI. Run after every tracer
// change:  node web/build-web.js
//
// The plugin UI talks to Figma only through parent.postMessage(...). On a
// top-level page `parent === window`, so those messages arrive at the page
// itself; the host shim appended below turns them into web actions
// (import-svg -> download, notify -> toast). The UI script is an IIFE, so the
// shim never calls into it: images go IN through the plugin's own
// 'selection-image' channel and results come OUT by reading the preview
// image's blob URL. Nothing in the plugin's code changes for the web.
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'ui.html'), 'utf8');

const style = ui.match(/<style>[\s\S]*?<\/style>/)[0];
const markupStart = ui.indexOf('<div id="dropzone">');
const scriptsStart = ui.indexOf('<script id="tracerScript">');
if (markupStart < 0 || scriptsStart < 0) throw new Error('ui.html layout changed — update build-web.js');
let markup = ui.slice(markupStart, scriptsStart);
const scripts = ui.slice(scriptsStart); // tracer block + UI script, verbatim

// ---- web adaptations of the plugin markup (every id stays: the UI script
// looks them all up at load) ------------------------------------------------
const hint = `<div class="hint">
    <svg class="hint-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="6" y="10" width="36" height="28" rx="4"/>
      <path d="M6 31l10-9 8 7 6-5 12 10"/>
      <circle cx="33" cy="18" r="3"/>
      <path d="M24 46V32m-5 5l5-5 5 5"/>
    </svg>
    <strong>Drop a line-art image here</strong>
    <span class="hint-sub">or paste it (⌘V) · upload from your device · try the example</span>
  </div>`;
markup = markup.replace(/<div class="hint">[\s\S]*?<\/div>/, hint);
markup = markup
  .replace('<button id="openBtn">Open image…</button>', '<button id="openBtn" class="primary">Upload image</button>')
  .replace('<button id="selBtn" disabled>Use selected layer</button>',
           '<button id="selBtn" disabled hidden>Use selected layer</button>\n  <button id="exampleBtn">Try an example</button>')
  .replace('<button id="importBtn" class="primary">Add to canvas</button>',
           '<button id="importBtn" class="primary">Download SVG</button>\n  <button id="pngBtn">Download PNG</button>\n  <button id="shareBtn">Share…</button>');
for (const must of ['hint-icon', 'exampleBtn', 'Download SVG', 'pngBtn', 'shareBtn', 'Upload image']) {
  if (!markup.includes(must)) throw new Error('markup adaptation failed: ' + must);
}

// web-only UI appended inside the tool card, after the plugin's status line
const extras = `
<details id="report" class="report">
  <summary>Not happy with a trace? Send us the image</summary>
  <p class="report-note">This sends your source image, the traced SVG and a note to the maker so the
  tracer can be improved. Nothing is sent unless you press the button.</p>
  <form id="reportForm" name="trace-report" method="POST" data-netlify="true" netlify-honeypot="bot-field" enctype="multipart/form-data">
    <input type="hidden" name="form-name" value="trace-report">
    <input type="hidden" name="stats" id="reportStats">
    <!-- Netlify only stores fields declared in the HTML at build time: the
         image and SVG are attached to these at submit time by the shim -->
    <input type="file" name="source" class="hp" tabindex="-1" aria-hidden="true">
    <input type="file" name="svg" class="hp" tabindex="-1" aria-hidden="true">
    <p class="hp"><label>Leave this empty <input name="bot-field"></label></p>
    <label class="field">What went wrong? <span>(optional)</span>
      <textarea name="note" rows="3" placeholder="e.g. the arrowhead came out rounded, the dashed line got merged…"></textarea>
    </label>
    <label class="consent"><input type="checkbox" name="consent" required> I'm fine with this image being used to improve the tracer</label>
    <div class="row"><button type="submit" class="primary" id="reportBtn">Send image &amp; result</button></div>
  </form>
</details>`;

const webStyle = `<style>
  /* ---- page design on top of the plugin's panel styles ---- */
  :root {
    --page-bg: #f4f5f8; --ink: #0f172a; --muted: #64748b; --line: #e3e7ee;
    --accent: #3b5bfd; --accent-2: #7c3aed; --accent-text: #ffffff;
    --bg: #ffffff; --text: var(--ink); --text-2: var(--muted); --border: var(--line);
    --surface: #f7f8fb; --ring: rgba(59, 91, 253, .35);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --page-bg: #0b0d12; --ink: #e8eaf0; --muted: #8b93a7; --line: #262b36;
      --bg: #14171e; --surface: #1a1e27; --ring: rgba(99, 125, 255, .45);
    }
  }
  html { -webkit-text-size-adjust: 100%; }
  body {
    font: 15px/1.55 Inter, "SF Pro Text", -apple-system, system-ui, sans-serif;
    color: var(--ink); background: var(--page-bg); padding: 0; user-select: auto;
    background-image:
      radial-gradient(60% 50% at 50% -10%, rgba(59, 91, 253, .14), transparent 70%),
      radial-gradient(40% 35% at 90% 10%, rgba(124, 58, 237, .10), transparent 70%);
    background-repeat: no-repeat;
  }
  .page { max-width: 760px; margin: 0 auto; padding: 56px 20px 72px; }
  header { text-align: center; margin-bottom: 28px; }
  .eyebrow {
    display: inline-flex; gap: 8px; align-items: center; padding: 6px 12px; border-radius: 999px;
    background: var(--bg); border: 1px solid var(--line); color: var(--muted); font-size: 12.5px; font-weight: 500;
    letter-spacing: .01em;
  }
  .eyebrow i { width: 7px; height: 7px; border-radius: 50%; background: linear-gradient(135deg, var(--accent), var(--accent-2)); display: inline-block; }
  header h1 {
    font-size: clamp(30px, 5.2vw, 42px); line-height: 1.1; font-weight: 700; letter-spacing: -0.025em;
    margin: 18px auto 14px; max-width: 16ch;
  }
  header h1 em { font-style: normal; background: linear-gradient(90deg, var(--accent), var(--accent-2)); -webkit-background-clip: text; background-clip: text; color: transparent; }
  header .lead { color: var(--muted); font-size: 17px; max-width: 54ch; margin: 0 auto; }

  .tool {
    background: var(--bg); border: 1px solid var(--line); border-radius: 20px; padding: 18px;
    box-shadow: 0 1px 2px rgba(15, 23, 42, .04), 0 24px 60px -32px rgba(15, 23, 42, .25);
  }
  .tool button {
    height: 42px; padding: 0 16px; border-radius: 11px; font-size: 14px; font-weight: 600;
    border: 1px solid var(--line); background: var(--bg); color: var(--ink);
    transition: transform .12s ease, box-shadow .12s ease, background .12s ease;
  }
  .tool button:hover { background: var(--surface); transform: translateY(-1px); box-shadow: 0 4px 14px -6px rgba(15, 23, 42, .25); }
  .tool button:active { transform: translateY(0); }
  .tool button:focus-visible { outline: none; box-shadow: 0 0 0 4px var(--ring); }
  .tool button.primary { background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #fff; border-color: transparent; }
  .tool button.primary:hover { filter: brightness(1.05); background: linear-gradient(135deg, var(--accent), var(--accent-2)); }
  .tool button:disabled { opacity: .45; transform: none; box-shadow: none; }
  .row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
  .row > * { flex: 1 1 150px; }

  #dropzone {
    min-height: 360px; height: auto; border: 1.5px dashed var(--line); border-radius: 14px;
    background: linear-gradient(180deg, var(--surface), var(--bg)); color: var(--muted);
    transition: border-color .15s, background .15s, box-shadow .15s;
  }
  #dropzone:hover { border-color: color-mix(in srgb, var(--accent) 50%, var(--line)); }
  #dropzone.dragover { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 6%, var(--bg)); box-shadow: 0 0 0 4px var(--ring) inset; }
  #dropzone .hint { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 0 28px; }
  #dropzone .hint strong { font-size: 18px; font-weight: 600; color: var(--ink); margin: 6px 0 0; }
  .hint-icon { width: 56px; height: 56px; color: var(--accent); opacity: .9; }
  .hint-sub { font-size: 13.5px; color: var(--muted); }
  #dropzone.has-image { border-style: solid; }
  /* the result is drawn in the ink's own (usually dark) color: keep a LIGHT
     checkerboard behind it in both themes so strokes always read */
  #preview { background: repeating-conic-gradient(#e6e9ef 0% 25%, #ffffff 0% 50%) 0 0 / 18px 18px; }

  #thicknessRow { grid-template-columns: 84px 1fr 56px; margin-top: 16px; font-size: 14px; }
  #thicknessRow label, #thicknessRow output { color: var(--muted); }
  input[type=range] { height: 28px; }
  #adjust { margin-top: 14px; border: 1px solid var(--line); border-top: 1px solid var(--line); border-radius: 12px; padding: 10px 14px 12px; font-size: 13.5px; }
  #adjust summary { font-weight: 500; color: var(--muted); }
  .ctl { grid-template-columns: 84px 1fr 56px; }
  #status { margin-top: 14px; font-size: 13.5px; color: var(--muted); }
  #status .mode { color: var(--ink); }
  #warn { font-size: 13px; }
  #progressRow { margin-top: 14px; }

  .report { margin-top: 14px; border: 1px solid var(--line); border-radius: 12px; padding: 10px 14px 12px; font-size: 13.5px; display: none; }
  .report.visible { display: block; }
  .report summary { cursor: pointer; font-weight: 500; color: var(--muted); list-style: none; }
  .report summary::before { content: '▸ '; } .report[open] summary::before { content: '▾ '; }
  .report-note { color: var(--muted); margin: 8px 0 10px; }
  .report .field { display: block; font-weight: 500; }
  .report .field span { color: var(--muted); font-weight: 400; }
  .report textarea {
    display: block; width: 100%; margin-top: 6px; font: inherit; font-size: 14px; padding: 10px 12px;
    border: 1px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--ink); resize: vertical;
  }
  .report textarea:focus-visible { outline: none; box-shadow: 0 0 0 4px var(--ring); }
  .report .consent { display: flex; align-items: center; gap: 8px; margin-top: 10px; color: var(--muted); cursor: pointer; }
  .report .consent input { accent-color: var(--accent); width: 16px; height: 16px; }
  .report .hp { position: absolute; left: -9999px; }

  .how { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 22px; }
  .how div { background: var(--bg); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; }
  .how b { display: block; font-size: 14px; margin-bottom: 4px; }
  .how p { color: var(--muted); font-size: 13.5px; margin: 0; }
  footer { margin-top: 28px; text-align: center; color: var(--muted); font-size: 13px; line-height: 1.7; }
  footer a { color: inherit; }

  .toast {
    position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%) translateY(8px);
    background: var(--ink); color: var(--page-bg); padding: 11px 16px; border-radius: 12px; font-size: 13.5px;
    box-shadow: 0 10px 30px rgba(0,0,0,.25); opacity: 0; transition: opacity .18s, transform .18s; z-index: 10;
    max-width: calc(100vw - 32px); text-align: center;
  }
  .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
  .toast.error { background: #b3261e; color: #fff; }

  @media (max-width: 640px) {
    .page { padding: 32px 14px 48px; }
    .tool { padding: 12px; border-radius: 16px; }
    #dropzone { min-height: 260px; }
    .how { grid-template-columns: 1fr; }
    header .lead { font-size: 15.5px; }
    #thicknessRow, .ctl { grid-template-columns: 72px 1fr 48px; }
  }
  @media (prefers-reduced-motion: reduce) { .tool button, #dropzone, .toast { transition: none; } }
</style>`;

const shim = `<script>
// ---- web host shim: what the Figma main thread would have done ----
(() => {
  const $ = id => document.getElementById(id);
  const toastEl = document.createElement('div');
  toastEl.className = 'toast';
  document.body.appendChild(toastEl);
  let toastT = null;
  const toast = (msg, isError) => {
    toastEl.textContent = msg;
    toastEl.classList.toggle('error', !!isError);
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('show'), 2800);
  };
  const safeName = n => ((n || 'line-trace').replace(/[^\\w\\- ]+/g, '_').trim() || 'line-trace');
  let currentName = 'line-trace';
  const baseName = () => {
    const f = $('fileInput').files && $('fileInput').files[0];
    return safeName(f ? f.name.replace(/\\.[^.]+$/, '') : currentName);
  };
  const saveBlob = (blob, filename) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  // the current result is whatever the preview shows: its src is a blob URL
  // of the SVG the plugin built (and the source image sits in #srcImg)
  const currentSvg = async () => {
    const src = $('traceImg').src;
    if (!src || !src.startsWith('blob:')) return null;
    return (await fetch(src)).text();
  };
  const sourceBlob = async () => {
    const src = $('srcImg').src;
    if (!src || !src.startsWith('blob:')) return null;
    return (await fetch(src)).blob();
  };
  const svgToPng = svg => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => {
      const s = Math.min(4, Math.max(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight)));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => b ? resolve(b) : reject(new Error('PNG encoding failed')), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('could not render the SVG')); };
    img.src = url;
  });

  window.addEventListener('message', e => {
    const m = e.data && e.data.pluginMessage;
    if (!m) return;
    if (m.type === 'import-svg') {
      currentName = m.name || currentName;
      saveBlob(new Blob([m.svg], { type: 'image/svg+xml' }), baseName() + '.svg');
      toast('SVG downloaded — the strokes stay editable in Figma, Illustrator or Sketch.');
    } else if (m.type === 'notify') toast(m.message, !!m.error);
    else if (m.type === 'get-selection-image')
      window.postMessage({ pluginMessage: { type: 'selection-image',
        error: 'Picking a Figma layer only works inside the Figma plugin.' } }, '*');
    // ui-resize / close: nothing to do on a page
  });

  // images enter through the plugin's own channel (what Figma does for a
  // selected layer), so the UI script needs no web-specific hook
  $('exampleBtn').onclick = async () => {
    try {
      const r = await fetch('example.png');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      currentName = 'example-icon';
      window.postMessage({ pluginMessage: { type: 'selection-image',
        bytes: new Uint8Array(await r.arrayBuffer()), name: 'example-icon', scale: 1 } }, '*');
    } catch (err) { toast('Could not load the example: ' + err.message, true); }
  };

  $('pngBtn').onclick = async () => {
    try {
      const svg = await currentSvg();
      if (!svg) return toast('Trace an image first.', true);
      saveBlob(await svgToPng(svg), baseName() + '.png');
      toast('PNG downloaded (transparent background, 2048 px).');
    } catch (err) { toast('PNG export failed: ' + err.message, true); }
  };

  $('shareBtn').onclick = async () => {
    try {
      const svg = await currentSvg();
      if (!svg) return toast('Trace an image first.', true);
      const name = baseName();
      const files = [new File([await svgToPng(svg)], name + '.png', { type: 'image/png' }),
                     new File([svg], name + '.svg', { type: 'image/svg+xml' })];
      if (navigator.share && navigator.canShare) {
        const pick = navigator.canShare({ files }) ? files : navigator.canShare({ files: [files[0]] }) ? [files[0]] : null;
        if (pick) { await navigator.share({ files: pick, title: 'Line trace' }); return; }
      }
      await navigator.clipboard.writeText(svg);
      toast('Sharing files is not supported in this browser — the SVG was copied to your clipboard instead.');
    } catch (err) { if (err && err.name !== 'AbortError') toast('Could not share: ' + err.message, true); }
  };

  // "send us this trace": an opt-in form (Netlify Forms when hosted there —
  // the static form below is what Netlify detects at deploy time)
  const report = $('report');
  const showReport = () => report.classList.toggle('visible', $('dropzone').classList.contains('has-image'));
  new MutationObserver(showReport).observe($('dropzone'), { attributes: true, attributeFilter: ['class'] });
  $('reportForm').onsubmit = async e => {
    e.preventDefault();
    const btn = $('reportBtn');
    try {
      const svg = await currentSvg(), src = await sourceBlob();
      if (!svg || !src) return toast('Trace an image first.', true);
      const fd = new FormData($('reportForm'));
      const ext = (src.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
      fd.set('source', new File([src], baseName() + '-source.' + ext, { type: src.type || 'image/png' }));
      fd.set('svg', new File([svg], baseName() + '-trace.svg', { type: 'image/svg+xml' }));
      fd.set('stats', ($('status').textContent || '') + ' · ' + navigator.userAgent);
      btn.disabled = true; btn.textContent = 'Sending…';
      const r = await fetch(window.location.pathname, { method: 'POST', body: fd });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      toast('Thank you — the image and trace were sent.');
      $('reportForm').reset();
      report.open = false;
    } catch (err) {
      toast('Sending failed (' + err.message + '). The form needs a host with form handling, e.g. Netlify.', true);
    } finally { btn.disabled = false; btn.textContent = 'Send image & result'; }
  };
})();
</script>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Image to Line SVG</title>
<meta name="description" content="Turn any line-art image into a stroke-based SVG with editable line weight — free, automatic, and private: everything runs in your browser.">
<meta name="theme-color" content="#3b5bfd">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%233b5bfd' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 17c4-10 7-10 10 0s5 0 6-4'/%3E%3C/svg%3E">
${style}
${webStyle}
</head>
<body>
<div class="page">
  <header>
    <span class="eyebrow"><i></i> Free · private · runs in your browser</span>
    <h1>Turn line art into <em>editable SVG strokes</em></h1>
    <p class="lead">Drop an icon, a sketch or a fashion flat and get a vector whose lines are real strokes —
    change the weight, color and caps afterwards in Figma, Illustrator or Sketch. Nothing is uploaded.</p>
  </header>
  <main class="tool">
${markup}
${extras}
  </main>
  <section class="how" aria-label="How it works">
    <div><b>Centerline, not outline</b><p>Each drawn line becomes one path down its middle, so thickness stays a single slider — not a filled shape you can't adjust.</p></div>
    <div><b>Designer-grade output</b><p>Minimal anchors, sharp corners kept sharp, perfect circles and straight lines snapped straight.</p></div>
    <div><b>Private by design</b><p>The tracing runs on your device. Your images never leave the browser unless you choose to send one to us.</p></div>
  </section>
  <footer>
    Also available as a <a href="https://www.figma.com/community" rel="noopener">Figma plugin</a>.
  </footer>
</div>
${scripts}
${shim}
</body>
</html>
`;
fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log('web/index.html built (' + (html.length / 1024).toFixed(0) + ' KB) from ui.html');
