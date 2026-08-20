import {Sim} from "./sim.ts";


// The canvases from our html: G on the left, V on the right
const canvas = document.querySelector<HTMLCanvasElement>("#sim")!;
const ctx = canvas.getContext("2d")!;

const potCanvas = document.querySelector<HTMLCanvasElement>("#pot")!;
const potCtx = potCanvas.getContext("2d")!;



// render step. map a scalar field to colors and write them into a canvas.
// scale takes the field to [0,1]; stops are the ramp, walked end to end, so
// three of them put a transition colour at the halfway point.
function render(
  field: Float32Array,
  img: ImageData,
  scale: number,
  stops: number[][],
  noise: Float32Array | null = null,
  offset = 0,
) {
  const segments = stops.length - 1;

  for (let p = 0; p < field.length; p++) {
    let v = (field[p] - offset) * scale;
    v = v < 0 ? 0 : v > 1 ? 1 : v;

    // which segment of the ramp, and how far along it
    const t = v * segments;
    const k = Math.min(segments - 1, Math.floor(t));
    const f = t - k;
    const from = stops[k];
    const to = stops[k + 1];

    const n = noise ? noise[p] : 0;

    // Uint8ClampedArray clamps, so the offset needs no bounds check
    img.data[p * 4 + 0] = from[0] + (to[0] - from[0]) * f + n;
    img.data[p * 4 + 1] = from[1] + (to[1] - from[1]) * f + n;
    img.data[p * 4 + 2] = from[2] + (to[2] - from[2]) * f + n;
    img.data[p * 4 + 3] = 255;
  }
}


// A brightness offset per sell so the ground has more texture
// two octabe, a course and smooth noise
function buildNoise(N: number): Float32Array {
  const COARSE = 8;
  const M = Math.ceil(N / COARSE) + 1;

  const low = new Float32Array(M * M);
  for (let p = 0; p < low.length; p++) low[p] = Math.random() * 2 - 1;

  const out = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const jy = j / COARSE, j0 = Math.floor(jy), fy = jy - j0;

    for (let i = 0; i < N; i++) {
      const ix = i / COARSE, i0 = Math.floor(ix), fx = ix - i0;

      // bilinear blend of the coarse lattice
      const a = low[j0 * M + i0], b = low[j0 * M + i0 + 1];
      const c = low[(j0 + 1) * M + i0], d = low[(j0 + 1) * M + i0 + 1];
      const patch = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;

      out[j * N + i] = patch * NOISE_COARSE + (Math.random() * 2 - 1) * NOISE_FINE;
    }
  }

  return out;
}


// paint a single pixel at a continuous position, if it lands on the grid.
function mark(img: ImageData, N: number, h: number, x: number, y: number, rgb: number[]) {
  const i = Math.floor(x / h);
  const j = Math.floor(y / h);
  if (i < 0 || i >= N || j < 0 || j >= N) return;

  const q = (j * N + i) * 4;
  img.data[q + 0] = rgb[0];
  img.data[q + 1] = rgb[1];
  img.data[q + 2] = rgb[2];
  img.data[q + 3] = 255;
}


// building first, then walkers over them.
function markWalkers(sim: Sim, img: ImageData) {
  const half = (BUILDING_CELLS - 1) / 2;

  for (const gate of sim.gates) {
    for (let dj = -half; dj <= half; dj++) {
      for (let di = -half; di <= half; di++) {
        // dark outline around buildings
        const edge = Math.abs(di) === half || Math.abs(dj) === half;
        mark(img, sim.N, sim.h,
          gate.pos[0] + di * sim.h,
          gate.pos[1] + dj * sim.h,
          edge ? WALL : ROOF);
      }
    }
  }

  // Each walker keeps one shade for its whole life
  //  picked by index, so it doesnt flicker between frames.
  sim.walkers.forEach((walker, k) => {
    mark(img, sim.N, sim.h, walker.pos[0], walker.pos[1], HAIR[k % HAIR.length]);
  });
}



// the diagnostic potential map
function markGates(sim: Sim, img: ImageData) {
  const half = (GATE_DOT_CELLS - 1) / 2;

  for (const gate of sim.gates) {
    for (let dj = -half; dj <= half; dj++) {
      for (let di = -half; di <= half; di++) {
        // round off the corners so it reads as a dot rather than a square
        if (di * di + dj * dj > half * half + 1) continue;

        mark(img, sim.N, sim.h,
          gate.pos[0] + di * sim.h,
          gate.pos[1] + dj * sim.h,
          GATE_DOT);
      }
    }
  }
}

