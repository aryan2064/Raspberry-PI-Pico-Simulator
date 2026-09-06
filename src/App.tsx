import { useState } from "react";
import { Button, Circuit, LED, PicoBoard } from "./engine";
import { CircuitCanvas } from "./ui/CircuitCanvas";
import "./index.css";

function createDemoCircuit(): Circuit {
  const circuit = new Circuit();
  const board = new PicoBoard();
  const led = new LED();
  const button = new Button();
  circuit.addComponent(board);
  circuit.addComponent(led);
  circuit.addComponent(button);

  // Demo: button -> GPIO15 -> LED anode; LED cathode -> GND.
  // Pressing the button drives the LED through one shared net.
  circuit.connect(button.pin("signal"), board.pin("GPIO15"));
  circuit.connect(board.pin("GPIO15"), led.pin("anode"));
  circuit.connect(led.pin("cathode"), board.pin("GND"));
  // A GPIO pin only listens once set to IN (mirrors the machine.Pin shim).
  board.pin("GPIO15").mode = "IN";
  circuit.resolveNets();

  return circuit;
}

function App() {
  const [circuit] = useState(createDemoCircuit);

  return (
    <main style={{ maxWidth: 1240, margin: "0 auto", padding: "1rem" }}>
      <h1>Pico Sim</h1>
      <p>
        Click a pin to start a wire, then click a pin on another component to
        connect (same pin twice cancels). Click a wire to remove it. Press and
        hold the green button to drive the LED.
      </p>
      <CircuitCanvas circuit={circuit} />
    </main>
  );
}

export default App;