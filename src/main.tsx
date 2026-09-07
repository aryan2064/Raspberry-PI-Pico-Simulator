import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
// Registers the published @wokwi/elements custom elements (wokwi-led,
// wokwi-pushbutton) for the whole app. Kept out of individual views so
// Vitest/jsdom never has to execute the web-component library — the tags it
// defines are only used at runtime in a real browser.
import "@wokwi/elements";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
