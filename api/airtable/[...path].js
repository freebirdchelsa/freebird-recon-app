// Thin server-side proxy to the Airtable REST API. The Airtable token lives only
// here (as a Vercel environment variable) and is never sent to the browser — the
// browser calls this function instead of Airtable directly.
export default async function handler(req, res) {
  const token = process.env.AIRTABLE_TOKEN;
  const baseId = process.env.AIRTABLE_BASE_ID;

  if (!token || !baseId) {
    res.status(500).json({ error: 'Server is missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID' });
    return;
  }

  const { path, ...rest } = req.query;
  const segments = Array.isArray(path) ? path : [path];
  const tablePath = segments.map(encodeURIComponent).join('/');

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(rest)) {
    if (Array.isArray(value)) value.forEach((v) => search.append(key, v));
    else if (value != null) search.append(key, value);
  }
  const qs = search.toString();
  const url = `https://api.airtable.com/v0/${baseId}/${tablePath}${qs ? `?${qs}` : ''}`;

  const init = {
    method: req.method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (!['GET', 'HEAD'].includes(req.method)) {
    init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  }

  try {
    const airtableRes = await fetch(url, init);
    const data = await airtableRes.json().catch(() => ({}));
    res.status(airtableRes.status).json(data);
  } catch (e) {
    res.status(502).json({ error: 'Could not reach Airtable', detail: String(e) });
  }
}
