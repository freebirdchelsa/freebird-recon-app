// Table names and the app-object <-> Airtable-fields mapping. This is the one
// place that needs to match the base's field names exactly (see the deployment
// handoff doc, section 4, for the table layout).

export const TABLES = {
  vehicles: 'Vehicles',
  lines: 'Repair Lines',
  laborLogs: 'Labor Logs',
  estEdits: 'Estimate Edits',
  activity: 'Activity',
  settings: 'Settings',
};

export const numOrNull = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const safeJSON = (str) => {
  if (!str) return {};
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
};

/* ---------- vehicles ---------- */

export function vehicleToFields(v) {
  return {
    'App Id': v.id,
    Stock: v.stock || '',
    Year: numOrNull(v.year),
    Make: v.make || '',
    Model: v.model || '',
    VIN: v.vin || '',
    Miles: numOrNull(v.miles),
    'Buy Price': numOrNull(v.buyPrice),
    Notes: v.notes || '',
    Stage: v.stage || 'intake',
    'Added Ts': v.addedTs ?? null,
    'Added By': v.addedBy || '',
    'Inspection By': v.inspection?.by || '',
    'Inspection Ts': v.inspection?.ts ?? null,
    'Inspection Results': v.inspection ? JSON.stringify(v.inspection.results || {}) : '',
    'Detail Done': !!v.detailDone,
    'Detail Ts': v.detailTs ?? null,
    'Detail By': v.detailBy || '',
    'Em Passed': !!v.emPassed,
    'Em Date': v.emDate || null,
    'Em By': v.emBy || '',
    'Oil Done': !!v.oilDone,
    'Oil Date': v.oilDate || null,
    'Oil Sticker': !!v.oilSticker,
    'Oil Sticker Date': v.oilStickerDate || null,
    'Final Sign By': v.finalSign?.by || '',
    'Final Sign Ts': v.finalSign?.ts ?? null,
  };
}

export function fieldsToVehicle(rec) {
  const f = rec.fields;
  return {
    id: f['App Id'],
    year: f['Year'] ?? '',
    make: f['Make'] || '',
    model: f['Model'] || '',
    stock: f['Stock'] || '',
    vin: f['VIN'] || '',
    miles: f['Miles'] ?? '',
    buyPrice: f['Buy Price'] ?? '',
    notes: f['Notes'] || '',
    stage: f['Stage'] || 'intake',
    addedTs: f['Added Ts'] ?? Date.now(),
    addedBy: f['Added By'] || '',
    inspection: f['Inspection Ts']
      ? { by: f['Inspection By'] || '', ts: f['Inspection Ts'], results: safeJSON(f['Inspection Results']) }
      : null,
    detailDone: !!f['Detail Done'],
    detailTs: f['Detail Ts'] ?? null,
    detailBy: f['Detail By'] || null,
    emPassed: !!f['Em Passed'],
    emDate: f['Em Date'] || null,
    emBy: f['Em By'] || null,
    oilDone: !!f['Oil Done'],
    oilDate: f['Oil Date'] || null,
    oilSticker: !!f['Oil Sticker'],
    oilStickerDate: f['Oil Sticker Date'] || null,
    finalSign: f['Final Sign Ts'] ? { by: f['Final Sign By'] || '', ts: f['Final Sign Ts'] } : null,
    lines: [],
  };
}

/* ---------- repair lines ---------- */

