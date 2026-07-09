import React, { useState, useEffect, useCallback } from "react";
import {
  Bell, Plus, ChevronLeft, Car, ClipboardCheck, CheckCircle2, XCircle,
  MinusCircle, DollarSign, Wrench, ArrowRight, Clock, User, RefreshCw,
  AlertTriangle, Check, X, Camera, Sparkles, Flag, Trash2, LayoutGrid, Package, Pencil, ChevronRight, CalendarDays
} from "lucide-react";
import { initStorage, persist, tryRead, storageMode } from "./data/airtableStore.js";

/* ---------- constants ---------- */

const STAGES = [
  { id: "intake", label: "Intake" },
  { id: "inspection", label: "Inspection" },
  { id: "approval", label: "Approval" },
  { id: "parts", label: "Parts" },
  { id: "mechanical", label: "Mechanical" },
  { id: "detail", label: "Detail" },
  { id: "photos", label: "Photos" },
  { id: "frontline", label: "Front Line" },
];

const TEAM = ["Chelsa", "Jerry", "Oscar", "Mark", "Dan", "Kansas"];

const CHECKLIST = [
  {
    section: "Road Test",
    items: ["Engine starts & idles smooth", "Transmission shifts properly", "No warning lights", "Steering straight / no pull", "Brakes stop smooth, no noise", "HVAC blows cold & hot", "No abnormal noises or vibration"],
  },
  {
    section: "Under Hood",
    items: ["Engine oil level & condition", "Coolant level & condition", "Brake fluid level", "Belts & hoses", "Battery condition & terminals", "No visible leaks"],
  },
  {
    section: "Tires & Brakes",
    items: ["Tire tread depth (all 4)", "Tires match / even wear", "Brake pads front", "Brake pads rear", "Rotors condition", "Spare tire & jack present"],
  },
  {
    section: "Exterior",
    items: ["Body panels & paint", "Windshield & glass", "All exterior lights work", "Wipers & washers", "Mirrors intact"],
  },
  {
    section: "Interior",
    items: ["Seats & upholstery", "All power accessories work", "Radio / infotainment", "Horn works", "Seat belts function", "Odor check"],
  },
  {
    section: "Safety & Compliance",
    items: ["Airbag light off", "Open recalls checked", "Emissions readiness", "Keys / fobs accounted for"],
  },
];

const USER_KEY = "freebird-recon-me";

const money = (n) => {
  const v = Number(n) || 0;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 });
};
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const daysSince = (ts) => Math.max(0, Math.floor((Date.now() - ts) / 86400000));
const timeAgo = (ts) => {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};
const fmtDur = (ms) => {
  const m = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
};
// total labor time on a line, including anyone currently clocked in
const lineMs = (l) => (l.laborLogs || []).reduce((s, g) => s + ((g.end || Date.now()) - g.start), 0);
const openLog = (l, who) => (l.laborLogs || []).find((g) => !g.end && (!who || g.by === who));
const DEFAULT_RATE = 100;
// actual labor $ so far: manual final labor wins, else logged hours × shop rate, else the estimate
const lineLabor = (l, rate) => {
  if (l.actualLabor !== "" && l.actualLabor != null) return Number(l.actualLabor) || 0;
  const ms = lineMs(l);
  if (ms > 0) return (ms / 3600000) * (Number(rate) || DEFAULT_RATE);
  return Number(l.estLabor) || 0;
};
const linePartsCost = (l) =>
  (l.partsFinal !== "" && l.partsFinal != null ? Number(l.partsFinal)
  : l.actualParts !== "" && l.actualParts != null ? Number(l.actualParts)
  : Number(l.estParts)) || 0;

const emptyData = { vehicles: [], notifications: [] };

// initStorage()/persist()/tryRead() and the "shared"->"personal"->"memory"
// storageMode now live in ./data/airtableStore.js (Airtable-backed, falling back
// to this device's local storage if Airtable is unreachable).

const clone = (obj) => JSON.parse(JSON.stringify(obj));

/* ---------- root app ---------- */

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <Shell>
          <div className="p-6">
            <div className="p-4 rounded-xl bg-red-50 border border-red-300">
              <p className="font-display font-bold text-red-700 text-sm mb-1">Something broke — here's the exact error:</p>
              <p className="text-xs text-red-800 break-all font-mono bg-white rounded-lg border border-red-200 p-2.5">
                {String(this.state.error?.message || this.state.error)}
              </p>
              <button
                onClick={() => this.setState({ error: null })}
                className="mt-3 w-full py-2.5 rounded-lg text-white text-sm font-bold"
                style={{ background: "#0D2440" }}
              >
                Reload app (your data is saved)
              </button>
            </div>
          </div>
        </Shell>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <Main />
    </ErrorBoundary>
  );
}

