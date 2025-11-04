import React, { useState } from "react";

/**
 * Error-Handling Builder — v2
 * - Per-line drop targets that transform code
 * - Inline editing for thrown exception names and catch bodies
 * - Next button advances once at least one action is applied on a stage
 */

const ACTIONS = [
  { id: "throw", label: "Throw Exception", desc: "Signal failure upward (editable name)" },
  { id: "catch", label: "Catch Exception", desc: "Handle/translate locally" },
  { id: "opt",   label: "Return Optional.of(...)", desc: "Return a value; absence handled by caller" },
];

// Stages with starter snippets.
// Lines are strings; transforms rewrite these strings in-place.
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
    // Guidance will still recommend both, but progress is allowed after first action.
    recommended: ["catch", "throw"],
    hint:
      "Catch locally to decide skip/retry; throw (translated) so the boundary can act (DLQ/retry).",
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
    recommended: ["opt", "throw"],
    hint:
      "Use Optional for normal 'not found'; throw on DB/driver errors to signal failure.",
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
    recommended: ["catch", "throw"],
    hint:
      "Let exceptions bubble; catch at @ControllerAdvice and map to 404/409/500.",
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
    recommended: ["catch"],
    hint:
      "Use a skip policy / per-record catch; only throw on critical corruption.",
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
    recommended: ["catch", "throw"],
    hint:
      "Don’t return null on outage; retry then throw UpstreamUnavailableException.",
  },
];

function ActionPill({ action }) {
  return (
    <div
      className="px-3 py-2 rounded-2xl border shadow-sm cursor-grab active:cursor-grabbing text-sm"
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", action.id)}
      title={action.desc}
    >
      {action.label}
    </div>
  );
}

function CodeLine({ text, idx, onDropAction }) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={
        "font-mono text-sm leading-6 whitespace-pre flex items-start rounded " +
        (over ? "bg-gray-100" : "")
      }
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData("text/plain");
        setOver(false);
        onDropAction(id, idx);
      }}
    >
      <span className="select-none opacity-50 w-8 text-right pr-3">{idx + 1}</span>
      {/* We allow inline editing inside generated placeholders via contenteditable */}
      <span dangerouslySetInnerHTML={{ __html: text }} />
    </div>
  );
}

// --- Transform helpers -------------------------------------------------------
// We embed simple placeholders with contenteditable spans so the user can edit names/bodies.

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function applyThrow(lines, lineIdx) {
  // Insert a throw statement after the chosen line if it's a block start or statement;
  // if the line itself is a return/null line, replace it.
  const line = lines[lineIdx];

  // If line looks like a return null; replace with throw.
  if (/return\s+null;?/.test(line)) {
    lines[lineIdx] = line.replace(
      /return\s+null;?/,
      'throw new <span contenteditable="true" class="ce">UpstreamUnavailableException</span>();'
    );
    return;
  }

  // Otherwise, add a new throw line following the current line (indented if needed)
  const indent = (line.match(/^\s*/) || [""])[0] + "    ";
  lines.splice(
    lineIdx + 1,
    0,
    `${indent}throw new <span contenteditable="true" class="ce">CustomDomainException</span>();`
  );
}

function applyCatch(lines, lineIdx) {
  // Wrap the target line in a try/catch block.
  const orig = lines[lineIdx];
  const indent = (orig.match(/^\s*/) || [""])[0];
  const innerIndent = indent + "    ";

  const wrapped = [
    `${indent}try {`,
    `${innerIndent}${esc(orig.trim())}`,
    `${indent}} catch (<span contenteditable="true" class="ce">Exception</span> e) {`,
    `${innerIndent}// <span contenteditable="true" class="ce">decide: skip/retry/DLQ/translate</span>`,
    `${indent}}`,
  ];

  // Replace the single line with 5 lines
  lines.splice(lineIdx, 1, ...wrapped);
}

function applyOptionalOf(lines, lineIdx) {
  // If the line already returns something, convert to Optional.of(...)
  // Else, insert a sample return Optional.of(...)
  const line = lines[lineIdx];

  if (/return\s+Optional\.empty\(\)/.test(line)) {
    // leave empty as-is; teaching moment is to separate absence vs error
    // but user asked to transform — convert a *value* return elsewhere ideally.
  }

  if (/return\s+.+;/.test(line) && !/Optional\./.test(line)) {
    lines[lineIdx] = line.replace(
      /return\s+(.+);/,
      'return Optional.of($1);'
    );
    return;
  }

  const indent = (line.match(/^\s*/) || [""])[0] + "    ";
  lines.splice(
    lineIdx + 1,
    0,
    `${indent}return Optional.of(<span contenteditable="true" class="ce">value</span>);`
  );
}

// Score: recommend patterns via hint; allow progress once at least one action applied.
function canAdvance(appliedCount) {
  return appliedCount > 0;
}

