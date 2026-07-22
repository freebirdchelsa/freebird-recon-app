// Replaces the prototype's window.storage-backed initStorage()/persist()/tryRead()
// for the shared team data (vehicles/lines/logs/edits/notifications/laborRate).
// Loads the six Airtable tables and assembles them back into the exact nested
// shape App.jsx already works with, then on every save, diffs against the last
// known state and sends only the targeted creates/updates/deletes needed —
// never a whole-blob overwrite, so two people editing different vehicles at the
// same time can't stomp on each other.
//
// Falls back to a local-only (this device only) copy in localStorage if Airtable
// can't be reached, matching the prototype's existing shared -> personal -> memory
// fallback chain and its "team sync unavailable" banner.

import { listAll, createRecords, updateRecords, deleteRecords } from './airtableClient.js';
import {
  TABLES,
  vehicleToFields, fieldsToVehicle,
  lineToFields, fieldsToLine,
  logToFields, fieldsToLog,
  generalLogToFields, fieldsToGeneralLog,
  estEditToFields, fieldsToEstEdit,
  activityToFields, fieldsToActivity,
} from './schema.js';

const LOCAL_FALLBACK_KEY = 'freebird-recon-airtable-fallback-v1';
const emptyDataShape = () => ({ vehicles: [], notifications: [], laborRate: 100 });
const clone = (obj) => JSON.parse(JSON.stringify(obj));

export let storageMode = 'memory';

let lastSynced = emptyDataShape();
let settingsRecordId = null;
const recIds = {
  vehicles: new Map(),
  lines: new Map(),
  logs: new Map(),
  edits: new Map(),
  activity: new Map(),
};

/* ---------- load & assemble ---------- */

async function loadAll() {
  const [vehicleRecs, lineRecs, logRecs, editRecs, activityRecs, settingsRecs] = await Promise.all([
    listAll(TABLES.vehicles),
    listAll(TABLES.lines),
    listAll(TABLES.laborLogs),
    listAll(TABLES.estEdits),
    listAll(TABLES.activity, { 'sort[0][field]': 'Ts', 'sort[0][direction]': 'desc', maxRecords: 200 }),
    listAll(TABLES.settings),
  ]);

  recIds.vehicles = new Map();
  recIds.lines = new Map();
  recIds.logs = new Map();
  recIds.edits = new Map();
  recIds.activity = new Map();

  const vehiclesById = new Map();
  const vehicleRecIdToAppId = new Map();
  vehicleRecs.forEach((rec) => {
    const v = fieldsToVehicle(rec);
    if (!v.id) return; // skip rows someone created by hand in Airtable with no App Id
    vehiclesById.set(v.id, v);
    recIds.vehicles.set(v.id, rec.id);
    vehicleRecIdToAppId.set(rec.id, v.id);
  });

  const linesById = new Map();
  const lineRecIdToAppId = new Map();
  lineRecs.forEach((rec) => {
    const l = fieldsToLine(rec);
    if (!l.id) return;
    linesById.set(l.id, l);
    recIds.lines.set(l.id, rec.id);
    lineRecIdToAppId.set(rec.id, l.id);
    const vehId = vehicleRecIdToAppId.get(l._vehicleRecId);
    delete l._vehicleRecId;
    const v = vehId && vehiclesById.get(vehId);
    if (v) v.lines.push(l);
  });

  // Labor Logs holds two kinds of rows in one table: job-specific (linked to a
  // Repair Line) and general/non-job (linked straight to a Vehicle, with a Reason).
  logRecs.forEach((rec) => {
    const isGeneral = !rec.fields['Repair Line'] && rec.fields['Vehicle'];
    if (isGeneral) {
      const g = fieldsToGeneralLog(rec);
      if (!g.id) return;
      recIds.logs.set(g.id, rec.id);
      const vehId = vehicleRecIdToAppId.get(g._vehicleRecId);
      delete g._vehicleRecId;
      const v = vehId && vehiclesById.get(vehId);
      if (v) v.generalLogs.push(g);
      return;
    }
    const g = fieldsToLog(rec);
    if (!g.id) return;
    recIds.logs.set(g.id, rec.id);
    const lineId = lineRecIdToAppId.get(g._lineRecId);
    delete g._lineRecId;
    const l = lineId && linesById.get(lineId);
    if (l) l.laborLogs.push(g);
  });

  editRecs.forEach((rec) => {
    const e = fieldsToEstEdit(rec);
    if (!e.id) return;
    recIds.edits.set(e.id, rec.id);
    const lineId = lineRecIdToAppId.get(e._lineRecId);
    delete e._lineRecId;
    const l = lineId && linesById.get(lineId);
    if (l) l.estEdits.push(e);
  });

  const notifications = [];
  activityRecs.forEach((rec) => {
    const n = fieldsToActivity(rec);
    if (!n.id) return;
    recIds.activity.set(n.id, rec.id);
    n.vehicleId = vehicleRecIdToAppId.get(n._vehicleRecId) || null;
    delete n._vehicleRecId;
    notifications.push(n);
  });

  let laborRate = 100;
  settingsRecordId = null;
  if (settingsRecs.length) {
    settingsRecordId = settingsRecs[0].id;
    const rate = settingsRecs[0].fields['Labor Rate'];
    if (rate != null) laborRate = rate;
  }

  const vehicles = [...vehiclesById.values()].sort((a, b) => (b.addedTs || 0) - (a.addedTs || 0));
  vehicles.forEach((v) => {
    v.lines.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    v.generalLogs.sort((a, b) => (a.start || 0) - (b.start || 0));
  });
  linesById.forEach((l) => {
    l.laborLogs.sort((a, b) => (a.start || 0) - (b.start || 0));
    l.estEdits.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  });
  notifications.sort((a, b) => (b.ts || 0) - (a.ts || 0));

  const data = { vehicles, notifications, laborRate };
  lastSynced = clone(data);
  return data;
}

