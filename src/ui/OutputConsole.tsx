import type { OutputEntry } from "./ScriptPanel";

// Serial / stdout console docked beneath the diagram (Wokwi-style). Purely
// presentational: App owns the output entries (collected from worker stdout /
// error messages); this panel just renders them.
export function OutputConsole({ output }: { output: OutputEntry[] }) {
  return (
    <section className="console" aria-label="Serial output">
      <header className="console-header">Serial output</header>
      <pre data-testid="output" className="console-body">
        {output.length === 0
          ? "—"
          : output.map((o, i) => (
              <div
                key={i}
                className={o.kind === "error" ? "console-line console-line-error" : "console-line"}
              >
                {o.text}
              </div>
            ))}
      </pre>
    </section>
  );
}