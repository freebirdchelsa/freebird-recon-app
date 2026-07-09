// Low-level REST calls to Airtable, always routed through /api/airtable/* so the
// API token never reaches the browser (see api/airtable/[...path].js).
const BASE = '/api/airtable';

async function request(table, { method = 'GET', query, body } = {}) {
  const params = new URLSearchParams();
  Object.entries(query || {}).forEach(([k, v]) => {
    if (v != null) params.set(k, v);
  });
  const qs = params.toString();
  const url = `${BASE}/${encodeURIComponent(table)}${qs ? `?${qs}` : ''}`;

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Airtable ${method} ${table} failed (${res.status}): ${json?.error?.message || JSON.stringify(json)}`);
  }
  return json;
}

export async function listAll(table, extraQuery = {}) {
  let records = [];
  let offset;
  do {
    const data = await request(table, { query: { pageSize: 100, offset, ...extraQuery } });
    records = records.concat(data.records || []);
    offset = data.offset;
  } while (offset);
  return records;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function createRecords(table, fieldsList) {
  const created = [];
  for (const batch of chunk(fieldsList, 10)) {
    if (!batch.length) continue;
    const data = await request(table, {
      method: 'POST',
      body: { typecast: true, records: batch.map((fields) => ({ fields })) },
    });
    created.push(...(data.records || []));
  }
  return created;
}

export async function updateRecords(table, recordsWithId) {
  const updated = [];
  for (const batch of chunk(recordsWithId, 10)) {
    if (!batch.length) continue;
    const data = await request(table, {
      method: 'PATCH',
      body: { typecast: true, records: batch },
    });
    updated.push(...(data.records || []));
  }
  return updated;
}

export async function deleteRecords(table, ids) {
  for (const batch of chunk(ids.filter(Boolean), 10)) {
    if (!batch.length) continue;
    const params = new URLSearchParams();
    batch.forEach((id) => params.append('records[]', id));
    const res = await fetch(`${BASE}/${encodeURIComponent(table)}?${params.toString()}`, { method: 'DELETE' });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(`Airtable DELETE ${table} failed (${res.status}): ${json?.error?.message || JSON.stringify(json)}`);
    }
  }
}
