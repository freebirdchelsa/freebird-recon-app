// Temporary stand-in for the Claude-artifact-only `window.storage` API so the app
// runs standalone during local development. Real team-shared storage (Airtable via
// a Vercel serverless proxy) replaces this in the next build step.
if (!window.storage) {
  window.storage = {
    async get(key) {
      const value = window.localStorage.getItem(key);
      return value == null ? null : { value };
    },
    async set(key, value) {
      window.localStorage.setItem(key, value);
      return true;
    },
  };
}
