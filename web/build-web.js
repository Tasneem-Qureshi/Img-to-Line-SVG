#!/usr/bin/env node
// Builds web/index.html — the standalone website — from ../ui.html, which stays
// the single source of truth for the tracer AND the UI. Run after every tracer
// change:  node web/build-web.js
//
// The plugin UI talks to Figma only through parent.postMessage(...). On a
// top-level page `parent === window`, so those messages arrive at the page
// itself; a small host shim appended below turns them into web actions
// (import-svg -> download, notify -> toast). Nothing in the UI script changes.
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

// web adaptations (ids stay — the UI script looks them all up at load)
markup = markup
  .replace('Paste (⌘V) or use a selected Figma layer too.', 'Paste (⌘V) an image, or try the example.')
  .replace('<button id="selBtn" disabled>Use selected layer</button>',
           '<button id="selBtn" disabled hidden>Use selected layer</button>\n  <button id="exampleBtn">Try an example</button>')
  .replace('>Add to canvas<', '>Download SVG<');
for (const must of ['exampleBtn', 'Download SVG', 'try the example']) {
  if (!markup.includes(must)) throw new Error('markup adaptation failed: ' + must);
}

const webStyle = `<style>
  /* web layout on top of the plugin's panel styles */
  body { font-size: 12px; padding: 0; background: #eef0f3; user-select: auto; }
  .page { max-width: 580px; margin: 0 auto; padding: 36px 16px 56px; }
  header h1 { font-size: 24px; font-weight: 600; letter-spacing: -0.01em; margin-bottom: 8px; }
  header p { color: var(--text-2); font-size: 14px; line-height: 1.55; margin-bottom: 20px; }
  .tool { background: var(--bg); border: 1px solid var(--border); border-radius: 14px; padding: 14px;
          box-shadow: 0 1px 2px rgba(0,0,0,.05), 0 12px 32px -20px rgba(0,0,0,.25); }
  #dropzone { height: 320px; }
  footer { margin-top: 20px; color: var(--text-2); font-size: 12.5px; line-height: 1.6; }
  footer a { color: inherit; }
  .toast { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%) translateY(8px);
           background: #1e1e1e; color: #fff; padding: 10px 14px; border-radius: 9px; font-size: 12.5px;
           box-shadow: 0 8px 24px rgba(0,0,0,.25); opacity: 0; transition: opacity .18s, transform .18s; z-index: 10;
           max-width: calc(100vw - 32px); }
  .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
  .toast.error { background: #b3261e; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #1e1e1e; --text: #ececec; --text-2: #9d9d9d; --border: #343434; --surface: #2a2a2a; }
    body { background: #121214; }
    .toast { background: #f1f1f1; color: #111; }
  }
</style>`;

const shim = `<script>
// ---- web host shim: what the Figma main thread would have done ----
(() => {
  const toastEl = document.createElement('div');
  toastEl.className = 'toast';
  document.body.appendChild(toastEl);
  let toastT = null;
  const toast = (msg, isError) => {
    toastEl.textContent = msg;
    toastEl.classList.toggle('error', !!isError);
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('show'), 2600);
  };
  const download = (svg, name) => {
    const safe = (name || 'line-trace').replace(/[^\\w\\- ]+/g, '_').trim() || 'line-trace';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    a.download = safe + '.svg';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('SVG downloaded — the strokes stay editable in Figma, Illustrator or Sketch.');
  };
  window.addEventListener('message', e => {
    const m = e.data && e.data.pluginMessage;
    if (!m) return;
    if (m.type === 'import-svg') download(m.svg, m.name);
    else if (m.type === 'notify') toast(m.message, !!m.error);
    else if (m.type === 'get-selection-image')
      window.postMessage({ pluginMessage: { type: 'selection-image',
        error: 'Picking a Figma layer only works inside the Figma plugin.' } }, '*');
    // ui-resize / close: nothing to do on a page
  });
  // the example enters through the plugin's own channel: Figma delivers a
  // selected layer as a 'selection-image' message with PNG bytes, so the UI
  // script needs no web-specific hook
  document.getElementById('exampleBtn').onclick = async () => {
    try {
      const r = await fetch('example.png');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const bytes = new Uint8Array(await r.arrayBuffer());
      window.postMessage({ pluginMessage: { type: 'selection-image', bytes, name: 'example-icon', scale: 1 } }, '*');
    } catch (err) { toast('Could not load the example: ' + err.message, true); }
  };
})();
</script>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Image to Line SVG</title>
<meta name="description" content="Trace any line-art image into a stroke-based SVG with editable line weight. Runs entirely in your browser — nothing is uploaded.">
${style}
${webStyle}
</head>
<body>
<div class="page">
  <header>
    <h1>Image to Line SVG</h1>
    <p>Drop a line-art image — an icon, a sketch, a fashion flat — and get a <strong>stroke-based SVG</strong>
    whose line weight, color and caps stay editable afterwards. Everything is traced automatically,
    right here in your browser; nothing is uploaded.</p>
  </header>
  <main class="tool">
${markup}
  </main>
  <footer>
    Best results come from crisp, high-resolution sources. Open the SVG in Figma, Illustrator, Sketch or any vector
    editor and change the stroke weight like any hand-drawn path. Also available as a
    <a href="https://www.figma.com/community" rel="noopener">Figma plugin</a>.
  </footer>
</div>
${scripts}
${shim}
</body>
</html>
`;
fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log('web/index.html built (' + (html.length / 1024).toFixed(0) + ' KB) from ui.html');