// colors!
const NOISE_COARSE = 5; // patchiness, in colour units out of 255
const NOISE_FINE = 2; // per-cell grain

// odd count, so G = 0 lands on the middle stop
const GROUND = [
  [ 20,  54, 122],
  [ 52, 112, 146],
  [ 74, 124,  58],
  [134, 106,  74],
  [148, 143, 134],
];

// centred on V = 0. ponds/bushes? push walkers away. trails pull them in
const POTENTIAL = [
  [ 60, 120, 210],   // negative V, repulsive
  [  0,   0,   0],   // nneutral
  [255, 255, 255],   // positive V, attractive
];

// the little heads of people
const HAIR = [
  [ 38,  26,  18], 
  [ 74,  48,  30], 
  [101,  67,  33], 
  [128,  86,  44],
  [150, 105,  60], 
  [176, 133,  84], 
  [ 92,  52,  32],
];

const GATE_DOT = [230, 40, 40];
const GATE_DOT_CELLS = 5; // odd, so the gate sits on the centre cell
const ROOF = [128, 128, 128];
const WALL = [ 82,  82,  82];
const BUILDING_CELLS = 5; // odd, so the gate sits on the centre cell, W symmetry


function main(){

  //create sim
  const simulation = new Sim();

  canvas.width = simulation.N;
  canvas.height = simulation.N;
  const img = ctx.createImageData(simulation.N, simulation.N);
  const noise = buildNoise(simulation.N);

  //for the potential map
  potCanvas.width = simulation.N;
  potCanvas.height = simulation.N;
  const potImg = potCtx.createImageData(simulation.N, simulation.N);

  // sim loop. Each frame runs a fixed number of steps then paints once
  //returning between frames lets the browser repaint
  let stepsPerFrame = 1;
  const speed = document.querySelector<HTMLInputElement>("#speed")!;
  const speedOut = document.querySelector<HTMLSpanElement>("#speedOut")!;

  const edit = { tool: "none", thickness: 1.5, sharpness: 2, strength: 0.02 };
  const tools = document.querySelector<HTMLDivElement>("#tools")!;
  const brush = document.querySelector<HTMLDivElement>("#brush")!;

  const thickness = document.querySelector<HTMLInputElement>("#thickness")!;
  const thicknessOut = document.querySelector<HTMLSpanElement>("#thicknessOut")!;

  const sharpness = document.querySelector<HTMLInputElement>("#sharpness")!;
  const sharpnessOut = document.querySelector<HTMLSpanElement>("#sharpnessOut")!;

  const strength = document.querySelector<HTMLInputElement>("#strength")!;
  const strengthOut = document.querySelector<HTMLSpanElement>("#strengthOut")!;

  speed.addEventListener("input", () => {
    stepsPerFrame = Number(speed.value);
    speedOut.textContent = `x${speed.value}`
  });

  tools.addEventListener("click", (e)=>{
    const button = (e.target as HTMLElement).closest("button");
    if (!button) return;
    edit.tool = button.dataset.tool!;
    for (const b of tools.querySelectorAll("button")){
      b.setAttribute("aria-pressed", String(b===button));
    }
    brush.hidden = !edit.tool.startsWith("brush");
  });

  thickness.addEventListener("input", () => {
    edit.thickness = Number(thickness.value);
    thicknessOut.textContent = thickness.value;
  });

  sharpness.addEventListener("input", () => {
    edit.sharpness = Number(sharpness.value);
    sharpnessOut.textContent = sharpness.value
  });

  strength.addEventListener("input", () => {
    edit.strength = Number(strength.value);
    strengthOut.textContent = strength.value;
  });

  // determien where on the ground a click landed
  //getboundingclientrect psans the border box so the border has to come off
  function domainPoint(e: PointerEvent): [number, number] {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - canvas.clientLeft) / canvas.clientWidth;
    const y = (e.clientY - rect.top - canvas.clientTop) / canvas.clientHeight;
    return [x * simulation.L, y * simulation.L];
  }

  // nearest gate to a point, but only if it is close enough to count as a hit
  function gateAt(x: number, y: number) {
    const reach = 5 * simulation.h;   // a little wider than the drawn building
    let best = null;
    let bestDist = reach;

    for (const gate of simulation.gates) {
      const d = Math.hypot(gate.pos[0] - x, gate.pos[1] - y);
      if (d < bestDist) { bestDist = d; best = gate; }
    }
    return best;
  }

  // Radial falloff written into G0, the terrain, not G. sharpness is the
  // exponent: 1 is a cone, high values approach a flat disc with a hard edge.
  // G is pulled along so the change shows immediately rather than waiting for
  // regeneration to drag it down.
  function paintG0(x: number, y: number, sign: number) {
    const { N, h, G, G0, Gmax } = simulation;
    const R = edit.thickness;

    // only the cells the brush can actually reach
    const i0 = Math.max(0, Math.floor((x - R) / h));
    const i1 = Math.min(N - 1, Math.ceil((x + R) / h));
    const j0 = Math.max(0, Math.floor((y - R) / h));
    const j1 = Math.min(N - 1, Math.ceil((y + R) / h));

    for (let j = j0; j <= j1; j++) {
      const cy = (j + 0.5) * h;          // cell centres, same convention as the splat

      for (let i = i0; i <= i1; i++) {
        const cx = (i + 0.5) * h;
        const r = Math.hypot(cx - x, cy - y);
        if (r > R) continue;

        const w = Math.pow(1 - r / R, edit.sharpness);
        const p = j * N + i;

        const step = edit.strength * w;
        const cur = G0[p];

        // sign 0 erases: move toward plain grass without crossing it
        const next = sign === 0
          ? (cur > 0 ? Math.max(0, cur - step) : Math.min(0, cur + step))
          : cur + sign * step;

        // deep enough to repel, but not so deep that |grad V| passes 1 and
        // walkers stall against it instead of going around
        G0[p] = next < -Gmax ? -Gmax : next > Gmax ? Gmax : next;

        if (G[p] < G0[p]) G[p] = G0[p];
        if (G0[p] < G[p] && sign < 0) G[p] = G0[p];
      }
    }
  }

  // pointermove only fires every 8-16ms, so a fast drag skips a long way
  // between samples. Stamping along the segment turns those gaps into a stroke.
  function stroke(x0: number, y0: number, x1: number, y1: number, sign: number) {
    const spacing = Math.max(edit.thickness * 0.25, simulation.h);
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / spacing));

    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      paintG0(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, sign);
    }
  }

  // +1 raises G0, -1 lowers it, 0 erases back toward grass
  const brushSign = () =>
    edit.tool === "brush-add" ? 1 : edit.tool === "brush-sub" ? -1 : 0;

  let painting = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener("pointerdown", (e) => {
    const [x, y] = domainPoint(e);

    if (edit.tool === "gate-add") {
      simulation.addGate(x, y);
    } else if (edit.tool === "gate-remove") {
      const gate = gateAt(x, y);
      if (gate) simulation.removeGate(gate);
    } else if (edit.tool.startsWith("brush")) {
      painting = true;
      lastX = x;
      lastY = y;
      // keeps the drag alive even if the pointer leaves the canvas
      canvas.setPointerCapture(e.pointerId);
      paintG0(x, y, brushSign());
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!painting) return;
    const sign = brushSign();

    // the browser batches high-frequency samples; these are the ones it dropped
    for (const point of e.getCoalescedEvents?.() ?? [e]) {
      const [x, y] = domainPoint(point);
      stroke(lastX, lastY, x, y, sign);
      lastX = x;
      lastY = y;
    }
  });

  canvas.addEventListener("pointerup", () => { painting = false; });
  canvas.addEventListener("pointercancel", () => { painting = false; });





  function frame() {
    for (let i = 0; i < stepsPerFrame; i++) {
      simulation.update();
    }

    render(simulation.G, img, 1 / (2 * simulation.Gmax), GROUND, noise, -simulation.Gmax);
    markWalkers(simulation, img);
    ctx.putImageData(img, 0, 0);

    // V doesnt really have a fixed rage and grows as trails wear in,
    // so it's recaled to its own peak each frae, and brightness is relative 
    // symmetric about zero, so the midpoint of the ramp always means "neutral"
    let m = 0;
    for (let p = 0; p < simulation.V.length; p++) {
      const a = Math.abs(simulation.V[p]);
      if (a > m) m = a;
    }
    render(simulation.V, potImg, m > 0 ? 1 / (2 * m) : 0, POTENTIAL, null, -m);
    markGates(simulation, potImg);
    potCtx.putImageData(potImg, 0, 0);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

main()
