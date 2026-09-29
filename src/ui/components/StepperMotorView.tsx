import type { PinOffsetMap } from "../types";

// Hand-drawn ULN2003 + 28BYJ-48 module art. The classic setup reads as a blue
// driver board with a round green stepper on one side and a 6-way control
// header (IN1..IN4, VCC, GND) on the other — generic module visual language,
// not a copy of any specific vendor photo (see docs/DECISIONS.md for why
// neither @wokwi/elements nor the fritzing-parts library had a suitable
// part). Pin offsets sit on the control-header pad centers, exactly where the
// hookup wires land.
export const STEPPER_W = 180;
export const STEPPER_H = 110;
export const stepperPinOffsets: PinOffsetMap = {
  in1: { x: 180, y: 22 },
  in2: { x: 180, y: 37 },
  in3: { x: 180, y: 52 },
  in4: { x: 180, y: 67 },
  vcc: { x: 180, y: 82 },
  gnd: { x: 180, y: 97 },
};

// Motor centre on the body; the rotation marker spins around it.
const MOTOR_CX = 54;
const MOTOR_CY = 55;

interface StepperArtProps {
  angleDegrees: number;
}

// Pure SVG body art, exported for reuse by the palette preview. `angleDegrees`
// only rotates the internal shaft-orientation marker — the housing never
// moves, so the visual reads as the motor SHOULD spin.
export function StepperArt({ angleDegrees }: StepperArtProps) {
  return (
    <svg
      width={STEPPER_W}
      height={STEPPER_H}
      viewBox={`0 0 ${STEPPER_W} ${STEPPER_H}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* ---- motor (left) ---- */}
      {/* rear cap peeking out */}
      <circle cx={MOTOR_CX + 2} cy={MOTOR_CY + 2} r={30} fill="#2f6b3d" />
      {/* green housing */}
      <circle cx={MOTOR_CX} cy={MOTOR_CY} r={30} fill="#4c9d5a" stroke="#2f6b3d" strokeWidth={2} />
      {/* front flange ring */}
      <circle cx={MOTOR_CX} cy={MOTOR_CY} r={24} fill="#3f8a4c" stroke="#2f6b3d" strokeWidth={1.5} />
      <circle cx={MOTOR_CX} cy={MOTOR_CY} r={19.5} fill="none" stroke="#6fbd7e" strokeWidth={1} />
      {/* four flange bolt dots */}
      {[45, 135, 225, 315].map((deg) => (
        <circle
          key={deg}
          cx={MOTOR_CX + 21 * Math.cos((deg * Math.PI) / 180)}
          cy={MOTOR_CY + 21 * Math.sin((deg * Math.PI) / 180)}
          r={1.6}
          fill="#2f6b3d"
        />
      ))}

      {/* rotating shaft-orientation marker: a spoke that sweeps with
          angleDegrees so a running sequence is visibly a spinning shaft */}
      <g transform={`rotate(${angleDegrees} ${MOTOR_CX} ${MOTOR_CY})`}>
        <line
          x1={MOTOR_CX}
          y1={MOTOR_CY}
          x2={MOTOR_CX + 17}
          y2={MOTOR_CY}
          stroke="#e8f5e4"
          strokeWidth={3}
          strokeLinecap="round"
        />
        {/* arrow tip so CW vs CCW is readable */}
        <path
          d={`M ${MOTOR_CX + 17} ${MOTOR_CY - 4.5} L ${MOTOR_CX + 23} ${MOTOR_CY} L ${MOTOR_CX + 17} ${MOTOR_CY + 4.5} Z`}
          fill="#e8f5e4"
        />
      </g>
      {/* stationary shaft hub over the marker */}
      <circle cx={MOTOR_CX} cy={MOTOR_CY} r={7} fill="#3a3a3a" stroke="#1f1f1f" strokeWidth={1} />
      <circle cx={MOTOR_CX} cy={MOTOR_CY} r={3.2} fill="#1c1c1c" />

      {/* wire bundle: motor coils -> driver board */}
      {[
        { y0: 42, y1: 34, c: "#d81b1b" },
        { y0: 49, y1: 49, c: "#ff9800" },
        { y0: 56, y1: 63, c: "#fdd835" },
        { y0: 63, y1: 76, c: "#1f8aff" },
        { y0: 70, y1: 90, c: "#009688" },
      ].map((w) => (
        <path
          key={w.y0}
          d={`M 84 ${w.y0} C 96 ${w.y0} 94 ${w.y1} 108 ${w.y1}`}
          fill="none"
          stroke={w.c}
          strokeWidth={2.2}
          strokeLinecap="round"
        />
      ))}

      {/* ---- driver board (right) ---- */}
      <rect x={108} y={10} width={72} height={92} rx={4} fill="#1668b0" stroke="#0c4a82" />
      <rect x={124} y={40} width={40} height={34} rx={2} fill="#1f1f1f" stroke="#000" />
      {/* IC legs */}
      {[46, 53, 60, 67, 74].map((y) => (
        <g key={y}>
          <line x1={124} y1={y} x2={118} y2={y} stroke="#9aa" strokeWidth={1.6} strokeLinecap="round" />
          <line x1={164} y1={y} x2={170} y2={y} stroke="#9aa" strokeWidth={1.6} strokeLinecap="round" />
          <line x1={118} y1={y} x2={118} y2={y + 2} stroke="#9aa" strokeWidth={1.6} strokeLinecap="round" />
          <line x1={170} y1={y} x2={170} y2={y + 2} stroke="#9aa" strokeWidth={1.6} strokeLinecap="round" />
        </g>
      ))}
      {/* board label */}
      <text
        x={144}
        y={28}
        textAnchor="middle"
        fontSize={11}
        fontWeight={700}
        fill="#fff"
        style={{ fontFamily: "inherit" }}
      >
        ULN2003
      </text>
      {/* 6-way control header on the right edge */}
      <rect x={166} y={12} width={14} height={88} rx={2} fill="#0c4a82" stroke="#092f5e" />
      {[22, 37, 52, 67, 82, 97].map((y) => (
        <circle key={y} cx={176} cy={y} r={3} fill="#e8e8e8" stroke="#7a7a7a" />
      ))}
      {/* terminal labels */}
      <text x={160} y={25} textAnchor="end" fontSize={6.5} fill="#eaf4ff" style={{ fontFamily: "inherit" }}>
        in1
      </text>
      <text x={160} y={40} textAnchor="end" fontSize={6.5} fill="#eaf4ff" style={{ fontFamily: "inherit" }}>
        in2
      </text>
      <text x={160} y={55} textAnchor="end" fontSize={6.5} fill="#eaf4ff" style={{ fontFamily: "inherit" }}>
        in3
      </text>
      <text x={160} y={70} textAnchor="end" fontSize={6.5} fill="#eaf4ff" style={{ fontFamily: "inherit" }}>
        in4
      </text>
      <text x={160} y={85} textAnchor="end" fontSize={6.5} fill="#ffdcdc" style={{ fontFamily: "inherit" }}>
        vcc
      </text>
      <text x={160} y={100} textAnchor="end" fontSize={6.5} fill="#d9d9d9" style={{ fontFamily: "inherit" }}>
        gnd
      </text>
    </svg>
  );
}

interface StepperViewProps {
  renderInfo: {
    type: "stepper";
    angleDegrees: number;
    direction: "CW" | "CCW" | "none";
    stepsPerSecond: number;
  };
  // UI-only selection highlight, driven by CircuitCanvas's selected state.
  selected?: boolean;
}

// Static view apart from the rotating shaft marker. The worker is the single
// source of truth for angle/direction/rate; the view mirrors them as data
// attributes (for the browser verification + tests) and as the marker's
// rotation.
export function StepperView({ renderInfo, selected }: StepperViewProps) {
  const { angleDegrees, direction, stepsPerSecond } = renderInfo;
  return (
    <div
      data-testid="stepper"
      data-selected={selected ? "true" : "false"}
      style={{
        outline: selected ? "3px solid #ffd500" : "none",
        outlineOffset: 2,
      }}
    >
      <div
        data-testid="stepper-body"
        data-angle={angleDegrees}
        data-direction={direction}
        data-steps-per-second={stepsPerSecond}
      >
        <StepperArt angleDegrees={angleDegrees} />
      </div>
    </div>
  );
}