import React, { useState } from "react";

const ACTIONS = [
  { id: "throw", label: "Throw Exception", desc: "Signal failure upward (choose generic or custom)" },
  { id: "catch", label: "Catch Exception", desc: "Handle or translate at the right boundary" },
  { id: "opt",   label: "Return Optional.of(...)", desc: "Return a value when present; absence handled by caller" },
];

const STAGES = [
  {
    key: "kafka-loop",
    title: "Stage 1 — Streaming loop",
    goal: "Process many messages; transient upstream failure should not crash the whole consumer.",
    snippet: [
      "for (Record record : stream) {",
      "    processMessage(record); // may call networkCall()",
      "}",
    ],
    expectedKeys: ["catch", "throw"],
    hint: "Catch locally to decide skip/retry; throw (translated) so the boundary can act (DLQ/retry).",
  },
  {
    key: "repo-optional",
    title: "Stage 2 — Repository lookup",
    goal: "Find user by email. Absence is normal. DB failures are exceptional.",
    snippet: [
      "public Optional<User> findByEmail(String email) {",
      "    // query DB...",
      "    return Optional.empty(); // sometimes; distinguish from DB failure",
      "}",
    ],
    expectedKeys: ["opt", "throw"],
    hint: "Use Optional for normal 'not found'; throw on DB/driver errors to signal failure.",
  },
  {
    key: "controller-boundary",
    title: "Stage 3 — HTTP boundary",
    goal: "Translate domain exceptions to proper HTTP status codes.",
    snippet: [
      '@GetMapping("/orders/{id}")',
      "public ResponseEntity<?> get(@PathVariable String id) {",
      "    return ResponseEntity.ok(service.fetch(id));",
      "}",
    ],
    expectedKeys: ["catch", "throw"],
    hint: "Let exceptions bubble; catch at @ControllerAdvice and map to 404/409/500.",
  },
  {
    key: "batch-skip",
    title: "Stage 4 — Batch job (1M rows)",
    goal: "Skip bad records (ParseException) and continue; fail fast on corruption.",
    snippet: [
      "for (String line : lines) {",
      "    Transaction t = parse(line);",
      "    writer.write(t);",
      "}",
    ],
    expectedKeys: ["catch"],
    hint: "Use a skip policy / per-record catch; only throw on critical corruption.",
  },
  {
    key: "upstream-503",
    title: "Stage 5 — Upstream 503",
    goal: "Treat 503 as data; retry/backoff; signal failure upward if exhausted.",
    snippet: [
      'Response r = http.get("/partner");',
      "if (r.status() == 200) return r.body();",
      "return null; // currently hiding errors",
      "",
    ],
    expectedKeys: ["catch", "throw"],
    hint: "Don’t return null on outage; retry then throw UpstreamUnavailableException.",
  },
];

function CodeLine({ text, idx }) {
  return (
    <div className="font-mono text-sm leading-6 whitespace-pre flex">
      <span className="select-none opacity-50 w-8 text-right pr-3">{idx + 1}</span>
      <span>{text}</span>
    </div>
  );
}

function ActionPill({ action, draggable = true }) {
  return (
    <div
      className="px-3 py-2 rounded-2xl border shadow-sm cursor-grab active:cursor-grabbing text-sm"
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", action.id);
      }}
      title={action.desc}
    >
      {action.label}
    </div>
  );
}

function DropZone({ onDropAction, label = "Drop action here" }) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={
        "border-2 border-dashed rounded-xl p-4 text-sm text-center " +
        (over ? "bg-gray-100" : "bg-white")
      }
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData("text/plain");
        setOver(false);
        onDropAction(id);
      }}
    >
      {label}
    </div>
  );
}