// --- Main --------------------------------------------------------------------
export default function App() {
  const [stageIdx, setStageIdx] = useState(0);
  const [linesByStage, setLinesByStage] = useState(() =>
    Object.fromEntries(STAGES.map((s) => [s.key, [...s.snippet]]))
  );
  const [appliedCounts, setAppliedCounts] = useState({}); // stageKey -> number
  const [log, setLog] = useState([]);

  const stage = STAGES[stageIdx];
  const lines = linesByStage[stage.key];

  const applyActionAt = (actionId, idx) => {
    const nextLines = { ...linesByStage, [stage.key]: [...lines] };
    const working = nextLines[stage.key];

    if (actionId === "throw") applyThrow(working, idx);
    else if (actionId === "catch") applyCatch(working, idx);
    else if (actionId === "opt") applyOptionalOf(working, idx);

    setLinesByStage(nextLines);

    const count = (appliedCounts[stage.key] || 0) + 1;
    setAppliedCounts({ ...appliedCounts, [stage.key]: count });

    setLog((l) => [...l, `Applied ${actionId} to line ${idx + 1} in ${stage.title}`]);
  };

  const next = () => {
    const count = appliedCounts[stage.key] || 0;
    if (!canAdvance(count)) {
      setLog((l) => [...l, `Hint for ${stage.title}: ${stage.hint}`]);
      return;
    }
    if (stageIdx < STAGES.length - 1) {
      setStageIdx(stageIdx + 1);
    } else {
      setLog((l) => [
        ...l,
        "🎉 Reached the end. Open the 'Best Practice Outcome' in the README or compare with your code changes.",
      ]);
    }
  };

  const resetStage = () => {
    setLinesByStage({
      ...linesByStage,
      [stage.key]: [...STAGES[stageIdx].snippet],
    });
    setAppliedCounts({ ...appliedCounts, [stage.key]: 0 });
    setLog((l) => [...l, `Reset ${stage.title}`]);
  };

  const resetAll = () => {
    setStageIdx(0);
    setLinesByStage(Object.fromEntries(STAGES.map((s) => [s.key, [...s.snippet]])));
    setAppliedCounts({});
    setLog([]);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Error-Handling Builder — Interactive</h1>
        <div className="flex items-center gap-3">
          <button className="px-3 py-2 rounded-xl border shadow-sm" onClick={resetAll}>
            Restart
          </button>
        </div>
      </header>

      {/* Actions */}
      <section>
        <h2 className="text-lg font-semibold mb-2">Actions</h2>
        <div className="flex flex-wrap gap-3">
          {ACTIONS.map((a) => (
            <ActionPill key={a.id} action={a} />
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Drag an action directly onto a specific line. Dropping will transform that line (you can edit placeholders inline).
        </p>
      </section>

      {/* Stage */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">{stage.title}</h3>
            <span className="text-xs px-2 py-1 rounded-full bg-gray-100 border">
              {stageIdx + 1} / {STAGES.length}
            </span>
          </div>
          <p className="text-sm text-gray-700">Goal: {stage.goal}</p>
          <div className="rounded-2xl border p-4 bg-white shadow-sm">
            {lines.map((line, i) => (
              <CodeLine key={i} text={line} idx={i} onDropAction={applyActionAt} />
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border bg-white p-3">
            <h4 className="font-semibold mb-2 text-sm">Stage tools</h4>
            <div className="flex gap-3">
              <button className="px-3 py-2 rounded-xl border shadow-sm" onClick={next}>
                Next
              </button>
              <button
                className="px-3 py-2 rounded-xl border shadow-sm"
                onClick={resetStage}
                title="Reset this stage's code to original"
              >
                Reset this stage
              </button>
            </div>
            <div className="text-xs text-gray-600 mt-3">
              Recommended here: {stage.recommended.join(" + ")} (not required to advance).
            </div>
          </div>

          <div className="rounded-xl border bg-white p-3">
            <h4 className="font-semibold mb-2 text-sm">Tips</h4>
            <ul className="text-sm list-disc ml-5 space-y-1">
              <li>Click in highlighted parts to edit exception names or comments.</li>
              <li>Drop multiple actions on different lines to build up a solution.</li>
              <li>Use “Reset this stage” to try another approach.</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Feedback */}
      <section>
        <h3 className="text-lg font-semibold mb-2">Feedback</h3>
        <div className="rounded-2xl border bg-white p-3 max-h-48 overflow-auto text-sm space-y-1">
          {log.length === 0 && <div className="text-gray-500">Your feedback will appear here.</div>}
          {log.map((line, i) => (
            <div key={i}>• {line}</div>
          ))}
        </div>
      </section>

      <footer className="pt-4 text-xs text-gray-500">
        Built for rapid practice: drop actions on lines, edit inline, hit Next to advance.
      </footer>
    </div>
  );
}
