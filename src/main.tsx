import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
// Registers the published @wokwi/elements custom elements (wokwi-led,
// wokwi-pushbutton) for the whole app. Kept out of individual views so
// Vitest/jsdom never has to execute the web-component library — the tags it
// defines are only used at runtime in a real browser.
import "@wokwi/elements";
// Registers the vendored, modified stepper element (app-stepper-motor) — the
// package's stepper exposes only 4 cosmetic bipolar pins, so we vendor+modify
// the source (see docs/DECISIONS.md). Kept out of individual views so Vitest/
// jsdom never executes the web-component code.
import "./vendor/wokwi/stepper-motor-element";
// Registers the vendored, modified PIR element (app-pir-motion-sensor) — the
// package's PIR is a purely static SVG with no state properties, so we
// vendor+modify the source to reflect detected motion as a dome glow (see
// docs/DECISIONS.md). Kept out of individual views for the same jsdom reason.
import "./vendor/wokwi/pir-motion-sensor-element";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
