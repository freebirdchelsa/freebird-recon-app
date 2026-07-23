import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import './localStorageShim.js'
import App from './App.jsx'

// Auto-update the installed app: check for a new version hourly (and on load),
// and reload immediately when one's found — no manual reinstall/close-and-reopen
// needed to pick up a new deploy.
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    setInterval(() => registration.update(), CHECK_INTERVAL_MS);
  },
  onNeedRefresh() {
    updateSW(true);
  },
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
