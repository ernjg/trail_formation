import {Sim} from "./sim.ts";


// The canvases from our html: G on the left, V on the right
const canvas = document.querySelector<HTMLCanvasElement>("#sim")!;
const ctx = canvas.getContext("2d")!;

const potCanvas = document.querySelector<HTMLCanvasElement>("#pot")!;
const potCtx = potCanvas.getContext("2d")!;



// render step. map a scalar field to colors and write them into a canvas
// scale takes the field to [0,1]; from/to are the ends of the color ramp
function render(
  field: Float32Array,
  img: ImageData,
  scale: number,
  from: number[],
  to: number[],
) {
  for (let p = 0; p < field.length; p++) {
    let v = field[p] * scale;
    v = v < 0 ? 0 : v > 1 ? 1 : v;

    img.data[p * 4 + 0] = from[0] + (to[0] - from[0]) * v;
    img.data[p * 4 + 1] = from[1] + (to[1] - from[1]) * v;
    img.data[p * 4 + 2] = from[2] + (to[2] - from[2]) * v;
    img.data[p * 4 + 3] = 255;
  }
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
const GRASS = [74, 124, 58];
const DIRT = [166, 137, 96];
const COLD = [0, 0, 0];
const HOT = [255, 255, 255];

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

  //for the potential map
  potCanvas.width = simulation.N;
  potCanvas.height = simulation.N;
  const potImg = potCtx.createImageData(simulation.N, simulation.N);

  // sim loop. Each frame runs a fixed number of steps then paints once
  //returning between frames lets the browser repaint
  const STEPS_PER_FRAME = 10;

  function frame() {
    for (let i = 0; i < STEPS_PER_FRAME; i++) {
      simulation.update();
    }

    render(simulation.G, img, 1 / simulation.Gmax, GRASS, DIRT);
    markWalkers(simulation, img);
    ctx.putImageData(img, 0, 0);

    // V doesnt really have a fixed rage and grows as trails wear in,
    // so it's recaled to its own peak each frae, and brightness is relative 
    let vMax = 0;
    for (let p = 0; p < simulation.V.length; p++) {
      if (simulation.V[p] > vMax) vMax = simulation.V[p];
    }
    render(simulation.V, potImg, vMax > 0 ? 1 / vMax : 0, COLD, HOT);
    markGates(simulation, potImg);
    potCtx.putImageData(potImg, 0, 0);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

main()
