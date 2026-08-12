// Image to Line SVG — main thread
// Receives a stroke-based SVG traced in the UI and places it on the canvas.

figma.showUI(__html__, { width: 380, height: 320, themeColors: true });

function sendSelectionState() {
  figma.ui.postMessage({
    type: 'selection-state',
    hasSelection: figma.currentPage.selection.length > 0
  });
}

figma.on('selectionchange', sendSelectionState);
sendSelectionState();

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'import-svg') {
    try {
      const frame = figma.createNodeFromSvg(msg.svg);
      let node = frame;
      // The SVG has a single <path>, so unwrap the frame to a plain vector —
      // easiest to restyle (one click, edit stroke color / weight).
      if (frame.children.length === 1) {
        const child = frame.children[0];
        figma.currentPage.appendChild(child);
        frame.remove();
        node = child;
      }
      node.name = msg.name || 'Line trace';
      const center = figma.viewport.center;
      node.x = Math.round(center.x - node.width / 2);
      node.y = Math.round(center.y - node.height / 2);
      figma.currentPage.selection = [node];
      figma.viewport.scrollAndZoomIntoView([node]);
      figma.notify('Line SVG added — edit its stroke color & weight in the right panel');
    } catch (err) {
      figma.notify('Could not create SVG: ' + err.message, { error: true });
    }
  } else if (msg.type === 'get-selection-image') {
    const sel = figma.currentPage.selection[0];
    if (!sel) {
      figma.ui.postMessage({ type: 'selection-image', error: 'Select a layer with an image first.' });
      return;
    }
    try {
      const maxDim = Math.max(sel.width, sel.height);
      // Export small layers upscaled so thin lines survive tracing,
      // large ones capped near 1600px to keep tracing fast.
      const scale = Math.max(1, Math.min(4, 1600 / maxDim));
      const bytes = await sel.exportAsync({
        format: 'PNG',
        constraint: { type: 'SCALE', value: scale }
      });
      figma.ui.postMessage({
        type: 'selection-image',
        bytes,
        scale,
        name: sel.name + ' (line trace)'
      });
    } catch (err) {
      figma.ui.postMessage({ type: 'selection-image', error: 'Could not export this layer: ' + err.message });
    }
  } else if (msg.type === 'ui-resize') {
    figma.ui.resize(380, Math.min(740, Math.max(300, Math.round(msg.height))));
  } else if (msg.type === 'notify') {
    figma.notify(msg.message, { error: !!msg.error });
  } else if (msg.type === 'close') {
    figma.closePlugin();
  }
};
