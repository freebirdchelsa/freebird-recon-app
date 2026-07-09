// Vite dev-server-only middleware that mirrors api/airtable/[...path].js so the
// Airtable data layer can be tested with `npm run dev`, without needing the
// Vercel CLI. Not used in the deployed build — Vercel serves the real function
// from api/airtable/[...path].js instead.
export function devAirtableProxy(env) {
  return {
    name: 'dev-airtable-proxy',
    configureServer(server) {
      server.middlewares.use('/api/airtable', async (req, res) => {
        const token = env.AIRTABLE_TOKEN;
        const baseId = env.AIRTABLE_BASE_ID;
        if (!token || !baseId) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID in .env.local' }));
          return;
        }

        const url = `https://api.airtable.com/v0/${baseId}${req.url}`;

        let body;
        if (!['GET', 'HEAD'].includes(req.method)) {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          body = Buffer.concat(chunks).toString('utf8');
        }

        try {
          const airtableRes = await fetch(url, {
            method: req.method,
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body,
          });
          const text = await airtableRes.text();
          res.statusCode = airtableRes.status;
          res.setHeader('Content-Type', 'application/json');
          res.end(text);
        } catch (e) {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Could not reach Airtable', detail: String(e) }));
        }
      });
    },
  };
}