/* ---------- diff & sync ---------- */

function diffById(prevList, nextList, toFields) {
  const prevMap = new Map(prevList.map((x) => [x.id, x]));
  const nextMap = new Map(nextList.map((x) => [x.id, x]));
  const creates = [];
  const updates = [];
  const deletes = [];
  for (const [id, item] of nextMap) {
    const before = prevMap.get(id);
    if (!before) creates.push(item);
    else if (JSON.stringify(toFields(before)) !== JSON.stringify(toFields(item))) updates.push(item);
  }
  for (const [id] of prevMap) {
    if (!nextMap.has(id)) deletes.push(id);
  }
  return { creates, updates, deletes };
}

async function syncEntity(table, recMap, prevList, nextList, toFields, { allowDelete = true } = {}) {
  const { creates, updates, deletes } = diffById(prevList, nextList, toFields);

  if (creates.length) {
    const created = await createRecords(table, creates.map(toFields));
    created.forEach((rec) => {
      const appId = rec.fields['App Id'];
      if (appId) recMap.set(appId, rec.id);
    });
  }
  if (updates.length) {
    await updateRecords(
      table,
      updates.map((item) => ({ id: recMap.get(item.id), fields: toFields(item) })).filter((r) => r.id)
    );
  }
  if (allowDelete && deletes.length) {
    const ids = deletes.map((id) => recMap.get(id)).filter(Boolean);
    if (ids.length) await deleteRecords(table, ids);
    deletes.forEach((id) => recMap.delete(id));
  }
}