function Main() {
  const [data, setData] = useState(null);
  const dataRef = React.useRef(emptyData);
  const [me, setMe] = useState(null);
  const [lastRead, setLastRead] = useState(0);
  const [view, setView] = useState({ name: "board" });
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState("memory");
  const [err, setErr] = useState(null);

  // trap any error so it stays on screen instead of flashing by
  useEffect(() => {
    const onErr = (e) => setErr(e?.error?.message || e?.message || String(e));
    const onRej = (e) => setErr(e?.reason?.message || String(e?.reason || "Unhandled promise error"));
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, []);

  const applyData = useCallback((d) => {
    dataRef.current = d;
    setData(d);
  }, []);

  // refresh = pull latest from storage (e.g. a teammate made changes); keep current data if read fails
  const refresh = useCallback(async () => {
    if (storageMode === "memory") return;
    try {
      const d = await tryRead(storageMode === "shared");
      if (d) applyData(d);
    } catch {}
  }, [applyData]);

  useEffect(() => {
    (async () => {
      try {
        const u = await window.storage.get(USER_KEY, false);
        if (u && u.value) {
          const parsed = JSON.parse(u.value);
          setMe(parsed.name);
          setLastRead(parsed.lastRead || 0);
        }
      } catch {}
      const d = await initStorage();
      applyData(d);
      setMode(storageMode);
      setLoading(false);
    })();
  }, [applyData]);

  // mutate = apply change to the live local copy, then write through to storage.
  // Local state is the source of truth, so a flaky save never makes vehicles disappear.
  const mutate = useCallback(async (fn) => {
    try {
      const next = fn(clone(dataRef.current)) || dataRef.current;
      applyData(next);
      await persist(next);
      return next;
    } catch (e) {
      setErr(e?.message || String(e));
      return dataRef.current;
    }
  }, [applyData]);

  const notify = (d, text, vehicleId, type = "info") => {
    d.notifications.unshift({ id: uid(), ts: Date.now(), text, vehicleId, type, by: me });
    d.notifications = d.notifications.slice(0, 200);
  };

  const pickUser = async (name) => {
    setMe(name);
    try {
      await window.storage.set(USER_KEY, JSON.stringify({ name, lastRead }), false);
    } catch {}
  };

  const markRead = async () => {
    const now = Date.now();
    setLastRead(now);
    try {
      await window.storage.set(USER_KEY, JSON.stringify({ name: me, lastRead: now }), false);
    } catch {}
  };

  if (loading) {
    return (
      <Shell>
        <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-400">
          <Car className="w-10 h-10 animate-pulse" />
          <p className="text-sm">Loading the lot…</p>
        </div>
      </Shell>
    );
  }

  if (!me) return <Shell><PickUser onPick={pickUser} /></Shell>;

  const unread = (data?.notifications || []).filter((n) => n.ts > lastRead).length;
  const pendingApprovals = (data?.vehicles || []).reduce(
    (sum, v) => sum + (v.lines || []).filter((l) => l.status === "pending").length, 0
  );

  const goVehicle = (id) => setView({ name: "vehicle", id });

  return (
    <Shell>
      <Header
        me={me}
        unread={unread}
        pendingApprovals={pendingApprovals}
        view={view}
        onBell={async () => { setView({ name: "notifications" }); }}
        onApprovals={() => setView({ name: "approvals" })}
        onDashboard={() => setView({ name: "dashboard" })}
        onLabor={() => setView({ name: "labor" })}
        onSchedule={() => setView({ name: "schedule" })}
        onHome={() => setView({ name: "board" })}
        onRefresh={refresh}
        onSwitchUser={() => setMe(null)}
      />

      {err && (
        <div className="px-4 py-2.5 bg-red-600 text-white text-xs flex items-start gap-3">
          <span className="flex-1 break-all font-mono">Error: {err}</span>
          <button onClick={() => setErr(null)} className="shrink-0 font-bold underline">Dismiss</button>
        </div>
      )}

      {mode !== "shared" && (
        <div className="px-4 py-1.5 text-[11px] font-semibold text-amber-800 bg-amber-100 border-b border-amber-200">
          {mode === "personal"
            ? "Team sync unavailable — changes are saving to your device only."
            : "Storage unavailable — changes will last this session only."}
        </div>
      )}

      <div className="flex border-b border-slate-200 bg-white sticky top-[60px] z-10">
        {[["board", "Board"], ["dashboard", "Dashboard"], ["labor", "Labor"], ["schedule", "Schedule"]].map(([tid, label]) => (
          <button
            key={tid}
            onClick={() => setView({ name: tid })}
            className={`flex-1 py-2.5 text-xs font-display font-bold uppercase tracking-wide ${
              view.name === tid ? "text-slate-900 border-b-2" : "text-slate-400"
            }`}
            style={view.name === tid ? { borderColor: "#3B8CDE" } : undefined}
          >
            {label}
          </button>
        ))}
      </div>

      {view.name === "board" && (
        <Board data={data} onOpen={goVehicle} onAdd={() => setView({ name: "add" })} />
      )}

      {view.name === "add" && (
        <AddVehicle
          me={me}
          existing={data?.vehicles || []}
          onCancel={() => setView({ name: "board" })}
          onSave={(v) => {
            mutate((d) => {
              d.vehicles.unshift(v);
              notify(d, `${me} added ${v.year} ${v.make} ${v.model} (#${v.stock}) to Intake`, v.id, "stage");
              return d;
            });
            setView({ name: "vehicle", id: v.id });
          }}
        />
      )}

      {view.name === "vehicle" && (
        <VehicleDetail
          data={data}
          id={view.id}
          me={me}
          mutate={mutate}
          notify={notify}
          onBack={() => setView({ name: "board" })}
          onInspect={() => setView({ name: "inspect", id: view.id })}
          onFinalize={(required) => setView({ name: "finalize", id: view.id, required })}
        />
      )}

      {view.name === "finalize" && (
        <FinalizeRecon
          data={data}
          id={view.id}
          me={me}
          required={view.required}
          mutate={mutate}
          notify={notify}
          onBack={() => setView({ name: "vehicle", id: view.id })}
        />
      )}

      {view.name === "inspect" && (
        <Inspection
          data={data}
          id={view.id}
          me={me}
          onCancel={() => setView({ name: "vehicle", id: view.id })}
          onSubmit={async (results, lines) => {
            await mutate((d) => {
              const v = d.vehicles.find((x) => x.id === view.id);
              if (!v) return d;
              v.inspection = { by: me, ts: Date.now(), results };
              v.lines = [...(v.lines || []), ...lines];
              if (v.stage === "intake" || v.stage === "inspection") v.stage = lines.length ? "approval" : "parts";
              const fails = lines.length;
              notify(
                d,
                `${me} completed inspection on #${v.stock} — ${fails ? `${fails} item${fails > 1 ? "s" : ""} need approval` : "no repairs needed"}`,
                v.id,
                fails ? "approval" : "stage"
              );
              return d;
            });
            setView({ name: "vehicle", id: view.id });
          }}
        />
      )}

      {view.name === "approvals" && (
        <Approvals data={data} me={me} mutate={mutate} notify={notify} onOpen={goVehicle} />
      )}

      {view.name === "dashboard" && (
        <Dashboard data={data} onOpen={goVehicle} />
      )}

      {view.name === "labor" && (
        <LaborReport data={data} onOpen={goVehicle} />
      )}

      {view.name === "schedule" && (
        <SchedulePage data={data} me={me} mutate={mutate} notify={notify} onOpen={goVehicle} />
      )}

      {view.name === "notifications" && (
        <Notifications data={data} lastRead={lastRead} onSeen={markRead} onOpen={goVehicle} />
      )}
    </Shell>
  );
}

/* ---------- shell & header ---------- */

function Shell({ children }) {
  return (
    <div className="min-h-screen" style={{ background: "#0D2440", fontFamily: "'Open Sans', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;800&family=Open+Sans:wght@400;600;700&display=swap');
        .font-display { font-family: 'Montserrat', sans-serif; }
        * { -webkit-tap-highlight-color: transparent; }
        @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
      `}</style>
      <div className="max-w-3xl mx-auto min-h-screen bg-slate-50 shadow-2xl flex flex-col">
        {children}
      </div>
    </div>
  );
}

function Header({ me, unread, pendingApprovals, onBell, onApprovals, onDashboard, onLabor, onSchedule, onHome, onRefresh, onSwitchUser }) {
  return (
    <div className="sticky top-0 z-20" style={{ background: "#0D2440" }}>
      <div className="flex items-center gap-2 px-3 py-3">
        <button onClick={onHome} className="flex items-center gap-2 text-white shrink-0">
          <div className="w-8 h-8 rounded-md flex items-center justify-center" style={{ background: "#3B8CDE" }}>
            <Car className="w-5 h-5 text-white" />
          </div>
          <div className="text-left leading-tight hidden md:block">
            <div className="font-display font-800 font-extrabold text-sm tracking-wide">FREEBIRD RECON</div>
            <div className="text-[10px] text-sky-300 uppercase tracking-widest">Lot to front line</div>
          </div>
        </button>
        <div className="flex-1" />
        <button onClick={onSchedule} className="p-1.5 text-sky-200 hover:text-white" aria-label="Schedule">
          <CalendarDays className="w-5 h-5" />
        </button>
        <button onClick={onLabor} className="p-1.5 text-sky-200 hover:text-white" aria-label="Labor hours">
          <Clock className="w-5 h-5" />
        </button>
        <button onClick={onDashboard} className="p-1.5 text-sky-200 hover:text-white" aria-label="Dashboard">
          <LayoutGrid className="w-5 h-5" />
        </button>
        <button onClick={onRefresh} className="p-1.5 text-sky-200 hover:text-white" aria-label="Refresh data">
          <RefreshCw className="w-5 h-5" />
        </button>
        <button onClick={onApprovals} className="relative p-1.5 text-sky-200 hover:text-white" aria-label="Approvals">
          <ClipboardCheck className="w-5 h-5" />
          {pendingApprovals > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-400 text-[#0D2440] text-[10px] font-bold flex items-center justify-center">
              {pendingApprovals}
            </span>
          )}
        </button>
        <button onClick={onBell} className="relative p-1.5 text-sky-200 hover:text-white" aria-label="Notifications">
          <Bell className="w-5 h-5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
              {unread}
            </span>
          )}
        </button>
        <button onClick={onSwitchUser} className="flex items-center gap-1.5 pl-2 pr-3 py-1.5 rounded-full text-xs font-semibold text-white shrink-0" style={{ background: "#3B8CDE" }}>
          <User className="w-3.5 h-3.5" /> {me}
        </button>
      </div>
    </div>
  );
}

function PickUser({ onPick }) {
  return (
    <div className="p-6 flex flex-col items-center justify-center flex-1 min-h-[70vh]" style={{ background: "#0D2440" }}>
      <div className="w-14 h-14 rounded-xl flex items-center justify-center mb-4" style={{ background: "#3B8CDE" }}>
        <Car className="w-8 h-8 text-white" />
      </div>
      <h1 className="font-display font-extrabold text-white text-2xl mb-1">FreeBird Recon</h1>
      <p className="text-sky-300 text-sm mb-8">Who's clocking in?</p>
      <div className="grid grid-cols-2 gap-3 w-full max-w-xs">
        {TEAM.map((n) => (
          <button
            key={n}
            onClick={() => onPick(n)}
            className="py-3 rounded-lg font-display font-bold text-white border border-sky-700 hover:border-sky-300"
            style={{ background: "rgba(59,140,222,0.15)" }}
          >
            {n}
          </button>
        ))}
      </div>
      <p className="text-sky-500 text-[11px] mt-8 text-center max-w-xs">
        Heads up: recon data is shared — everyone using this app sees the same board.
      </p>
    </div>
  );
}

/* ---------- board ---------- */

function vehicleCost(v, rate) {
  const lineTotal = (v.lines || []).reduce((s, l) => {
    if (l.status === "declined") return s;
    return s + linePartsCost(l) + lineLabor(l, rate);
  }, 0);
  return lineTotal + (v.detailDone ? 150 : 0) + (v.emPassed ? 16.15 : 0) + (v.oilDone ? 79.99 : 0);
}

function Board({ data, onOpen, onAdd }) {
  const vehicles = data?.vehicles || [];
  const active = vehicles.filter((v) => v.stage !== "frontline");
  const done = vehicles.filter((v) => v.stage === "frontline");

  return (
    <div className="flex-1 pb-24">
      <div className="px-4 pt-4 pb-2 flex items-baseline justify-between">
        <h2 className="font-display font-bold text-lg text-slate-800">In Recon ({active.length})</h2>
        <span className="text-xs text-slate-400">{done.length} front line</span>
      </div>

      {active.length === 0 && (
        <div className="mx-4 mt-6 p-8 rounded-xl border-2 border-dashed border-slate-300 text-center">
          <Car className="w-8 h-8 mx-auto text-slate-300 mb-2" />
          <p className="text-slate-500 text-sm">No vehicles in recon. Tap “Add vehicle” to check one in.</p>
        </div>
      )}

      <div className="px-4 space-y-3">
        {STAGES.filter((s) => s.id !== "frontline").map((stage) => {
          const list = active.filter((v) => v.stage === stage.id);
          if (!list.length) return null;
          return (
            <div key={stage.id}>
              <div className="flex items-center gap-2 mt-4 mb-2">
                <span className="text-[11px] font-display font-bold uppercase tracking-widest text-slate-400">{stage.label}</span>
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-[11px] text-slate-400">{list.length}</span>
              </div>
              {list.map((v) => <VehicleCard key={v.id} v={v} onOpen={onOpen} rate={data?.laborRate} />)}
            </div>
          );
        })}

        {done.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mt-6 mb-2">
              <span className="text-[11px] font-display font-bold uppercase tracking-widest text-emerald-600">Front Line</span>
              <div className="flex-1 h-px bg-emerald-100" />
            </div>
            {done.map((v) => <VehicleCard key={v.id} v={v} onOpen={onOpen} done rate={data?.laborRate} />)}
          </div>
        )}
      </div>

      <button
        onClick={onAdd}
        className="fixed bottom-5 right-5 md:right-[calc(50%-24rem+1.25rem)] flex items-center gap-2 px-5 py-3.5 rounded-full text-white font-display font-bold shadow-lg z-30"
        style={{ background: "#3B8CDE" }}
      >
        <Plus className="w-5 h-5" /> Add vehicle
      </button>
    </div>
  );
}

function VehicleCard({ v, onOpen, done, rate }) {
  const stageIdx = STAGES.findIndex((s) => s.id === v.stage);
  const pending = (v.lines || []).filter((l) => l.status === "pending").length;
  const cost = vehicleCost(v, rate);
  return (
    <button
      onClick={() => onOpen(v.id)}
      className={`w-full text-left mb-2 p-3.5 rounded-xl bg-white border ${done ? "border-emerald-200" : "border-slate-200"} shadow-sm active:scale-[0.99]`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-display font-bold text-slate-800 text-[15px]">
            {v.year} {v.make} {v.model}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">
            #{v.stock} · {v.vin ? `…${v.vin.slice(-6)}` : "no VIN"} · {(Number(v.miles) || 0).toLocaleString()} mi
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-bold text-slate-700">{money(cost)}</div>
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">recon</div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-1">
        {STAGES.map((s, i) => (
          <div
            key={s.id}
            className="h-1.5 flex-1 rounded-full"
            style={{ background: i < stageIdx ? "#3B8CDE" : i === stageIdx ? "#0D2440" : "#E2E8F0" }}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-500">
        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{daysSince(v.addedTs)}d in recon</span>
        {pending > 0 && (
          <span className="flex items-center gap-1 text-amber-600 font-semibold">
            <AlertTriangle className="w-3 h-3" />{pending} awaiting approval
          </span>
        )}
        {v.inspection && <span className="flex items-center gap-1 text-emerald-600"><ClipboardCheck className="w-3 h-3" />inspected</span>}
      </div>
    </button>
  );
}

/* ---------- add vehicle ---------- */

function AddVehicle({ me, existing, onSave, onCancel }) {
  const [f, setF] = useState({ year: "", make: "", model: "", stock: "", vin: "", miles: "", buyPrice: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const dupe = !saving && f.stock.trim() && (existing || []).some((v) => (v.stock || "").trim().toLowerCase() === f.stock.trim().toLowerCase());
  const ok = f.year && f.make && f.model && f.stock && !dupe && !saving;

  return (
    <div className="flex-1 p-4 pb-10">
      <BackBar onBack={onCancel} title="Check in a vehicle" />
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 shadow-sm">
        <div className="grid grid-cols-3 gap-2">
          <Field label="Year" value={f.year} onChange={set("year")} inputMode="numeric" placeholder="2019" />
          <Field label="Make" value={f.make} onChange={set("make")} placeholder="Chevy" />
          <Field label="Model" value={f.model} onChange={set("model")} placeholder="Malibu" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Stock #" value={f.stock} onChange={set("stock")} placeholder="FB1042" />
          <Field label="Miles" value={f.miles} onChange={set("miles")} inputMode="numeric" placeholder="84,000" />
        </div>
        <Field label="VIN" value={f.vin} onChange={set("vin")} placeholder="Full 17-digit VIN" />
        <Field label="Purchase price (optional)" value={f.buyPrice} onChange={set("buyPrice")} inputMode="numeric" placeholder="7500" />
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Intake notes</label>
          <textarea
            value={f.notes}
            onChange={set("notes")}
            rows={2}
            placeholder="Auction condition report, known issues, keys…"
            className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 text-sm focus:outline-none focus:border-sky-500"
          />
        </div>
      </div>
      {dupe && (
        <p className="mt-3 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Stock #{f.stock.trim()} is already on the board. Open that vehicle instead, or use a different stock number.
        </p>
      )}
      <button
        disabled={!ok}
        onClick={() => {
          if (saving) return;
          setSaving(true);
          onSave({
            id: uid(), ...f, stage: "intake", addedTs: Date.now(), addedBy: me,
            lines: [], inspection: null,
          });
        }}
        className="mt-4 w-full py-3.5 rounded-xl text-white font-display font-bold disabled:opacity-40"
        style={{ background: "#0D2440" }}
      >
        {saving ? "Checking in…" : "Check in to Intake"}
      </button>
    </div>
  );
}

function Field({ label, ...props }) {
  return (
    <div>
      <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</label>
      <input
        {...props}
        className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 text-sm focus:outline-none focus:border-sky-500"
      />
    </div>
  );
}

function EditVehicle({ v, others, onSave, onCancel }) {
  const [f, setF] = useState({
    year: v.year || "", make: v.make || "", model: v.model || "",
    stock: v.stock || "", vin: v.vin || "", miles: v.miles || "",
    buyPrice: v.buyPrice || "", notes: v.notes || "",
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const dupe = f.stock.trim() && others.some((x) => (x.stock || "").trim().toLowerCase() === f.stock.trim().toLowerCase());
  const ok = f.year && f.make && f.model && f.stock && !dupe;

  return (
    <div className="mb-3 bg-white rounded-xl border-2 border-sky-300 p-4 space-y-3 shadow-sm">
      <p className="text-xs font-bold text-sky-700 -mb-1">Fix vehicle info — corrections apply everywhere (board, dashboard, reports)</p>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Year" value={f.year} onChange={set("year")} inputMode="numeric" />
        <Field label="Make" value={f.make} onChange={set("make")} />
        <Field label="Model" value={f.model} onChange={set("model")} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Stock #" value={f.stock} onChange={set("stock")} />
        <Field label="Miles" value={f.miles} onChange={set("miles")} inputMode="numeric" />
      </div>
      <Field label="VIN" value={f.vin} onChange={set("vin")} />
      <Field label="Purchase price" value={f.buyPrice} onChange={set("buyPrice")} inputMode="numeric" />
      <div>
        <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Intake notes</label>
        <textarea
          value={f.notes}
          onChange={set("notes")}
          rows={2}
          className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 text-sm focus:outline-none focus:border-sky-500"
        />
      </div>
      {dupe && (
        <p className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Stock #{f.stock.trim()} belongs to another vehicle on the board.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button disabled={!ok} onClick={() => onSave(f)} className="py-2.5 rounded-lg text-white text-sm font-bold disabled:opacity-40" style={{ background: "#0D2440" }}>
          Save corrections
        </button>
        <button onClick={onCancel} className="py-2.5 rounded-lg bg-white border border-slate-300 text-slate-600 text-sm font-bold">
          Cancel
        </button>
      </div>
    </div>
  );
}

function BackBar({ onBack, title, right }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <button onClick={onBack} className="p-1.5 -ml-1.5 text-slate-500" aria-label="Back">
        <ChevronLeft className="w-6 h-6" />
      </button>
      <h2 className="font-display font-bold text-lg text-slate-800 flex-1">{title}</h2>
      {right}
    </div>
  );
}

/* ---------- vehicle detail ---------- */

function VehicleDetail({ data, id, me, mutate, notify, onBack, onInspect, onFinalize }) {
  const v = (data?.vehicles || []).find((x) => x.id === id);
  const [showAddLine, setShowAddLine] = useState(false);
  const [prefill, setPrefill] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [showClockPicker, setShowClockPicker] = useState(false);
  const [editing, setEditing] = useState(false);
  // tick every second so running clocks update live
  const anyoneClockedIn = !!v && (v.lines || []).some((l) => openLog(l));
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!anyoneClockedIn) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [anyoneClockedIn]);
  if (!v) return <div className="p-6 text-slate-500">Vehicle not found. It may have been removed.<button onClick={onBack} className="block mt-3 text-sky-600 font-semibold">Back to board</button></div>;

  const stageIdx = STAGES.findIndex((s) => s.id === v.stage);
  const rate = Number(data?.laborRate) || DEFAULT_RATE;
  const cost = vehicleCost(v, rate);
  const approvedLines = (v.lines || []).filter((l) => l.status === "approved");
  const activity = (data.notifications || []).filter((n) => n.vehicleId === id).slice(0, 15);

  const advance = async () => {
    const next = STAGES[stageIdx + 1];
    if (!next) return;
    setStage(next.id);
  };

  const setStage = async (stageId) => {
    if (!v || stageId === v.stage) return;
    if ((stageId === "photos" || stageId === "frontline") && !v.finalSign) {
      onFinalize(true); // Dan's sign-off required before pictures
      return;
    }
    const target = STAGES.find((s) => s.id === stageId);
    const backward = STAGES.findIndex((s) => s.id === stageId) < stageIdx;
    await mutate((d) => {
      const vv = d.vehicles.find((x) => x.id === id);
      if (!vv) return d;
      vv.stage = stageId;
      notify(d, `${me} moved #${vv.stock} ${backward ? "back " : ""}to ${target.label}`, id, "stage");
      return d;
    });
  };

  const setActual = async (lineId, key, val) => {
    await mutate((d) => {
      const vv = d.vehicles.find((x) => x.id === id);
      const l = vv?.lines?.find((x) => x.id === lineId);
      if (l) l[key] = val;
      return d;
    });
  };

  const setVehicleField = async (patch, message, type = "info") => {
    await mutate((d) => {
      const vv = d.vehicles.find((x) => x.id === id);
      if (!vv) return d;
      Object.assign(vv, patch);
      if (message) notify(d, message, id, type);
      return d;
    });
  };

  const editEstLabor = async (lineId, val) => {
    await mutate((d) => {
      const vv = d.vehicles.find((x) => x.id === id);
      const l = vv?.lines?.find((x) => x.id === lineId);
      if (!l) return d;
      const from = l.estLabor;
      l.estLabor = val;
      l.estEdits = [...(l.estEdits || []), { by: me, ts: Date.now(), from, to: val }];
      notify(d, `${me} changed labor estimate on "${l.desc}" (#${vv.stock}): ${money(from)} → ${money(val)}`, id, "info");
      return d;
    });
  };

  const setParts = async (lineId, status) => {
    await mutate((d) => {
      const vv = d.vehicles.find((x) => x.id === id);
      const l = vv?.lines?.find((x) => x.id === lineId);
      if (!l) return d;
      l.partsStatus = status;
      l.partsTs = Date.now();
      notify(
        d,
        status === "arrived"
          ? `Parts ARRIVED for "${l.desc}" on #${vv.stock} (marked by ${me})`
          : `${me} ordered parts for "${l.desc}" on #${vv.stock}`,
        id,
        status === "arrived" ? "approved" : "info"
      );
      return d;
    });
  };

  const toggleClock = async (lineId) => {
    await mutate((d) => {
      const vv = d.vehicles.find((x) => x.id === id);
      const l = vv?.lines?.find((x) => x.id === lineId);
      if (!l) return d;
      l.laborLogs = l.laborLogs || [];
      const open = l.laborLogs.find((g) => !g.end && g.by === me);
      if (open) {
        open.end = Date.now();
        notify(d, `${me} clocked out of "${l.desc}" on #${vv.stock} — ${fmtDur(open.end - open.start)} logged`, id, "stage");
      } else {
        l.laborLogs.push({ id: uid(), by: me, start: Date.now(), end: null });
        notify(d, `${me} clocked IN on "${l.desc}" — #${vv.stock}`, id, "info");
      }
      return d;
    });
  };

  const totalLaborMs = (v.lines || []).reduce((s, l) => s + lineMs(l), 0);

  const removeVehicle = async () => {
    await mutate((d) => {
      d.vehicles = d.vehicles.filter((x) => x.id !== id);
      notify(d, `${me} removed #${v.stock} ${v.year} ${v.make} ${v.model} from the board`, null, "info");
      return d;
    });
    onBack();
  };

  return (
    <div className="flex-1 p-4 pb-10">
      <BackBar
        onBack={onBack}
        title={`${v.year} ${v.make} ${v.model}`}
        right={
          <button onClick={() => setEditing(!editing)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-300 text-slate-600 text-xs font-bold">
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
        }
      />

      {editing && (
        <EditVehicle
          v={v}
          others={(data?.vehicles || []).filter((x) => x.id !== id)}
          onCancel={() => setEditing(false)}
          onSave={async (patch) => {
            const before = `${v.year} ${v.make} ${v.model} #${v.stock}`;
            const after = `${patch.year} ${patch.make} ${patch.model} #${patch.stock}`;
            await setVehicleField(
              patch,
              before !== after ? `${me} corrected vehicle info: ${before} → ${after}` : `${me} updated vehicle details on #${patch.stock}`,
              "info"
            );
            setEditing(false);
          }}
        />
      )}

      {/* identity + stage */}
      <div className="rounded-xl p-4 text-white shadow-sm" style={{ background: "#0D2440" }}>
        <div className="flex justify-between text-xs text-sky-300">
          <span>#{v.stock} · {(Number(v.miles) || 0).toLocaleString()} mi</span>
          <span>{daysSince(v.addedTs)} days in recon</span>
        </div>
        {v.vin && <div className="text-[11px] text-sky-400 mt-0.5">VIN {v.vin}</div>}
        <div className="mt-3 flex items-center gap-1">
          {STAGES.map((s, i) => (
            <div key={s.id} className="flex-1">
              <div className="h-1.5 rounded-full" style={{ background: i < stageIdx ? "#3B8CDE" : i === stageIdx ? "#FFFFFF" : "rgba(255,255,255,0.15)" }} />
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="font-display font-bold">{STAGES[stageIdx]?.label}</span>
          {stageIdx < STAGES.length - 1 ? (
            <button onClick={advance} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold" style={{ background: "#3B8CDE" }}>
              Move to {STAGES[stageIdx + 1].label} <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <span className="flex items-center gap-1 text-emerald-300 text-xs font-bold"><Sparkles className="w-4 h-4" /> Ready to sell</span>
          )}
        </div>
        <div className="mt-3 pt-3 border-t border-sky-900">
          <div className="text-[10px] uppercase tracking-widest text-sky-400 font-bold mb-1.5">Jump to any stage</div>
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
            {STAGES.map((s) => (
              <button
                key={s.id}
                onClick={() => setStage(s.id)}
                className={`shrink-0 px-2.5 py-1.5 rounded-full text-[11px] font-bold ${
                  s.id === v.stage ? "bg-white text-slate-900" : "text-sky-200 border border-sky-700"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* costs */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Stat label="Purchase" value={v.buyPrice ? money(v.buyPrice) : "—"} />
        <Stat label="Recon cost" value={money(cost)} accent />
        <Stat label="Total in" value={money((Number(v.buyPrice) || 0) + cost)} />
      </div>

      {/* inspection */}
      <div className="mt-4 bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="font-display font-bold text-slate-800">Inspection</h3>
          {v.inspection ? (
            <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
              <CheckCircle2 className="w-4 h-4" /> {v.inspection.by} · {new Date(v.inspection.ts).toLocaleDateString()}
            </span>
          ) : (
            <span className="text-xs text-slate-400">Not started</span>
          )}
        </div>
        {v.inspection && <InspectionSummary results={v.inspection.results} />}
        <button
          onClick={onInspect}
          className="mt-3 w-full py-2.5 rounded-lg font-display font-bold text-sm text-white"
          style={{ background: "#3B8CDE" }}
        >
          {v.inspection ? "Re-inspect vehicle" : "Start inspection"}
        </button>
      </div>

      {/* repair lines */}
      <div className="mt-4 bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-display font-bold text-slate-800">Repairs & costs</h3>
          <div className="flex items-center gap-3">
            {totalLaborMs > 0 && (
              <span className="text-[11px] font-bold text-sky-700 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" /> {fmtDur(totalLaborMs)} · {money((totalLaborMs / 3600000) * rate)}
              </span>
            )}
            <button onClick={() => setShowAddLine(!showAddLine)} className="text-xs font-bold text-sky-600 flex items-center gap-1">
              <Plus className="w-4 h-4" /> Add line
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mb-2">
          Shop labor rate $
          <input
            value={data?.laborRate ?? DEFAULT_RATE}
            onChange={(e) => mutate((d) => { d.laborRate = e.target.value; return d; })}
            inputMode="numeric"
            className="w-14 rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600"
          />
          /hr — clocked time bills at this rate until a final labor $ is entered
        </div>

        {/* clock in — must choose the failure being worked */}
        {approvedLines.length > 0 && (
          !showClockPicker ? (
            <button
              onClick={() => setShowClockPicker(true)}
              className="mb-3 w-full py-2.5 rounded-lg text-white text-sm font-display font-bold flex items-center justify-center gap-2"
              style={{ background: "#0D2440" }}
            >
              <Clock className="w-4 h-4" /> Clock in — choose the job
            </button>
          ) : (
            <div className="mb-3 p-3 rounded-lg border border-sky-200 bg-sky-50">
              <p className="text-xs font-bold text-slate-700 mb-2">What failure are you working on?</p>
              <div className="space-y-1.5">
                {approvedLines.map((l) => {
                  const mine = openLog(l, me);
                  return (
                    <button
                      key={l.id}
                      onClick={() => { toggleClock(l.id); setShowClockPicker(false); }}
                      className={`w-full text-left px-3 py-2 rounded-lg border text-sm font-semibold flex items-center justify-between ${
                        mine ? "border-red-300 bg-red-50 text-red-700" : "border-slate-200 bg-white text-slate-700"
                      }`}
                    >
                      <span className="truncate">{l.desc}</span>
                      <span className="shrink-0 text-[11px] font-bold">{mine ? `Clock out · ${fmtDur(Date.now() - mine.start)}` : lineMs(l) > 0 ? fmtDur(lineMs(l)) : "Start"}</span>
                    </button>
                  );
                })}
              </div>
              <button onClick={() => setShowClockPicker(false)} className="mt-2 text-xs font-bold text-slate-500">Cancel</button>
            </div>
          )
        )}

        {showAddLine && (
          <AddLine
            key={prefill ? prefill.desc : "new"}
            initial={prefill}
            onAdd={async (line) => {
              await mutate((d) => {
                const vv = d.vehicles.find((x) => x.id === id);
                if (!vv) return d;
                vv.lines = [...(vv.lines || []), line];
                notify(d, `${me} requested "${line.desc}" on #${vv.stock} — needs approval (${money((Number(line.estParts) || 0) + (Number(line.estLabor) || 0))} est.)`, id, "approval");
                return d;
              });
              setShowAddLine(false);
              setPrefill(null);
            }}
            me={me}
          />
        )}

        {(v.lines || []).length === 0 && !showAddLine && (
          <p className="text-sm text-slate-400 py-2">No repair lines yet. Failed inspection items land here automatically.</p>
        )}

        <div className="space-y-2 mt-2">
          {(v.lines || []).map((l) => (
            <LineRow
              key={l.id}
              l={l}
              me={me}
              rate={rate}
              onActual={setActual}
              onParts={setParts}
              onClock={toggleClock}
              onEditEst={editEstLabor}
              onSupplement={(line) => {
                setPrefill({ desc: `Additional: ${line.desc}` });
                setShowAddLine(true);
              }}
            />
          ))}
        </div>

        {!showAddLine && (
          <button
            onClick={() => { setPrefill(null); setShowAddLine(true); }}
            className="mt-3 w-full py-2.5 rounded-lg border-2 border-dashed border-sky-300 text-sky-600 text-sm font-bold"
          >
            + Request additional parts / labor
          </button>
        )}
      </div>

      {/* final checks */}
      <div className="mt-4 bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
        <h3 className="font-display font-bold text-slate-800 mb-2">Final checks</h3>

        {/* detail complete */}
        <label className="flex items-start gap-2.5 py-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!v.detailDone}
            onChange={(e) => {
              const on = e.target.checked;
              setVehicleField(
                { detailDone: on, detailTs: on ? Date.now() : null, detailBy: on ? me : null },
                on
                  ? `${me} marked detail COMPLETE on #${v.stock} — $150 detail fee added to recon`
                  : `${me} unchecked detail complete on #${v.stock} — $150 detail fee removed`,
                "stage"
              );
            }}
            className="w-5 h-5 mt-0.5 accent-emerald-600"
          />
          <span className="text-sm">
            <span className="font-semibold text-slate-800">Detail complete</span>
            {v.detailDone ? (
              <span className="block text-xs text-emerald-700 font-semibold">$150 detail fee added to recon total{v.detailBy ? ` · ${v.detailBy}` : ""}{v.detailTs ? ` · ${new Date(v.detailTs).toLocaleDateString()}` : ""}</span>
            ) : (
              <span className="block text-xs text-slate-400">Checking this adds a $150 detail fee to the recon total</span>
            )}
          </span>
        </label>

        {/* emissions */}
        <div className="py-2 border-t border-slate-100">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={!!v.emPassed}
              onChange={(e) => {
                const on = e.target.checked;
                setVehicleField(
                  { emPassed: on, emDate: on ? (v.emDate || new Date().toISOString().slice(0, 10)) : v.emDate },
                  on ? `#${v.stock} PASSED emissions${v.emBy ? ` (brought by ${v.emBy})` : ""} — $16.15 emissions fee added to recon (marked by ${me})` : `${me} unchecked passed emissions on #${v.stock} — $16.15 fee removed`,
                  on ? "approved" : "info"
                );
              }}
              className="w-5 h-5 mt-0.5 accent-emerald-600"
            />
            <span className="text-sm">
              <span className="font-semibold text-slate-800">Passed emissions</span>
              {v.emPassed ? (
                <span className="block text-xs text-emerald-700 font-semibold">$16.15 emissions fee added to recon total</span>
              ) : (
                <span className="block text-xs text-slate-400">Checking this adds the $16.15 emissions fee to the recon total</span>
              )}
            </span>
          </label>
          {v.emPassed && (
            <div className="mt-2 ml-7 grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Date passed</label>
                <input
                  type="date"
                  value={v.emDate || ""}
                  onChange={(e) => setVehicleField({ emDate: e.target.value })}
                  className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Who brought it</label>
                <select
                  value={v.emBy || ""}
                  onChange={(e) => setVehicleField({ emBy: e.target.value })}
                  className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1.5 text-xs bg-white"
                >
                  <option value="">Select…</option>
                  {TEAM.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>
          )}
        </div>

        {/* oil change */}
        <div className="py-2 border-t border-slate-100">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={!!v.oilDone}
              onChange={(e) => {
                const on = e.target.checked;
                setVehicleField(
                  on
                    ? { oilDone: true, oilDate: v.oilDate || new Date().toISOString().slice(0, 10), oilSticker: false, oilStickerDate: null }
                    : { oilDone: false, oilSticker: false, oilStickerDate: null },
                  on
                    ? `${me} completed oil change on #${v.stock} — $79.99 added to recon, windshield sticker reminder active`
                    : `${me} unchecked oil change on #${v.stock} — $79.99 removed`,
                  "stage"
                );
              }}
              className="w-5 h-5 mt-0.5 accent-emerald-600"
            />
            <span className="text-sm">
              <span className="font-semibold text-slate-800">Oil changed</span>
              {v.oilDone ? (
                <span className="block text-xs text-emerald-700 font-semibold">$79.99 oil change added to recon total</span>
              ) : (
                <span className="block text-xs text-slate-400">Checking this adds a $79.99 oil change to the recon total</span>
              )}
            </span>
          </label>

          {v.oilDone && (
            <div className="mt-2 ml-7">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Date of oil change</label>
              <input
                type="date"
                value={v.oilDate || ""}
                onChange={(e) => setVehicleField({ oilDate: e.target.value })}
                className="mt-0.5 w-full max-w-[180px] rounded border border-slate-300 px-2 py-1.5 text-xs block"
              />
            </div>
          )}

          {v.oilDone && !v.oilSticker && (
            <div className="mt-2 ml-7 p-2.5 rounded-lg bg-amber-50 border border-amber-300">
              <p className="text-xs font-bold text-amber-800 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" /> Place the oil change sticker on the windshield and reset the oil life monitor!
              </p>
              <label className="mt-2 flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={false}
                  onChange={() =>
                    setVehicleField(
                      { oilSticker: true, oilStickerDate: new Date().toISOString().slice(0, 10) },
                      `${me} placed the oil sticker on #${v.stock} & reset the monitor`
                    )
                  }
                  className="w-4 h-4 accent-emerald-600"
                />
                Sticker placed & monitor reset
              </label>
            </div>
          )}

          {v.oilDone && v.oilSticker && (
            <div className="mt-2 ml-7 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200">
              <p className="text-xs text-emerald-700 font-semibold flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> Sticker on windshield · monitor reset
              </p>
              <label className="mt-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Date sticker placed</label>
              <input
                type="date"
                value={v.oilStickerDate || ""}
                onChange={(e) => setVehicleField({ oilStickerDate: e.target.value })}
                className="mt-0.5 w-full max-w-[180px] rounded border border-emerald-300 bg-white px-2 py-1.5 text-xs block"
              />
            </div>
          )}
        </div>
      </div>

      {/* finalize */}
      <button
        onClick={() => onFinalize(false)}
        className="mt-4 w-full py-3.5 rounded-xl text-white font-display font-bold flex items-center justify-center gap-2"
        style={{ background: v.finalSign ? "#10B981" : "#0D2440" }}
      >
        {v.finalSign ? <><CheckCircle2 className="w-5 h-5" /> Recon finalized — view sheet</> : <>Finalize recon <ArrowRight className="w-5 h-5" /></>}
      </button>

      {/* activity */}
      <div className="mt-4 bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
        <h3 className="font-display font-bold text-slate-800 mb-2">Activity</h3>
        {activity.length === 0 && <p className="text-sm text-slate-400">Nothing yet.</p>}
        <div className="space-y-2.5">
          {activity.map((n) => (
            <div key={n.id} className="flex gap-2 text-sm">
              <NotifDot type={n.type} />
              <div className="flex-1">
                <p className="text-slate-700 leading-snug">{n.text}</p>
                <p className="text-[11px] text-slate-400">{timeAgo(n.ts)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {v.notes && (
        <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
          <span className="font-bold">Intake notes: </span>{v.notes}
        </div>
      )}

      {/* remove vehicle */}
      <div className="mt-6">
        {!confirmRemove ? (
          <button
            onClick={() => setConfirmRemove(true)}
            className="w-full py-3 rounded-xl border border-red-200 text-red-600 text-sm font-bold flex items-center justify-center gap-2 bg-white"
          >
            <Trash2 className="w-4 h-4" /> Remove vehicle from board
          </button>
        ) : (
          <div className="p-3 rounded-xl border border-red-300 bg-red-50">
            <p className="text-sm font-semibold text-red-700 mb-2">
              Remove #{v.stock} {v.year} {v.make} {v.model}? This deletes its inspection and repair lines and can't be undone.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={removeVehicle} className="py-2.5 rounded-lg bg-red-600 text-white text-sm font-bold">
                Yes, remove it
              </button>
              <button onClick={() => setConfirmRemove(false)} className="py-2.5 rounded-lg bg-white border border-slate-300 text-slate-600 text-sm font-bold">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div className={`rounded-xl p-3 border ${accent ? "border-sky-200 bg-sky-50" : "border-slate-200 bg-white"} shadow-sm`}>
      <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">{label}</div>
      <div className={`font-display font-bold ${accent ? "text-sky-700" : "text-slate-800"}`}>{value}</div>
    </div>
  );
}

function InspectionSummary({ results }) {
  const all = Object.values(results || {});
  const pass = all.filter((r) => r.status === "pass").length;
  const fail = all.filter((r) => r.status === "fail").length;
  const na = all.filter((r) => r.status === "na").length;
  return (
    <div className="mt-2 flex gap-2 text-xs">
      <span className="px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 font-semibold">{pass} pass</span>
      <span className="px-2 py-1 rounded-md bg-red-50 text-red-700 font-semibold">{fail} fail</span>
      <span className="px-2 py-1 rounded-md bg-slate-100 text-slate-500 font-semibold">{na} n/a</span>
    </div>
  );
}

function AddLine({ onAdd, me, initial }) {
  const [f, setF] = useState({ desc: initial?.desc || "", estParts: initial?.estParts || "", estLabor: initial?.estLabor || "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="mt-2 p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
      <Field label="Description" value={f.desc} onChange={set("desc")} placeholder="Front brake pads & rotors" />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Est. parts $" value={f.estParts} onChange={set("estParts")} inputMode="numeric" placeholder="180" />
        <Field label="Est. labor $" value={f.estLabor} onChange={set("estLabor")} inputMode="numeric" placeholder="150" />
      </div>
      <button
        disabled={!f.desc}
        onClick={() => onAdd({ id: uid(), ...f, actualParts: "", actualLabor: "", status: "pending", addedBy: me, ts: Date.now(), source: "manual" })}
        className="w-full py-2 rounded-lg text-white text-sm font-bold disabled:opacity-40"
        style={{ background: "#0D2440" }}
      >
        Add for approval
      </button>
    </div>
  );
}

function LineRow({ l, me, rate, onActual, onParts, onClock, onSupplement, onEditEst }) {
  const est = (Number(l.estParts) || 0) + (Number(l.estLabor) || 0);
  const [editingEst, setEditingEst] = useState(false);
  const [estVal, setEstVal] = useState("");
  const badge = {
    pending: ["bg-amber-100 text-amber-700", "Pending approval"],
    approved: ["bg-emerald-100 text-emerald-700", `Approved${l.decidedBy ? " · " + l.decidedBy : ""}`],
    declined: ["bg-slate-200 text-slate-500", `Declined${l.decidedBy ? " · " + l.decidedBy : ""}`],
  }[l.status] || ["bg-slate-100 text-slate-500", l.status];

  const myOpen = openLog(l, me);
  const othersOpen = (l.laborLogs || []).filter((g) => !g.end && g.by !== me);
  const logged = lineMs(l);
  const lastEdit = (l.estEdits || [])[Math.max(0, (l.estEdits || []).length - 1)];

  return (
    <div className={`p-3 rounded-lg border ${l.status === "declined" ? "border-slate-200 opacity-60" : "border-slate-200"} bg-white`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-800">{l.desc}</p>
          <p className="text-[11px] text-slate-400">
            {l.source === "inspection" ? "From inspection" : `Added by ${l.addedBy}`}{l.note ? ` — ${l.note}` : ""}
          </p>
        </div>
        <span className={`shrink-0 text-[10px] font-bold px-2 py-1 rounded-md ${badge[0]}`}>{badge[1]}</span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div className="text-slate-500">
          Est: <span className="font-bold text-slate-700">{money(est)}</span>{" "}
          <span className="text-slate-400">({money(l.estParts)} p / {money(l.estLabor)} l)</span>
          {l.status !== "declined" && !editingEst && (
            <button
              onClick={() => { setEstVal(l.estLabor ?? ""); setEditingEst(true); }}
              className="ml-1.5 inline-flex items-center gap-0.5 text-sky-600 font-bold align-middle"
              aria-label="Edit labor estimate"
            >
              <Pencil className="w-3 h-3" />
            </button>
          )}
        </div>
        {l.status === "approved" && !editingEst && (
          <div className="flex items-center gap-1 justify-end">
            <input
              value={l.actualLabor}
              onChange={(e) => onActual(l.id, "actualLabor", e.target.value)}
              placeholder="final labor $"
              inputMode="numeric"
              className="w-24 rounded border border-slate-300 px-1.5 py-1 text-xs"
            />
          </div>
        )}
      </div>

      {editingEst && (
        <div className="mt-2 p-2.5 rounded-lg bg-sky-50 border border-sky-200">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">New labor estimate $</label>
          <div className="mt-1 flex gap-2">
            <input
              value={estVal}
              onChange={(e) => setEstVal(e.target.value)}
              inputMode="numeric"
              autoFocus
              className="flex-1 rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
            />
            <button
              onClick={() => { onEditEst(l.id, estVal); setEditingEst(false); }}
              className="px-3 py-1.5 rounded-lg text-white text-[11px] font-bold"
              style={{ background: "#0D2440" }}
            >
              Save
            </button>
            <button onClick={() => setEditingEst(false)} className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 text-[11px] font-bold">
              Cancel
            </button>
          </div>
          <p className="mt-1 text-[10px] text-slate-500">The change is stamped with your name, date, and time.</p>
        </div>
      )}

      {lastEdit && !editingEst && (
        <p className="mt-1 text-[10px] text-amber-700 font-semibold">
          Labor est. edited by {lastEdit.by} · {new Date(lastEdit.ts).toLocaleDateString()}{" "}
          {new Date(lastEdit.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · {money(lastEdit.from)} → {money(lastEdit.to)}
          {(l.estEdits || []).length > 1 ? ` (${l.estEdits.length} edits total)` : ""}
        </p>
      )}

      {/* parts tracking + labor clock — only on approved work */}
      {l.status === "approved" && (
        <div className="mt-2.5 pt-2.5 border-t border-slate-100">
          {/* parts */}
          {!l.partsStatus || l.partsStatus === "none" ? (
            <button onClick={() => onParts(l.id, "ordered")} className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-600 text-[11px] font-bold">
              Mark parts ordered
            </button>
          ) : (
            <div className={`p-2.5 rounded-lg border ${l.partsStatus === "arrived" ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
              <div className="flex items-center justify-between">
                <span className={`text-[10px] font-bold uppercase tracking-wide ${l.partsStatus === "arrived" ? "text-emerald-700" : "text-amber-700"}`}>
                  {l.partsStatus === "arrived" ? `Parts arrived${l.partsTs ? " · " + new Date(l.partsTs).toLocaleDateString() : ""}` : "Parts on order"}
                </span>
                <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700">
                  <input
                    type="checkbox"
                    checked={l.partsStatus === "arrived"}
                    onChange={(e) => onParts(l.id, e.target.checked ? "arrived" : "ordered")}
                    className="w-4 h-4 accent-emerald-600"
                  />
                  Arrived
                </label>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Final price $</label>
                  <input
                    value={l.partsFinal ?? ""}
                    onChange={(e) => onActual(l.id, "partsFinal", e.target.value)}
                    placeholder={l.estParts ? `est. ${l.estParts}` : "0"}
                    inputMode="numeric"
                    className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Ordered from</label>
                  <input
                    value={l.partsVendor ?? ""}
                    onChange={(e) => onActual(l.id, "partsVendor", e.target.value)}
                    placeholder="AutoZone, O'Reilly…"
                    className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button onClick={() => onSupplement && onSupplement(l)} className="px-2.5 py-1.5 rounded-lg border border-amber-300 text-amber-700 text-[11px] font-bold">
              + Request add'l
            </button>

            <div className="flex-1" />

            {/* labor clock */}
            {logged > 0 && (
              <span className="text-[11px] text-sky-700 font-bold">
                Labor so far: {fmtDur(logged)} · {money((logged / 3600000) * (Number(rate) || DEFAULT_RATE))}
              </span>
            )}
            {othersOpen.map((g) => (
              <span key={g.id} className="text-[10px] font-bold px-2 py-1 rounded-md bg-sky-100 text-sky-700 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" /> {g.by} on it · {fmtDur(Date.now() - g.start)}
              </span>
            ))}
            {myOpen ? (
              <button onClick={() => onClock(l.id)} className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-[11px] font-bold flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> Clock out · {fmtDur(Date.now() - myOpen.start)}
              </button>
            ) : (
              <button onClick={() => onClock(l.id)} className="px-3 py-1.5 rounded-lg text-white text-[11px] font-bold" style={{ background: "#0D2440" }}>
                Clock in
              </button>
            )}
          </div>
        </div>
      )}

      {/* completed labor entries */}
      {(l.laborLogs || []).filter((g) => g.end).length > 0 && (
        <div className="mt-2 space-y-0.5">
          {l.laborLogs.filter((g) => g.end).map((g) => (
            <p key={g.id} className="text-[10px] text-slate-400">
              {g.by} · {fmtDur(g.end - g.start)} · {new Date(g.start).toLocaleDateString()} {new Date(g.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}–{new Date(g.end).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- inspection ---------- */

function Inspection({ data, id, me, onSubmit, onCancel }) {
  const v = (data?.vehicles || []).find((x) => x.id === id);
  const [results, setResults] = useState({});
  const [fails, setFails] = useState({}); // key -> {note, estParts, estLabor}

  if (!v) return null;
  const total = CHECKLIST.reduce((s, c) => s + c.items.length, 0);
  const answered = Object.keys(results).length;

  const setStatus = (key, status) => {
    setResults({ ...results, [key]: { status } });
    if (status === "fail" && !fails[key]) setFails({ ...fails, [key]: { note: "", estParts: "", estLabor: "" } });
  };
  const setFail = (key, field, val) => setFails({ ...fails, [key]: { ...fails[key], [field]: val } });

  const submit = () => {
    const lines = Object.entries(results)
      .filter(([, r]) => r.status === "fail")
      .map(([key]) => {
        const f = fails[key] || {};
        return {
          id: uid(), desc: key.split("||")[1], note: f.note || "",
          estParts: f.estParts || "", estLabor: f.estLabor || "",
          actualParts: "", actualLabor: "",
          status: "pending", addedBy: me, ts: Date.now(), source: "inspection",
        };
      });
    onSubmit(results, lines);
  };

  return (
    <div className="flex-1 p-4 pb-28">
      <BackBar onBack={onCancel} title={`Inspect #${v.stock}`} />
      <p className="text-xs text-slate-500 -mt-2 mb-3">{v.year} {v.make} {v.model} · fails auto-create repair lines for approval</p>

      {CHECKLIST.map((sec) => (
        <div key={sec.section} className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[11px] font-display font-bold uppercase tracking-widest text-slate-400">{sec.section}</span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 shadow-sm">
            {sec.items.map((item) => {
              const key = `${sec.section}||${item}`;
              const st = results[key]?.status;
              return (
                <div key={key} className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-slate-700 flex-1">{item}</span>
                    <div className="flex gap-1">
                      <PFN active={st === "pass"} color="emerald" onClick={() => setStatus(key, "pass")} icon={CheckCircle2} label="Pass" />
                      <PFN active={st === "fail"} color="red" onClick={() => setStatus(key, "fail")} icon={XCircle} label="Fail" />
                      <PFN active={st === "na"} color="slate" onClick={() => setStatus(key, "na")} icon={MinusCircle} label="N/A" />
                    </div>
                  </div>
                  {st === "fail" && (
                    <div className="mt-2 p-2.5 rounded-lg bg-red-50 border border-red-100 space-y-2">
                      <input
                        value={fails[key]?.note || ""}
                        onChange={(e) => setFail(key, "note", e.target.value)}
                        placeholder="What's wrong? (e.g., pads at 2mm, rotor scored)"
                        className="w-full rounded border border-red-200 bg-white px-2 py-1.5 text-xs"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          value={fails[key]?.estParts || ""}
                          onChange={(e) => setFail(key, "estParts", e.target.value)}
                          placeholder="Est. parts $" inputMode="numeric"
                          className="rounded border border-red-200 bg-white px-2 py-1.5 text-xs"
                        />
                        <input
                          value={fails[key]?.estLabor || ""}
                          onChange={(e) => setFail(key, "estLabor", e.target.value)}
                          placeholder="Est. labor $" inputMode="numeric"
                          className="rounded border border-red-200 bg-white px-2 py-1.5 text-xs"
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="fixed bottom-0 left-0 right-0 z-30">
        <div className="max-w-3xl mx-auto p-3 bg-white border-t border-slate-200 flex items-center gap-3">
          <div className="text-xs text-slate-500 flex-1">
            <span className="font-bold text-slate-700">{answered}/{total}</span> checked ·{" "}
            <span className="text-red-600 font-semibold">{Object.values(results).filter((r) => r.status === "fail").length} fails</span>
          </div>
          <button
            disabled={answered === 0}
            onClick={submit}
            className="px-6 py-3 rounded-xl text-white font-display font-bold disabled:opacity-40"
            style={{ background: "#0D2440" }}
          >
            Submit inspection
          </button>
        </div>
      </div>
    </div>
  );
}

function PFN({ active, color, onClick, icon: Icon, label }) {
  const map = {
    emerald: active ? "bg-emerald-500 text-white border-emerald-500" : "text-emerald-600 border-emerald-200",
    red: active ? "bg-red-500 text-white border-red-500" : "text-red-500 border-red-200",
    slate: active ? "bg-slate-500 text-white border-slate-500" : "text-slate-400 border-slate-200",
  };
  return (
    <button onClick={onClick} aria-label={label} className={`w-9 h-9 rounded-lg border flex items-center justify-center ${map[color]}`}>
      <Icon className="w-5 h-5" />
    </button>
  );
}

/* ---------- approvals ---------- */

function Approvals({ data, me, mutate, notify, onOpen }) {
  const items = [];
  (data?.vehicles || []).forEach((v) =>
    (v.lines || []).forEach((l) => { if (l.status === "pending") items.push({ v, l }); })
  );

  const decide = async (vehicleId, lineId, status) => {
    await mutate((d) => {
      const vv = d.vehicles.find((x) => x.id === vehicleId);
      const l = vv?.lines?.find((x) => x.id === lineId);
      if (!l) return d;
      l.status = status;
      l.decidedBy = me;
      l.decidedTs = Date.now();
      notify(d, `${me} ${status} "${l.desc}" on #${vv.stock}`, vehicleId, status === "approved" ? "approved" : "declined");
      return d;
    });
  };

  const totalEst = items.reduce((s, { l }) => s + (Number(l.estParts) || 0) + (Number(l.estLabor) || 0), 0);

  return (
    <div className="flex-1 p-4 pb-10">
      <h2 className="font-display font-bold text-lg text-slate-800 mb-1">Approvals</h2>
      <p className="text-xs text-slate-500 mb-4">{items.length} pending · {money(totalEst)} total estimated</p>

      {items.length === 0 && (
        <div className="p-8 rounded-xl border-2 border-dashed border-slate-300 text-center">
          <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-300 mb-2" />
          <p className="text-slate-500 text-sm">Nothing waiting on you. Queue is clear.</p>
        </div>
      )}

      <div className="space-y-3">
        {items.map(({ v, l }) => (
          <div key={l.id} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <button onClick={() => onOpen(v.id)} className="text-xs font-bold text-sky-600">
              #{v.stock} · {v.year} {v.make} {v.model}
            </button>
            <p className="mt-1 font-semibold text-slate-800 text-sm">{l.desc}</p>
            {l.note && <p className="text-xs text-slate-500 mt-0.5">{l.note}</p>}
            <p className="text-xs text-slate-500 mt-1">
              Est. <span className="font-bold text-slate-700">{money((Number(l.estParts) || 0) + (Number(l.estLabor) || 0))}</span>
              {" "}({money(l.estParts)} parts / {money(l.estLabor)} labor) · by {l.addedBy}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button onClick={() => decide(v.id, l.id, "approved")} className="py-2.5 rounded-lg bg-emerald-500 text-white text-sm font-bold flex items-center justify-center gap-1.5">
                <Check className="w-4 h-4" /> Approve
              </button>
              <button onClick={() => decide(v.id, l.id, "declined")} className="py-2.5 rounded-lg bg-slate-200 text-slate-600 text-sm font-bold flex items-center justify-center gap-1.5">
                <X className="w-4 h-4" /> Decline
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- dashboard ---------- */

function LineStatusBadge({ status }) {
  const map = {
    pending: ["bg-amber-100 text-amber-700", "Pending"],
    approved: ["bg-emerald-100 text-emerald-700", "Approved"],
    declined: ["bg-slate-200 text-slate-500", "Declined"],
  };
  const [cls, label] = map[status] || ["bg-slate-100 text-slate-500", status];
  return <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-md ${cls}`}>{label}</span>;
}

function Dashboard({ data, onOpen }) {
  const vehicles = data?.vehicles || [];
  return (
    <div className="flex-1 p-4 pb-10">
      <h2 className="font-display font-bold text-lg text-slate-800 mb-1">Dashboard</h2>
      <p className="text-xs text-slate-500 mb-4">
        Every checked-in vehicle — inspection report, requested work, and approval status at a glance.
      </p>

      {vehicles.length === 0 && (
        <div className="p-8 rounded-xl border-2 border-dashed border-slate-300 text-center">
          <LayoutGrid className="w-8 h-8 mx-auto text-slate-300 mb-2" />
          <p className="text-slate-500 text-sm">No vehicles checked in yet.</p>
        </div>
      )}

      <div className="space-y-4">
        {vehicles.map((v) => <DashCard key={v.id} v={v} rate={data?.laborRate} onOpen={onOpen} />)}
      </div>
    </div>
  );
}

function DashCard({ v, rate, onOpen }) {
  const stage = STAGES.find((s) => s.id === v.stage);
  const results = v.inspection?.results || null;
  const failedItems = results
    ? Object.entries(results).filter(([, r]) => r.status === "fail").map(([k]) => k.split("||"))
    : [];
  const lines = v.lines || [];

  const pendingLines = lines.filter((l) => l.status === "pending");
  const approvedLines = lines.filter((l) => l.status === "approved");
  const pendingEst = pendingLines.reduce((s, l) => s + (Number(l.estParts) || 0) + (Number(l.estLabor) || 0), 0);
  const approvedCost = approvedLines.reduce((s, l) => s + linePartsCost(l) + lineLabor(l, rate), 0);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* card header */}
      <button onClick={() => onOpen(v.id)} className="w-full text-left px-4 py-3 flex items-center justify-between gap-2" style={{ background: "#0D2440" }}>
        <div>
          <div className="font-display font-bold text-white text-[15px]">{v.year} {v.make} {v.model}</div>
          <div className="text-[11px] text-sky-300">#{v.stock} · {(Number(v.miles) || 0).toLocaleString()} mi · {daysSince(v.addedTs)}d in recon</div>
        </div>
        <span className="shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-full text-white" style={{ background: "#3B8CDE" }}>
          {stage?.label || v.stage}
        </span>
      </button>

      {/* final checks chips */}
      {(v.detailDone || v.emPassed || v.oilDone) && (
        <div className="px-4 py-2 border-b border-slate-100 flex flex-wrap gap-1.5">
          {v.detailDone && (
            <span className="text-[10px] font-bold px-2 py-1 rounded-md bg-emerald-100 text-emerald-700">Detailed ✓ · $150 fee</span>
          )}
          {v.emPassed && (
            <span className="text-[10px] font-bold px-2 py-1 rounded-md bg-emerald-100 text-emerald-700">
              Emissions ✓ · $16.15{v.emDate ? ` · ${new Date(v.emDate + "T12:00").toLocaleDateString()}` : ""}{v.emBy ? ` · ${v.emBy}` : ""}
            </span>
          )}
          {v.oilDone && (
            v.oilSticker ? (
              <span className="text-[10px] font-bold px-2 py-1 rounded-md bg-emerald-100 text-emerald-700">
                Oil ✓ · $79.99{v.oilDate ? ` · ${new Date(v.oilDate + "T12:00").toLocaleDateString()}` : ""} · sticker on{v.oilStickerDate ? ` ${new Date(v.oilStickerDate + "T12:00").toLocaleDateString()}` : ""}
              </span>
            ) : (
              <span className="text-[10px] font-bold px-2 py-1 rounded-md bg-amber-100 text-amber-800">
                Oil ✓ · $79.99{v.oilDate ? ` · ${new Date(v.oilDate + "T12:00").toLocaleDateString()}` : ""} — STICKER NEEDED
              </span>
            )
          )}
        </div>
      )}

      {/* inspection report */}
      <div className="px-4 py-3 border-b border-slate-100">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-display font-bold uppercase tracking-widest text-slate-400">Inspection report</span>
          {v.inspection && (
            <span className="text-[11px] text-slate-400">{v.inspection.by} · {new Date(v.inspection.ts).toLocaleDateString()}</span>
          )}
        </div>
        {!v.inspection ? (
          <p className="text-sm text-slate-400 mt-1.5">Not inspected yet.</p>
        ) : (
          <>
            <InspectionSummary results={results} />
            {failedItems.length > 0 && (
              <div className="mt-2 space-y-1">
                {failedItems.map(([sec, item]) => {
                  const key = `${sec}||${item}`;
                  return (
                    <div key={key} className="flex items-start gap-1.5 text-xs">
                      <XCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
                      <span className="text-slate-600"><span className="text-slate-400">{sec}:</span> {item}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* parts on this vehicle */}
      {(() => {
        const approved = lines.filter((l) => l.status === "approved");
        if (!approved.length) return null;
        const partsCost = (l) =>
          (l.partsFinal !== "" && l.partsFinal != null ? Number(l.partsFinal)
          : l.actualParts !== "" && l.actualParts != null ? Number(l.actualParts)
          : Number(l.estParts)) || 0;
        const groups = [
          { key: "toorder", label: "Needs ordering", cls: "text-red-600", dot: "bg-red-500", items: approved.filter((l) => (!l.partsStatus || l.partsStatus === "none") && partsCost(l) > 0) },
          { key: "ordered", label: "Ordered", cls: "text-amber-600", dot: "bg-amber-400", items: approved.filter((l) => l.partsStatus === "ordered") },
          { key: "arrived", label: "Arrived", cls: "text-emerald-600", dot: "bg-emerald-500", items: approved.filter((l) => l.partsStatus === "arrived") },
        ];
        const grand = groups.reduce((s, g) => s + g.items.reduce((x, l) => x + partsCost(l), 0), 0);
        if (!groups.some((g) => g.items.length)) return null;
        return (
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-display font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5" /> Parts
              </span>
              <span className="text-[11px] font-bold text-slate-600">{money(grand)} total</span>
            </div>
            <div className="mt-2 space-y-2">
              {groups.map((g) => {
                if (!g.items.length) return null;
                const sub = g.items.reduce((s, l) => s + partsCost(l), 0);
                return (
                  <div key={g.key}>
                    <div className={`flex items-center justify-between text-[11px] font-bold ${g.cls}`}>
                      <span className="flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full ${g.dot}`} />{g.label} ({g.items.length})</span>
                      <span>{money(sub)}</span>
                    </div>
                    {g.items.map((l) => (
                      <div key={l.id} className="flex items-center justify-between text-xs text-slate-600 pl-3 py-0.5">
                        <span className="truncate">{l.desc}{l.partsVendor ? <span className="text-slate-400"> · {l.partsVendor}</span> : null}</span>
                        <span className="shrink-0 tabular-nums">
                          {money(partsCost(l))}
                          {l.partsFinal !== "" && l.partsFinal != null && <span className="text-emerald-600"> ✓</span>}
                          {g.key === "arrived" && l.partsTs ? <span className="text-slate-400"> · {new Date(l.partsTs).toLocaleDateString()}</span> : null}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* requested work */}
      <div className="px-4 py-3">
        <span className="text-[11px] font-display font-bold uppercase tracking-widest text-slate-400">Requested work</span>
        {lines.length === 0 ? (
          <p className="text-sm text-slate-400 mt-1.5">No work requested.</p>
        ) : (
          <div className="mt-2 space-y-1.5">
            {lines.map((l) => {
              const parts = linePartsCost(l);
              const labor = lineLabor(l, rate);
              const laborFromClock = (l.actualLabor === "" || l.actualLabor == null) && lineMs(l) > 0;
              const isActual = l.status === "approved" && ((l.partsFinal !== "" && l.partsFinal != null) || (l.actualLabor !== "" && l.actualLabor != null) || laborFromClock);
              return (
                <div key={l.id} className="flex items-center gap-2 text-xs py-1 border-b border-slate-50 last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className={`font-semibold truncate ${l.status === "declined" ? "text-slate-400 line-through" : "text-slate-700"}`}>{l.desc}</p>
                    {l.note && <p className="text-slate-400 truncate">{l.note}</p>}
                  </div>
                  <span className="text-slate-500 shrink-0 tabular-nums">
                    {money(parts)} p + {money(labor)} l{isActual && <span className="text-emerald-600"> ✓</span>}
                  </span>
                  {l.partsStatus === "ordered" && <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">PARTS ORDERED</span>}
                  {l.partsStatus === "arrived" && <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">PARTS IN</span>}
                  {lineMs(l) > 0 && (
                    <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded ${openLog(l) ? "bg-sky-500 text-white" : "bg-sky-100 text-sky-700"}`}>
                      {openLog(l) ? `● ${openLog(l).by} NOW` : fmtDur(lineMs(l))}
                    </span>
                  )}
                  <LineStatusBadge status={l.status} />
                </div>
              );
            })}
          </div>
        )}

        {/* totals */}
        {lines.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-amber-600 font-semibold">Awaiting approval</div>
              <div className="font-display font-bold text-amber-700 text-sm">{pendingEst > 0 ? money(pendingEst) : "—"}{pendingLines.length > 0 && <span className="font-normal text-[11px]"> · {pendingLines.length} line{pendingLines.length > 1 ? "s" : ""}</span>}</div>
            </div>
            <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-emerald-600 font-semibold">Approved work</div>
              <div className="font-display font-bold text-emerald-700 text-sm">{approvedLines.length ? money(approvedCost) : "—"}{approvedLines.length > 0 && <span className="font-normal text-[11px]"> · {approvedLines.length} line{approvedLines.length > 1 ? "s" : ""}</span>}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- finalize recon ---------- */

function FinalizeRecon({ data, id, me, required, mutate, notify, onBack }) {
  const v = (data?.vehicles || []).find((x) => x.id === id);
  const [signName, setSignName] = useState("");
  if (!v) return null;

  const rate = Number(data?.laborRate) || DEFAULT_RATE;
  const lines = (v.lines || []).filter((l) => l.status !== "declined");
  const declined = (v.lines || []).filter((l) => l.status === "declined");

  const laborByTech = (l) => {
    const m = {};
    (l.laborLogs || []).forEach((g) => { m[g.by] = (m[g.by] || 0) + ((g.end || Date.now()) - g.start); });
    return Object.entries(m);
  };

  const partsTotal = lines.reduce((s, l) => s + linePartsCost(l), 0);
  const laborTotal = lines.reduce((s, l) => s + lineLabor(l, rate), 0);
  const laborMsTotal = lines.reduce((s, l) => s + lineMs(l), 0);
  const fees = (v.detailDone ? 150 : 0) + (v.emPassed ? 16.15 : 0) + (v.oilDone ? 79.99 : 0);
  const grand = vehicleCost(v, rate);
  const unfinished = lines.filter((l) => l.status === "pending").length;

  const sign = async () => {
    await mutate((d) => {
      const vv = d.vehicles.find((x) => x.id === id);
      if (!vv) return d;
      vv.finalSign = { by: "Dan", ts: Date.now() };
      vv.stage = "photos";
      notify(d, `Dan signed off final recon check on #${vv.stock} — everything checked, moved to Photos (${money(grand)} total recon)`, id, "approved");
      return d;
    });
  };

  const canSign = me === "Dan" && signName.trim().toLowerCase() === "dan";

  return (
    <div className="flex-1 p-4 pb-10">
      <BackBar onBack={onBack} title={`Finalize #${v.stock}`} />
      <p className="text-xs text-slate-500 -mt-2 mb-3">{v.year} {v.make} {v.model} · {(Number(v.miles) || 0).toLocaleString()} mi</p>

      {required && !v.finalSign && (
        <div className="mb-3 p-3 rounded-xl bg-amber-50 border border-amber-300 text-xs font-bold text-amber-800 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> Dan's sign-off is required before this vehicle can move to Photos.
        </div>
      )}

      {/* line items */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-2.5 text-[11px] font-display font-bold uppercase tracking-widest text-sky-300" style={{ background: "#0D2440" }}>
          Recon work — all line items
        </div>
        <div className="divide-y divide-slate-100">
          {lines.length === 0 && <p className="p-4 text-sm text-slate-400">No repair lines on this vehicle.</p>}
          {lines.map((l) => (
            <div key={l.id} className="p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{l.desc}</p>
                  {l.note && <p className="text-[11px] text-slate-400">{l.note}</p>}
                  {laborByTech(l).length > 0 ? (
                    <p className="text-[11px] text-sky-700 font-semibold mt-0.5">
                      {laborByTech(l).map(([who, ms]) => `${who} ${fmtDur(ms)}`).join(" · ")}
                    </p>
                  ) : (
                    <p className="text-[11px] text-slate-400 mt-0.5">No hours clocked</p>
                  )}
                  {l.status === "pending" && <span className="inline-block mt-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">STILL PENDING APPROVAL</span>}
                </div>
                <div className="text-right shrink-0 text-xs">
                  <div className="text-slate-500">Parts: <span className="font-bold text-slate-700">{money(linePartsCost(l))}</span>{l.partsVendor ? <span className="text-slate-400"> · {l.partsVendor}</span> : null}</div>
                  <div className="text-slate-500">Labor: <span className="font-bold text-slate-700">{money(lineLabor(l, rate))}</span>{lineMs(l) > 0 && <span className="text-slate-400"> · {fmtDur(lineMs(l))}</span>}</div>
                  <div className="font-display font-bold text-slate-800 mt-0.5">{money(linePartsCost(l) + lineLabor(l, rate))}</div>
                </div>
              </div>
            </div>
          ))}

          {/* fees */}
          {v.detailDone && (
            <div className="p-3.5 flex items-center justify-between text-sm">
              <span className="font-semibold text-slate-800">Detail fee <span className="text-[11px] font-normal text-slate-400">· {v.detailBy || "—"}</span></span>
              <span className="font-display font-bold text-slate-800">{money(150)}</span>
            </div>
          )}
          {v.emPassed && (
            <div className="p-3.5 flex items-center justify-between text-sm">
              <span className="font-semibold text-slate-800">Emissions fee <span className="text-[11px] font-normal text-slate-400">· passed {v.emDate ? new Date(v.emDate + "T12:00").toLocaleDateString() : ""}{v.emBy ? ` · ${v.emBy}` : ""}</span></span>
              <span className="font-display font-bold text-slate-800">{money(16.15)}</span>
            </div>
          )}
          {v.oilDone && (
            <div className="p-3.5 flex items-center justify-between text-sm">
              <span className="font-semibold text-slate-800">Oil change <span className="text-[11px] font-normal text-slate-400">· {v.oilDate ? new Date(v.oilDate + "T12:00").toLocaleDateString() : "—"}{v.oilSticker ? " · sticker on" : " · STICKER NEEDED"}</span></span>
              <span className="font-display font-bold text-slate-800">{money(79.99)}</span>
            </div>
          )}
        </div>

        {/* totals */}
        <div className="p-4 border-t-2 border-slate-200 bg-slate-50 space-y-1 text-sm">
          <div className="flex justify-between text-slate-600"><span>Parts total</span><span className="font-bold">{money(partsTotal)}</span></div>
          <div className="flex justify-between text-slate-600"><span>Labor total{laborMsTotal > 0 ? ` (${fmtDur(laborMsTotal)} clocked)` : ""}</span><span className="font-bold">{money(laborTotal)}</span></div>
          {fees > 0 && <div className="flex justify-between text-slate-600"><span>Fees (detail / emissions / oil)</span><span className="font-bold">{money(fees)}</span></div>}
          <div className="flex justify-between pt-2 mt-1 border-t border-slate-300 font-display font-bold text-slate-900 text-base">
            <span>Total recon</span><span>{money(grand)}</span>
          </div>
          {v.buyPrice && (
            <div className="flex justify-between text-slate-500 text-xs"><span>+ Purchase {money(v.buyPrice)}</span><span className="font-bold">Total in: {money((Number(v.buyPrice) || 0) + grand)}</span></div>
          )}
        </div>
      </div>

      {declined.length > 0 && (
        <p className="mt-2 text-[11px] text-slate-400">{declined.length} declined line{declined.length > 1 ? "s" : ""} not included: {declined.map((l) => l.desc).join(", ")}</p>
      )}

      {/* sign-off */}
      <div className="mt-4 bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
        <h3 className="font-display font-bold text-slate-800">Master Tech sign-off</h3>
        {v.finalSign ? (
          <div className="mt-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
            <p className="text-sm font-bold text-emerald-800 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" /> Signed by Dan
            </p>
            <p className="text-xs text-emerald-700 mt-0.5">
              Everything checked — ready for pictures. {new Date(v.finalSign.ts).toLocaleDateString()} {new Date(v.finalSign.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </p>
          </div>
        ) : (
          <>
            <p className="mt-1 text-xs text-slate-500">
              Dan must sign that all repair work has been checked and the vehicle is ready to take pictures. Signing moves it to Photos.
            </p>
            {unfinished > 0 && (
              <p className="mt-2 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                {unfinished} line{unfinished > 1 ? "s are" : " is"} still pending approval — make sure that's intentional before signing.
              </p>
            )}
            {me === "Dan" ? (
              <div className="mt-3">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Type your name to sign</label>
                <input
                  value={signName}
                  onChange={(e) => setSignName(e.target.value)}
                  placeholder="Dan"
                  className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 text-sm"
                />
                <button
                  disabled={!canSign}
                  onClick={sign}
                  className="mt-3 w-full py-3 rounded-xl text-white font-display font-bold disabled:opacity-40"
                  style={{ background: "#10B981" }}
                >
                  Sign — everything checked, ready for pictures
                </button>
              </div>
            ) : (
              <p className="mt-3 text-sm font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
                You're signed in as {me}. Only Dan (Master Tech) can sign this — hand him the phone and have him tap his name at the top right.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- labor hours report ---------- */

const PERIODS = [
  { id: "today", label: "Today", from: () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); } },
  { id: "week", label: "Last 7 days", from: () => Date.now() - 7 * 86400000 },
  { id: "month", label: "Last 30 days", from: () => Date.now() - 30 * 86400000 },
  { id: "all", label: "All time", from: () => 0 },
];

function LaborReport({ data, onOpen }) {
  const [period, setPeriod] = useState("week");
  const [vehicleF, setVehicleF] = useState("all");
  const [techF, setTechF] = useState("all");

  // live tick so open clocks count up
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const rate = Number(data?.laborRate) || DEFAULT_RATE;
  const vehicles = data?.vehicles || [];
  const from = PERIODS.find((p) => p.id === period).from();

  // flatten every labor log entry across the lot
  const entries = [];
  vehicles.forEach((v) =>
    (v.lines || []).forEach((l) =>
      (l.laborLogs || []).forEach((g) => {
        entries.push({ v, l, g, ms: (g.end || Date.now()) - g.start, live: !g.end });
      })
    )
  );

  const filtered = entries
    .filter((e) => e.g.start >= from)
    .filter((e) => vehicleF === "all" || e.v.id === vehicleF)
    .filter((e) => techF === "all" || e.g.by === techF)
    .sort((a, b) => b.g.start - a.g.start);

  const totalMs = filtered.reduce((s, e) => s + e.ms, 0);
  const byTech = {};
  filtered.forEach((e) => { byTech[e.g.by] = (byTech[e.g.by] || 0) + e.ms; });

  const sel = "rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs font-semibold text-slate-700";

  return (
    <div className="flex-1 p-4 pb-10">
      <h2 className="font-display font-bold text-lg text-slate-800 mb-1">Labor hours</h2>
      <p className="text-xs text-slate-500 mb-3">Every clocked entry across the lot, billed at {money(rate)}/hr.</p>

      {/* filters */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <select value={period} onChange={(e) => setPeriod(e.target.value)} className={sel} aria-label="Time period">
          {PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <select value={vehicleF} onChange={(e) => setVehicleF(e.target.value)} className={sel} aria-label="Vehicle">
          <option value="all">All vehicles</option>
          {vehicles.map((v) => <option key={v.id} value={v.id}>#{v.stock} {v.make} {v.model}</option>)}
        </select>
        <select value={techF} onChange={(e) => setTechF(e.target.value)} className={sel} aria-label="Technician">
          <option value="all">All techs</option>
          {TEAM.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      {/* summary */}
      <div className="rounded-xl p-4 text-white mb-3" style={{ background: "#0D2440" }}>
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-sky-400 font-bold">Total labor</div>
            <div className="font-display font-extrabold text-2xl">{fmtDur(totalMs)}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-widest text-sky-400 font-bold">Billed value</div>
            <div className="font-display font-extrabold text-2xl">{money((totalMs / 3600000) * rate)}</div>
          </div>
        </div>
        {Object.keys(byTech).length > 0 && (
          <div className="mt-3 pt-3 border-t border-sky-900 flex flex-wrap gap-2">
            {Object.entries(byTech).sort((a, b) => b[1] - a[1]).map(([who, ms]) => (
              <span key={who} className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: "rgba(59,140,222,0.25)" }}>
                {who}: {fmtDur(ms)} · {money((ms / 3600000) * rate)}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* entries */}
      {filtered.length === 0 && (
        <div className="p-8 rounded-xl border-2 border-dashed border-slate-300 text-center">
          <Clock className="w-8 h-8 mx-auto text-slate-300 mb-2" />
          <p className="text-slate-500 text-sm">No labor logged for these filters.</p>
        </div>
      )}

      <div className="space-y-2">
        {filtered.map((e) => (
          <button
            key={e.g.id}
            onClick={() => onOpen(e.v.id)}
            className={`w-full text-left p-3 rounded-xl border bg-white ${e.live ? "border-sky-300" : "border-slate-200"}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">
                  {e.g.by} · <span className="text-slate-500 font-normal">{e.l.desc}</span>
                </p>
                <p className="text-[11px] text-slate-400">
                  #{e.v.stock} {e.v.year} {e.v.make} {e.v.model} · {new Date(e.g.start).toLocaleDateString()} {new Date(e.g.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  {e.g.end ? `–${new Date(e.g.end).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}
                </p>
              </div>
              <div className="text-right shrink-0">
                {e.live ? (
                  <span className="text-[10px] font-bold px-2 py-1 rounded-md bg-sky-500 text-white flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> NOW · {fmtDur(e.ms)}
                  </span>
                ) : (
                  <>
                    <div className="text-sm font-bold text-slate-700">{fmtDur(e.ms)}</div>
                    <div className="text-[11px] text-slate-400">{money((e.ms / 3600000) * rate)}</div>
                  </>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- schedule ---------- */

const SCHED_TECHS = ["Dan", "Mark", "Kansas"];
const DAY_START = 7; // 7am
const DAY_END = 15; // 3pm
const TECH_CAPS = { Dan: 4, Mark: 8, Kansas: 8 }; // daily labor hour caps

const dateKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const fmtHour = (h) => {
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = h > 12 ? h - 12 : h;
  return `${hh} ${ampm}`;
};
// estimated labor $ ÷ shop rate = hours to block out (min 1, whole hours)
const jobHours = (l, rate) => Math.min(8, Math.max(1, Math.round((Number(l.estLabor) || 0) / (Number(rate) || DEFAULT_RATE)) || 1));

function SchedulePage({ data, me, mutate, notify, onOpen }) {
  const [day, setDay] = useState(dateKey(new Date()));
  const [picked, setPicked] = useState(null); // job selected to place: {vId, lineId}
  const [msg, setMsg] = useState(null);

  const rate = Number(data?.laborRate) || DEFAULT_RATE;
  const vehicles = data?.vehicles || [];

  // all approved jobs across the lot
  const jobs = [];
  vehicles.forEach((v) => (v.lines || []).forEach((l) => { if (l.status === "approved") jobs.push({ v, l }); }));
  const unscheduled = jobs.filter(({ l }) => !l.sched);
  const todays = jobs.filter(({ l }) => l.sched && l.sched.date === day);

  const shiftDay = (n) => {
    const d = new Date(day + "T12:00");
    d.setDate(d.getDate() + n);
    setDay(dateKey(d));
    setMsg(null);
  };
  const dayLabel = new Date(day + "T12:00").toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });

  const occupied = (tech) => {
    const set = new Set();
    todays.forEach(({ l }) => {
      if (l.sched.tech !== tech) return;
      for (let h = l.sched.start; h < l.sched.start + l.sched.hours; h++) set.add(h);
    });
    return set;
  };
  const jobAt = (tech, hour) => todays.find(({ l }) => l.sched.tech === tech && hour >= l.sched.start && hour < l.sched.start + l.sched.hours);

  const place = async (tech, start) => {
    if (!picked) return;
    const job = jobs.find(({ v, l }) => v.id === picked.vId && l.id === picked.lineId);
    if (!job) { setPicked(null); return; }
    const hrs = jobHours(job.l, rate);
    if (start + hrs > DAY_END) {
      setMsg(`"${job.l.desc}" needs ${hrs}h — it won't fit starting at ${fmtHour(start)} (day ends 3 PM).`);
      return;
    }
    const occ = occupied(tech);
    for (let h = start; h < start + hrs; h++) {
      if (occ.has(h)) { setMsg(`${tech} already has a job during that time.`); return; }
    }
    await mutate((d) => {
      const vv = d.vehicles.find((x) => x.id === picked.vId);
      const l = vv?.lines?.find((x) => x.id === picked.lineId);
      if (!l) return d;
      l.sched = { tech, date: day, start, hours: hrs };
      notify(d, `${me} scheduled "${l.desc}" (#${vv.stock}) for ${tech} — ${dayLabel}, ${fmtHour(start)}–${fmtHour(start + hrs)}`, vv.id, "stage");
      return d;
    });
    setPicked(null);
    setMsg(null);
  };

  const unschedule = async (vId, lineId) => {
    await mutate((d) => {
      const vv = d.vehicles.find((x) => x.id === vId);
      const l = vv?.lines?.find((x) => x.id === lineId);
      if (!l || !l.sched) return d;
      notify(d, `${me} removed "${l.desc}" (#${vv.stock}) from ${l.sched.tech}'s schedule`, vv.id, "info");
      delete l.sched;
      return d;
    });
  };

  const hours = [];
  for (let h = DAY_START; h < DAY_END; h++) hours.push(h);

  return (
    <div className="flex-1 p-4 pb-10">
      <h2 className="font-display font-bold text-lg text-slate-800 mb-1">Schedule</h2>
      <p className="text-xs text-slate-500 mb-3">Tap a job below, then tap an open slot. Jobs block out their estimated hours (est. labor ÷ {money(rate)}/hr).</p>

      {/* day nav */}
      <div className="flex items-center justify-between mb-3 rounded-xl px-3 py-2.5 text-white" style={{ background: "#0D2440" }}>
        <button onClick={() => shiftDay(-1)} className="p-1.5" aria-label="Previous day"><ChevronLeft className="w-5 h-5" /></button>
        <div className="text-center">
          <div className="font-display font-bold text-sm">{dayLabel}</div>
          {day !== dateKey(new Date()) && (
            <button onClick={() => { setDay(dateKey(new Date())); setMsg(null); }} className="text-[10px] text-sky-300 font-bold underline">Back to today</button>
          )}
        </div>
        <button onClick={() => shiftDay(1)} className="p-1.5" aria-label="Next day"><ChevronRight className="w-5 h-5" /></button>
      </div>

      {msg && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-300 text-xs font-bold text-amber-800 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> <span className="flex-1">{msg}</span>
          <button onClick={() => setMsg(null)} className="underline">ok</button>
        </div>
      )}

      {/* jobs waiting to be scheduled */}
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[11px] font-display font-bold uppercase tracking-widest text-slate-400">To schedule ({unscheduled.length})</span>
          <div className="flex-1 h-px bg-slate-200" />
        </div>
        {unscheduled.length === 0 ? (
          <p className="text-xs text-slate-400">Every approved job is on the calendar.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {unscheduled.map(({ v, l }) => {
              const sel = picked && picked.lineId === l.id;
              return (
                <button
                  key={l.id}
                  onClick={() => { setPicked(sel ? null : { vId: v.id, lineId: l.id }); setMsg(null); }}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border text-left ${
                    sel ? "text-white border-transparent" : "bg-white border-slate-300 text-slate-700"
                  }`}
                  style={sel ? { background: "#3B8CDE" } : undefined}
                >
                  #{v.stock} · {l.desc} · {jobHours(l, rate)}h
                </button>
              );
            })}
          </div>
        )}
        {picked && <p className="mt-1.5 text-[11px] font-bold text-sky-700">Now tap an open slot on the calendar to place it — or tap the job again to cancel.</p>}
      </div>

      {/* calendar grid */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {/* column headers with daily cap tallies */}
        <div className="grid" style={{ gridTemplateColumns: "52px repeat(3, 1fr)" }}>
          <div className="border-b border-slate-200" />
          {SCHED_TECHS.map((t) => {
            const total = todays.filter(({ l }) => l.sched.tech === t).reduce((s, { l }) => s + l.sched.hours, 0);
            const cap = TECH_CAPS[t];
            const over = total > cap;
            return (
              <div key={t} className="border-b border-l border-slate-200 px-2 py-2 text-center">
                <div className="font-display font-bold text-sm text-slate-800">{t}</div>
                <div className={`text-[10px] font-bold ${over ? "text-red-600" : "text-slate-400"}`}>
                  {total}h / {cap}h{over ? " — OVER CAP" : ""}
                </div>
              </div>
            );
          })}
        </div>

        {hours.map((h) => (
          <div key={h} className="grid" style={{ gridTemplateColumns: "52px repeat(3, 1fr)" }}>
            <div className="px-1.5 py-3 text-[10px] font-bold text-slate-400 text-right border-b border-slate-100">{fmtHour(h)}</div>
            {SCHED_TECHS.map((t) => {
              const job = jobAt(t, h);
              if (job) {
                const isStart = job.l.sched.start === h;
                return (
                  <div key={t} className="border-b border-l border-slate-100 px-1 py-0.5" style={{ background: "rgba(59,140,222,0.10)" }}>
                    {isStart && (
                      <div className="rounded-md px-1.5 py-1 text-white" style={{ background: "#0D2440" }}>
                        <button onClick={() => onOpen(job.v.id)} className="block w-full text-left text-[10px] font-bold leading-tight truncate">
                          #{job.v.stock} {job.l.desc}
                        </button>
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] text-sky-300">{job.l.sched.hours}h · {money(jobHours(job.l, rate) * rate)} est</span>
                          <button onClick={() => unschedule(job.v.id, job.l.id)} className="text-[9px] font-bold text-red-300 underline">remove</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              }
              return (
                <button
                  key={t}
                  onClick={() => picked && place(t, h)}
                  className={`border-b border-l border-slate-100 min-h-[44px] ${picked ? "hover:bg-sky-50 active:bg-sky-100" : ""}`}
                  aria-label={`${t} ${fmtHour(h)} open`}
                >
                  {picked && <span className="text-[10px] text-sky-300 font-bold">+</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-slate-400">Shop hours 7 AM – 3 PM · daily caps: Dan 4h (Master Tech), Mark 8h, Kansas 8h. Tap a scheduled job's name to open the vehicle, or "remove" to put it back in the to-schedule list.</p>
    </div>
  );
}

/* ---------- notifications ---------- */

function NotifDot({ type }) {
  const map = {
    stage: ["#3B8CDE", ArrowRight],
    approval: ["#F59E0B", Flag],
    approved: ["#10B981", Check],
    declined: ["#94A3B8", X],
    info: ["#64748B", Bell],
  };
  const [color, Icon] = map[type] || map.info;
  return (
    <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: color + "22" }}>
      <Icon className="w-3.5 h-3.5" style={{ color }} />
    </div>
  );
}

function Notifications({ data, lastRead, onSeen, onOpen }) {
  useEffect(() => { onSeen(); }, []); // mark read when opened
  const list = data?.notifications || [];
  return (
    <div className="flex-1 p-4 pb-10">
      <h2 className="font-display font-bold text-lg text-slate-800 mb-3">Notifications</h2>
      {list.length === 0 && <p className="text-sm text-slate-400">Nothing yet. Activity across the lot shows up here.</p>}
      <div className="space-y-1">
        {list.map((n) => (
          <button
            key={n.id}
            onClick={() => n.vehicleId && onOpen(n.vehicleId)}
            className={`w-full text-left flex gap-2.5 p-3 rounded-xl ${n.ts > lastRead ? "bg-sky-50" : "bg-white"} border border-slate-100`}
          >
            <NotifDot type={n.type} />
            <div className="flex-1">
              <p className="text-sm text-slate-700 leading-snug">{n.text}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">{timeAgo(n.ts)}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