export function lineToFields(l, vehicleRecordId) {
  return {
    'App Id': l.id,
    Vehicle: vehicleRecordId ? [vehicleRecordId] : [],
    Desc: l.desc || '',
    Note: l.note || '',
    Source: l.source || 'manual',
    Status: l.status || 'pending',
    'Added By': l.addedBy || '',
    Ts: l.ts ?? null,
    'Decided By': l.decidedBy || '',
    'Decided Ts': l.decidedTs ?? null,
    'Est Parts': numOrNull(l.estParts),
    'Est Labor': numOrNull(l.estLabor),
    'Actual Parts': numOrNull(l.actualParts),
    'Actual Labor': numOrNull(l.actualLabor),
    'Parts Status': l.partsStatus || 'none',
    'Parts Ts': l.partsTs ?? null,
    'Parts Final': numOrNull(l.partsFinal),
    'Parts Vendor': l.partsVendor || '',
    'Sched Tech': l.sched?.tech || '',
    'Sched Date': l.sched?.date || null,
    'Sched Start': l.sched?.start ?? null,
    'Sched Hours': l.sched?.hours ?? null,
  };
}

export function fieldsToLine(rec) {
  const f = rec.fields;
  const sched = f['Sched Tech']
    ? { tech: f['Sched Tech'], date: f['Sched Date'] || '', start: f['Sched Start'] ?? 0, hours: f['Sched Hours'] ?? 0 }
    : null;
  return {
    id: f['App Id'],
    desc: f['Desc'] || '',
    note: f['Note'] || '',
    source: f['Source'] || 'manual',
    status: f['Status'] || 'pending',
    addedBy: f['Added By'] || '',
    ts: f['Ts'] ?? Date.now(),
    decidedBy: f['Decided By'] || '',
    decidedTs: f['Decided Ts'] ?? null,
    estParts: f['Est Parts'] ?? '',
    estLabor: f['Est Labor'] ?? '',
    actualParts: f['Actual Parts'] ?? '',
    actualLabor: f['Actual Labor'] ?? '',
    estEdits: [],
    partsStatus: f['Parts Status'] || 'none',
    partsTs: f['Parts Ts'] ?? null,
    partsFinal: f['Parts Final'] ?? '',
    partsVendor: f['Parts Vendor'] || '',
    laborLogs: [],
    sched,
    _vehicleRecId: (f['Vehicle'] || [])[0] || null,
  };
}

/* ---------- labor logs ---------- */

export function logToFields(g, lineRecordId) {
  return {
    'App Id': g.id,
    'Repair Line': lineRecordId ? [lineRecordId] : [],
    By: g.by || '',
    Start: g.start ?? null,
    End: g.end ?? null,
  };
}

export function fieldsToLog(rec) {
  const f = rec.fields;
  return {
    id: f['App Id'],
    by: f['By'] || '',
    start: f['Start'] ?? null,
    end: f['End'] ?? null,
    _lineRecId: (f['Repair Line'] || [])[0] || null,
  };
}

/* ---------- estimate edits ---------- */

export function estEditToFields(e, lineRecordId) {
  return {
    'App Id': e.id,
    'Repair Line': lineRecordId ? [lineRecordId] : [],
    By: e.by || '',
    Ts: e.ts ?? null,
    From: numOrNull(e.from),
    To: numOrNull(e.to),
  };
}

export function fieldsToEstEdit(rec) {
  const f = rec.fields;
  return {
    id: f['App Id'],
    by: f['By'] || '',
    ts: f['Ts'] ?? Date.now(),
    from: f['From'] ?? '',
    to: f['To'] ?? '',
    _lineRecId: (f['Repair Line'] || [])[0] || null,
  };
}

/* ---------- activity / notifications ---------- */

export function activityToFields(n, vehicleRecordId) {
  return {
    'App Id': n.id,
    Ts: n.ts ?? null,
    Text: n.text || '',
    Vehicle: vehicleRecordId ? [vehicleRecordId] : [],
    Type: n.type || 'info',
    By: n.by || '',
  };
}

export function fieldsToActivity(rec) {
  const f = rec.fields;
  return {
    id: f['App Id'],
    ts: f['Ts'] ?? Date.now(),
    text: f['Text'] || '',
    vehicleId: null,
    type: f['Type'] || 'info',
    by: f['By'] || '',
    _vehicleRecId: (f['Vehicle'] || [])[0] || null,
  };
}
