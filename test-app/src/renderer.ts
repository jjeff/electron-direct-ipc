// Renderer script for Electron test app
// You can import your library here for testing
// import { DirectIpcRenderer } from '../../dist/renderer/DirectIpcRenderer';

window.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('root');
  if (root) {
    root.innerText = 'Electron Test App Loaded';
  }
});
