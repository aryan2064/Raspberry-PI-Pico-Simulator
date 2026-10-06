// Vendored + modified from @wokwi/elements 1.9.2
// `src/potentiometer-element.ts` (MIT; original SVG from
// https://freesvg.org/potentiometer). Deliberate vendoring exception — real,
// confirmed blocker: the package element's own mousedown handler calls
// stopPropagation()/preventDefault(), owns its drag + hidden range input, and
// demands circular-screen-CTM rotation; the engine (not the element) is the
// source of truth for the knob position, and any such handler would steal
// canvas-level clicks/drags (see docs/DECISIONS.md, "Potentiometer"). TODO:
// add Wokwi MIT attribution before any public release/sharing.
//
// Modifications vs upstream:
//  - lit's @property()/@customElement decorators stripped (the same
//    useDefineForClassFields:true incompatibility as
//    stepper-motor-element.ts): `knobPosition` is a plain reactive property
//    (static `properties` map + constructor default + `declare`), registered
//    explicitly under our own tag 'app-potentiometer'.
//  - ALL interaction machinery removed (down/move/up/rotateHandler/
//    updateKnobMatrix/focusInput/onValueChange + the hidden <input>). The
//    knob is 100% presentational now: the React PotentiometerView owns the
//    drag via an overlay and drives `knobPosition` (0..1). The element simply
//    maps knobPosition -> knob rotation angle.
//  - the knob angle math collapsed to knobDeg = (end-start) * clamp01(knobPosition) + start
//    where startDegree=-135 / endDegree=135 are the upstream constants.
//  - pinInfo unchanged: GND/SIG/VCC at (29, 68.5) / (39, 68.5) / (49, 68.5);
//    that is also the pin exact-placement surface the canvas uses.
import { css, html, LitElement } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import type { ElementPin } from './pin';
import { analog, GND, VCC } from './pin';

const knobCenter = {
  x: 9.91,
  y: 8.18,
};

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

const START_DEGREE = -135;
const END_DEGREE = 135;

export class PotentiometerElement extends LitElement {
  static properties = {
    knobPosition: { type: Number },
  };

  // 0..1 tap position; the single source of truth is the engine's
  // Potentiometer component — this mirrors it for rendering only.
  declare knobPosition: number;

  get pinInfo(): ElementPin[] {
    return [
      { name: 'GND', x: 29, y: 68.5, number: 1, signals: [GND()] },
      { name: 'SIG', x: 39, y: 68.5, number: 2, signals: [analog(0)] },
      { name: 'VCC', x: 49, y: 68.5, number: 3, signals: [VCC()] },
    ];
  }

  constructor() {
    super();
    this.knobPosition = 0;
  }

  static get styles() {
    return css`
      #rotating {
        transform-origin: 10px 8px;
        transform: rotate(var(--knob-angle, 0deg));
      }

      svg text {
        font-size: 1px;
        line-height: 1.25;
        letter-spacing: 0px;
        word-spacing: 0px;
        fill: #ffffff;
      }
    `;
  }

  render() {
    const percent = clamp01(this.knobPosition);
    const knobDeg = (END_DEGREE - START_DEGREE) * percent + START_DEGREE;
    return html`
      <svg
        role="slider"
        aria-valuemin="0"
        aria-valuemax="1"
        aria-valuenow="${percent}"
        width="20mm"
        height="20mm"
        version="1.1"
        viewBox="0 0 20 20"
        xmlns="http://www.w3.org/2000/svg"
        style=${styleMap({ '--knob-angle': knobDeg + 'deg' })}
      >
        <defs>
          <filter id="outline">
            <feDropShadow id="glow" dx="0" dy="0" stdDeviation="0.5" flood-color="cyan" />
          </filter>
        </defs>
        <rect
          x=".15"
          y=".15"
          width="19.5"
          height="19.5"
          ry="1.23"
          fill="#045881"
          stroke="#045881"
          stroke-width=".30"
        />
        <rect x="5.4" y=".70" width="9.1" height="1.9" fill="#ccdae3" stroke-width=".15" />
        <ellipse
          id="knob"
          cx=${knobCenter.x}
          cy=${knobCenter.y}
          rx="7.27"
          ry="7.43"
          fill="#e4e8eb"
          stroke-width=".15"
        />
        <rect x="6" y="17" width="8" height="2" fill-opacity="0" stroke="#fff" stroke-width=".30" />
        <g stroke-width=".15">
          <text x="6.21" y="16.6">GND</text>
          <text x="9.2" y="16.63">SIG</text>
          <text x="11.5" y="16.59">VCC</text>
        </g>
        <g fill="#fff" stroke-width=".15">
          <ellipse cx="1.68" cy="1.81" rx=".99" ry=".96" />
          <ellipse cx="1.48" cy="18.37" rx=".99" ry=".96" />
          <ellipse cx="17.97" cy="18.47" rx=".99" ry=".96" />
          <ellipse cx="18.07" cy="1.91" rx=".99" ry=".96" />
        </g>
        <g fill="#b3b1b0" stroke-width=".15">
          <ellipse cx="7.68" cy="18" rx=".61" ry=".63" />
          <ellipse cx="10.22" cy="18" rx=".61" ry=".63" />
          <ellipse cx="12.76" cy="18" rx=".61" ry=".63" />
        </g>
        <ellipse cx="9.95" cy="8.06" rx="6.60" ry="6.58" fill="#c3c2c3" stroke-width=".15" />
        <rect
          id="rotating"
          x="10"
          y="2"
          width=".42"
          height="3.1"
          stroke-width=".15"
        />
      </svg>
    `;
  }
}

customElements.define('app-potentiometer', PotentiometerElement);

// Expose the JSX tag to React, mirroring the package's react-types.ts pattern
// (same as the other vendored elements).
import type React from 'react';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'app-potentiometer': Partial<PotentiometerElement> &
        React.ClassAttributes<PotentiometerElement>;
    }
  }
}