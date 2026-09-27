const ASSET_VERSION = '20260927-storage-fix';

async function loadAppShell() {
  const root = document.getElementById('appRoot');
  const response = await fetch(`src/views/app-shell.html?v=${ASSET_VERSION}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Could not load the application shell.');
  }
  root.innerHTML = await response.text();
}

try {
  await loadAppShell();
  await import(`./app.js?v=${ASSET_VERSION}`);
} catch (error) {
  console.error(error);
  const message = error && error.message ? error.message : 'Unknown startup error';
  document.body.innerHTML = '<main class="app-load-error"><h1>App failed to load</h1><p>Please refresh the page.</p><pre>' + message.replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character])) + '</pre></main>';
}
