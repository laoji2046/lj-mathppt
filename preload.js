'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Expose a minimal, safe bridge to the renderer for compiling Asymptote
// source code to SVG using a locally-installed `asy` binary (main process).
contextBridge.exposeInMainWorld('revealslidr', {
  compileAsymptote: (source) => ipcRenderer.invoke('asymptote:compile', String(source || '')),
  checkAsymptote: () => ipcRenderer.invoke('asymptote:available'),
});
