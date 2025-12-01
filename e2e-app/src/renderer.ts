// Renderer script for Electron E2E app
// You can import your library here for testing
// import { DirectIpcRenderer } from '../../dist/renderer/DirectIpcRenderer';

window.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('root');
  if (root) {
    root.innerText = 'Electron E2E App Loaded';
  }
});