export default function App() {
  const [stageIdx, setStageIdx] = useState(0);
  const [applied, setApplied] = useState({});
  const [log, setLog] = useState([]);
  const [customException, setCustomException] = useState("UpstreamUnavailableException");
  const [showBest, setShowBest] = useState(false);

  const stage = STAGES[stageIdx];

  const applyAction = (actionId) => {
    const chosen = actionId === "throw" && customException ? `throw:${customException}` : actionId;
    const next = { ...(applied[stage.key] || {}), [Date.now()]: chosen };
    setApplied({ ...applied, [stage.key]: next });
    setLog((l) => [...l, `Applied ${actionId === "throw" ? `Throw(${customException})` : actionId} to ${stage.title}` ]);
  };

  const scoreStage = (s) => {
    const used = Object.values(applied[s.key] || {});
    const has = (id) => used.some((u) => u === id || (typeof u === "string" && u.startsWith(`${id}:`)));
    const needed = s.expectedKeys;
    const ok = needed.every((k) => has(k));
    const extras = used.filter((u) => !needed.some((k) => u === k || (typeof u === "string" && u.startsWith(`${k}:`)))).length;
    return { ok, used: used.length, extras };
  };

  const goNext = () => {
    const result = scoreStage(stage);
    if (!result.ok) {
      setLog((l) => [...l, `Hint for ${stage.title}: ${stage.hint}` ]);
      return;
    }
    if (stageIdx < STAGES.length - 1) setStageIdx(stageIdx + 1);
    else setShowBest(true);
  };

  const reset = () => {
    setStageIdx(0);
    setApplied({});
    setLog([]);
    setShowBest(false);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Error-Handling Builder — Interactive</h1>
        <div className="flex items-center gap-3">
          <input
            className="border rounded-lg px-3 py-2 text-sm"
            value={customException}
            onChange={(e) => setCustomException(e.target.value)}
            placeholder="Custom exception name"
            title="Custom exception name used when you drop Throw"
          />
          <button className="px-3 py-2 rounded-xl border shadow-sm" onClick={reset}>Restart</button>
        </div>
      </header>

      <section>
        <h2 className="text-lg font-semibold mb-2">Actions</h2>
        <div className="flex flex-wrap gap-3">
          {ACTIONS.map((a) => (<ActionPill key={a.id} action={a} />))}
        </div>
        <p className="text-xs text-gray-500 mt-2">Drag an action onto the stage dropzone below. You can use multiple actions per stage.</p>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">{stage.title}</h3>
            <span className="text-xs px-2 py-1 rounded-full bg-gray-100 border">{stageIdx + 1} / {STAGES.length}</span>
          </div>
          <p className="text-sm text-gray-700">Goal: {stage.goal}</p>
          <div className="rounded-2xl border p-4 bg-white shadow-sm">
            {stage.snippet.map((line, i) => (<CodeLine key={i} text={line} idx={i} />))}
          </div>
        </div>
        <div className="space-y-3">
          <DropZone onDropAction={applyAction} />
          <div className="rounded-xl border bg-white p-3">
            <h4 className="font-semibold mb-2 text-sm">Applied actions</h4>
            <ul className="text-sm list-disc ml-5 space-y-1">
              {Object.values(applied[stage.key] || {}).length === 0 && (<li className="text-gray-500">None yet</li>)}
              {Object.values(applied[stage.key] || {}).map((a, i) => (
                <li key={i}>{(typeof a === "string" && a.startsWith("throw:")) ? a.replace("throw:", "Throw(") + ")" : a}</li>
              ))}
            </ul>
          </div>
          <div className="flex gap-3">
            <button className="px-3 py-2 rounded-xl border shadow-sm" onClick={goNext}>Next</button>
            <button className="px-3 py-2 rounded-xl border shadow-sm" onClick={() => setLog((l) => [...l, `Hint: ${stage.hint}`])}>Need a hint</button>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-2">Feedback</h3>
        <div className="rounded-2xl border bg-white p-3 max-h-48 overflow-auto text-sm space-y-1">
          {log.length === 0 && <div className="text-gray-500">Your feedback will appear here.</div>}
          {log.map((line, i) => (<div key={i}>• {line}</div>))}
        </div>
      </section>

      {showBest && (
        <section className="space-y-3">
          <h2 className="text-xl font-bold">Best Practice Outcome</h2>
          <p className="text-sm text-gray-700">
            Here’s a consolidated example combining the patterns you practiced: let exceptions signal failure, catch at boundaries,
            use Optional for normal absence, and skip/retry appropriately.
          </p>
          <div className="rounded-2xl border p-4 bg-white shadow-sm">
            <pre className="text-xs leading-5 whitespace-pre-wrap">{`
// Service layer
public Order place(OrderRequest req) {
  try {
    if (!inventory.reserve(req)) throw new OutOfStockException();
    Response r = http.get("/partner");
    if (r.status() == 503) throw new UpstreamUnavailableException();
    return mapper.map(r.body());
  } catch (DriverException e) {
    throw new DatabaseAccessException(e);
  }
}

// Repository layer — absence is normal
public Optional<User> findByEmail(String email) {
  try {
    User u = jdbc.query(...);
    return Optional.ofNullable(u);
  } catch (SQLException e) {
    throw new DatabaseAccessException(e);
  }
}

// Batch — skip bad records
for (String line : lines) {
  try {
    Transaction t = parse(line); // may throw ParseException
    writer.write(t);
  } catch (ParseException e) {
    metrics.counter("csv.bad_line").increment();
    continue; // skip
  }
}

// HTTP boundary — translate exceptions
@RestControllerAdvice
class GlobalHandler {
  @ExceptionHandler(OutOfStockException.class)
  ResponseEntity<?> outOfStock() {
    return ResponseEntity.status(409).body("Out of stock");
  }
  @ExceptionHandler(UpstreamUnavailableException.class)
  ResponseEntity<?> upstream() {
    return ResponseEntity.status(503).body("Upstream unavailable");
  }
  @ExceptionHandler(DatabaseAccessException.class)
  ResponseEntity<?> db() {
    return ResponseEntity.status(500).body("Database error");
  }
}
            `}</pre>
          </div>
          <div className="text-sm text-gray-600">
            Tip: In Spring Batch/Kafka, prefer declarative retry/skip/DLQ configs over manual try/catch per record.
          </div>
        </section>
      )}

      <footer className="pt-4 text-xs text-gray-500">
        Built for rapid practice: drag actions per stage, hit Next, and reveal the reference solution. Extend STAGES[] to add more.
      </footer>
    </div>
  );
}