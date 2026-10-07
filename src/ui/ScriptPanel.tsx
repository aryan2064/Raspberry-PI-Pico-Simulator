import { useState } from "react";

export interface OutputEntry {
  kind: "stdout" | "error";
  text: string;
}

interface ScriptPanelProps {
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

export function ScriptPanel({ onRun, onStop }: ScriptPanelProps) {
  const [code, setCode] = useState(DEFAULT_CODE);

  return (
    <section className="pane code-pane" aria-label="MicroPython editor">
      <header className="pane-header">
        <span className="pane-title">main.py</span>
        <div className="pane-actions">
          <button type="button" className="btn btn-run" onClick={() => onRun(code)}>
            Run
          </button>
          <button type="button" className="btn btn-stop" onClick={onStop}>
            Stop
          </button>
        </div>
      </header>
      <textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        spellCheck={false}
        aria-label="MicroPython code"
        className="code-editor"
      />
    </section>
  );
}