async function persistToAirtable(nextData) {
  const prev = lastSynced;

  // Vehicles first — lines/activity need the resulting Airtable record ids to link to.
  await syncEntity(TABLES.vehicles, recIds.vehicles, prev.vehicles, nextData.vehicles, vehicleToFields);

  const prevLines = prev.vehicles.flatMap((v) => (v.lines || []).map((l) => ({ ...l, _vehId: v.id })));
  const nextLines = nextData.vehicles.flatMap((v) => (v.lines || []).map((l) => ({ ...l, _vehId: v.id })));
  await syncEntity(
    TABLES.lines, recIds.lines, prevLines, nextLines,
    (l) => lineToFields(l, recIds.vehicles.get(l._vehId))
  );

  const prevLogs = prevLines.flatMap((l) => (l.laborLogs || []).map((g) => ({ ...g, _lineId: l.id })));
  const nextLogs = nextLines.flatMap((l) => (l.laborLogs || []).map((g) => ({ ...g, _lineId: l.id })));
  await syncEntity(
    TABLES.laborLogs, recIds.logs, prevLogs, nextLogs,
    (g) => logToFields(g, recIds.lines.get(g._lineId))
  );

  // General (non-job) clock-ins — same table, linked straight to the vehicle instead of a line.
  const prevGeneralLogs = prev.vehicles.flatMap((v) => (v.generalLogs || []).map((g) => ({ ...g, _vehId: v.id })));
  const nextGeneralLogs = nextData.vehicles.flatMap((v) => (v.generalLogs || []).map((g) => ({ ...g, _vehId: v.id })));
  await syncEntity(
    TABLES.laborLogs, recIds.logs, prevGeneralLogs, nextGeneralLogs,
    (g) => generalLogToFields(g, recIds.vehicles.get(g._vehId))
  );

  // Estimate edits are an append-only audit trail — never update or delete them.
  const prevEdits = prevLines.flatMap((l) => (l.estEdits || []).map((e) => ({ ...e, _lineId: l.id })));
  const nextEdits = nextLines.flatMap((l) => (l.estEdits || []).map((e) => ({ ...e, _lineId: l.id })));
  const editsCreated = nextEdits.filter((e) => !prevEdits.some((p) => p.id === e.id));
  if (editsCreated.length) {
    const created = await createRecords(
      TABLES.estEdits,
      editsCreated.map((e) => estEditToFields(e, recIds.lines.get(e._lineId)))
    );
    created.forEach((rec) => {
      const appId = rec.fields['App Id'];
      if (appId) recIds.edits.set(appId, rec.id);
    });
  }

  // Activity is also append-only: the client caps its in-memory list at 200 for
  // display, but that must never be read as "delete the older ones" — so this
  // only ever creates new notifications, never updates or deletes.
  const prevNotifIds = new Set(prev.notifications.map((n) => n.id));
  const newNotifs = nextData.notifications.filter((n) => !prevNotifIds.has(n.id));
  if (newNotifs.length) {
    const created = await createRecords(
      TABLES.activity,
      newNotifs.map((n) => activityToFields(n, recIds.vehicles.get(n.vehicleId)))
    );
    created.forEach((rec) => {
      const appId = rec.fields['App Id'];
      if (appId) recIds.activity.set(appId, rec.id);
    });
  }

  // Settings (shop labor rate) — a single row.
  if (Number(nextData.laborRate) !== Number(prev.laborRate)) {
    const fields = { 'Labor Rate': Number(nextData.laborRate) || 100 };
    if (settingsRecordId) {
      await updateRecords(TABLES.settings, [{ id: settingsRecordId, fields }]);
    } else {
      const created = await createRecords(TABLES.settings, [fields]);
      settingsRecordId = created[0]?.id || null;
    }
  }

  lastSynced = clone(nextData);
}

/* ---------- local fallback (Airtable unreachable) ---------- */

function readLocalFallback() {
  try {
    const raw = window.localStorage.getItem(LOCAL_FALLBACK_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLocalFallback(data) {
  window.localStorage.setItem(LOCAL_FALLBACK_KEY, JSON.stringify(data));
}

/* ---------- public contract (matches the old window.storage-backed helpers) ---------- */

export async function initStorage() {
  try {
    const data = await loadAll();
    storageMode = 'shared';
    return data;
  } catch (e) {
    console.error('Airtable unavailable, falling back to local storage:', e.message);
  }
  try {
    const cached = readLocalFallback();
    const data = cached || emptyDataShape();
    if (!cached) writeLocalFallback(data);
    lastSynced = clone(data);
    storageMode = 'personal';
    return data;
  } catch (e) {
    console.error('Local storage unavailable:', e);
  }
  storageMode = 'memory';
  lastSynced = emptyDataShape();
  return clone(lastSynced);
}

export async function tryRead() {
  if (storageMode === 'shared') return loadAll();
  if (storageMode === 'personal') return readLocalFallback();
  return null;
}

export async function persist(data) {
  if (storageMode === 'memory') return false;
  try {
    if (storageMode === 'personal') {
      writeLocalFallback(data);
      lastSynced = clone(data);
      return true;
    }
    await persistToAirtable(data);
    return true;
  } catch (e) {
    console.error('save failed', e);
    return false;
  }
}
