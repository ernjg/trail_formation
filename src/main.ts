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
) {
  const segments = stops.length - 1;

  for (let p = 0; p < field.length; p++) {
    let v = field[p] * scale;
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
          gate[0] + di * sim.h,
          gate[1] + dj * sim.h,
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
          gate[0] + di * sim.h,
          gate[1] + dj * sim.h,
          GATE_DOT);
      }
    }
  }
}

// colors!
const NOISE_COARSE = 5; // patchiness, in colour units out of 255
const NOISE_FINE = 2; // per-cell grain

// fresh grass -> trampled dead grass -> bare packed earth
const GROUND = [
  [ 74, 124,  58],
  [150, 130,  88],
  [148, 143, 134],
];

const POTENTIAL = [[0, 0, 0], [255, 255, 255]];

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

  speed.addEventListener("input", () => {
    stepsPerFrame = Number(speed.value);
    speedOut.textContent = `x${speed.value}`
  }
)

  function frame() {
    for (let i = 0; i < stepsPerFrame; i++) {
      simulation.update();
    }

    render(simulation.G, img, 1 / simulation.Gmax, GROUND, noise);
    markWalkers(simulation, img);
    ctx.putImageData(img, 0, 0);

    // V doesnt really have a fixed rage and grows as trails wear in,
    // so it's recaled to its own peak each frae, and brightness is relative 
    let vMax = 0;
    for (let p = 0; p < simulation.V.length; p++) {
      if (simulation.V[p] > vMax) vMax = simulation.V[p];
    }
    render(simulation.V, potImg, vMax > 0 ? 1 / vMax : 0, POTENTIAL);
    markGates(simulation, potImg);
    potCtx.putImageData(potImg, 0, 0);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

main()
