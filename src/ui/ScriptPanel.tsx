import { useState } from "react";

export interface OutputEntry {
  kind: "stdout" | "error";
  text: string;
}

interface ScriptPanelProps {
  output: OutputEntry[];
  onRun: (code: string) => void;
  onStop: () => void;
}

const DEFAULT_CODE = `# Blink the second LED, wired from GPIO16 to its anode.
# (machine.Pin is the only shimmed module for now. time.sleep is
# non-blocking where the browser supports JSPI stack switching — the sim
# keeps ticking mid-sleep — and a busy-wait fallback otherwise.)
import machine
import time

led = machine.Pin(16, machine.Pin.OUT)
for _ in range(5):
    led.value(1)
    time.sleep(0.5)
    led.value(0)
    time.sleep(0.5)
led.value(1)

# Note: don't drive an OUT pin that is wired into the same net as the
# green button's signal pin (GPIO15) — two OUT drivers on one net resolve
# to FLOATING, and the LED will stay dark. GPIO15 is pinned to the
# interactive demo instead; try GPIO16 (or a free pin, and wire the LED to
# it) for python-driven output.
`;

export function ScriptPanel({ output, onRun, onStop }: ScriptPanelProps) {
  const [code, setCode] = useState(DEFAULT_CODE);

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <h2 style={{ margin: 0 }}>MicroPython</h2>
      <textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        spellCheck={false}
        aria-label="MicroPython code"
        style={{
          width: "100%",
          height: 170,
          fontFamily: "monospace",
          fontSize: 12,
          boxSizing: "border-box",
        }}
      />
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button onClick={() => onRun(code)}>Run</button>
        <button onClick={onStop}>Stop</button>
      </div>
      <h3 style={{ margin: 0 }}>Output</h3>
      <pre
        data-testid="output"
        style={{
          width: "100%",
          minHeight: 120,
          maxHeight: 240,
          overflow: "auto",
          margin: 0,
          padding: "0.5rem",
          background: "#111",
          fontFamily: "monospace",
          fontSize: 12,
          whiteSpace: "pre-wrap",
          boxSizing: "border-box",
        }}
      >
        {output.length === 0
          ? "—"
          : output.map((o, i) => (
              <div
                key={i}
                style={{ color: o.kind === "error" ? "#ff6b6b" : "#d7ffd9" }}
              >
                {o.text}
              </div>
            ))}
      </pre>
    </section>
  );
}