import FFT from "fft.js"

class Walker {
    // how many steps between stuck checks, and how much of the distance walked
    // in that window has to turn into real progress
    static CHECK_EVERY = 10;
    static MIN_PROGRESS = 0.25;

    pos: Float32Array;
    dest: Gate;
    ep: number;
    sinceCheck = 0;
    markX: number;   // where it was at the last check
    markY: number;

    constructor(at: Float32Array, dest: Gate) {
        this.dest = dest;
        this.pos = new Float32Array(at);
        this.ep = 0.5;
        this.markX = this.pos[0];
        this.markY = this.pos[1];
    }

    // a fresh destination also resets the progress window
    retarget(dest: Gate) {
        this.dest = dest;
        this.sinceCheck = 0;
        this.markX = this.pos[0];
        this.markY = this.pos[1];
    }

    // Destination pull is a unit direction, deviated from exact mathematical model
    // needs |grad V| < 1, or the two cancel and the walker stalls (super annoying)
    advance(gradV: (x: number, y: number) => [number, number], dt: number, lambda: number) {
        const dx = this.dest.pos[0] - this.pos[0];
        const dy = this.dest.pos[1] - this.pos[1];
        const remaining = Math.hypot(dx,dy);

        const [gx, gy] = gradV(this.pos[0], this.pos[1]);

        const ux = dx / remaining + gx;
        const uy = dy / remaining + gy;

        const norm = Math.hypot(ux, uy);
        if (norm < 1e-12) return false; // direction undefined, don't move

        const step = lambda * dt;

        this.pos[0] += step * ux / norm;
        this.pos[1] += step * uy / norm;
        // if the walker is epsilon close to it's destination, it swaps directions
        if (Math.hypot(this.pos[0] - this.dest.pos[0], this.pos[1] - this.dest.pos[1]) < this.ep){
            this.pos[0] = this.dest.pos[0];
            this.pos[1] = this.dest.pos[1];
            return true;
        }

        // Every step covers exactly `step`, so being stuck never shows up as a
        // short step -- it shows up as full-speed steps that cancel out. Compare
        // net displacement against the distance actually walked.
        this.sinceCheck++;
        if (this.sinceCheck >= Walker.CHECK_EVERY) {
            const net = Math.hypot(this.pos[0] - this.markX, this.pos[1] - this.markY);
            const walked = step * this.sinceCheck;

            this.sinceCheck = 0;
            this.markX = this.pos[0];
            this.markY = this.pos[1];

            // hemmed in by terrain it can't get around: give it somewhere else to be
            if (net < walked * Walker.MIN_PROGRESS) return true;
        }

        return false;
    }

}



// n gates at random points on the ground, kept off the boundary so a walker
// standing on one still deposits its whole footprint on the grid.
export type Gate = { pos: Float32Array; score:number};

function randomGates(n: number, L: number): Gate[] {
    const margin = 0.1 * L;
    const span = L - 2 * margin;

    // rejected if too near another gate, so a draw can't cluster them in a corner
    const minGap = 0.2 * span;
    const gates: Gate[] = [];

    for (let attempt = 0; gates.length < n && attempt < 2000; attempt++) {
        const x = margin + Math.random() * span;
        const y = margin + Math.random() * span;

        let tooClose = false;
        for (const g of gates) {
            if (Math.hypot(g.pos[0] - x, g.pos[1] - y) < minGap) { tooClose = true; break; }
        }

        if (!tooClose) gates.push({pos: new Float32Array([x,y]), score: 1});
    }

    return gates;
}

export class Sim {
    // defaults for all of these live in the constructor signature, not here
    dt: number; // h/(4*lambda)
    G: Float32Array;
    Gmax: number;
    V: Float32Array;
    N: number;
    walkers: Walker[];
    kappa: number; // wear intensity: small favours destinations, large favours trails
    lambda: number; // walker speed
    k_approx: number; // number of steps between V updates
    gates: Gate[]; // array of gate ={pos:float32array;score number}
    frameCount: number; // counter for the number of steps that have passed
    // natural ground condition per cell. 0 is plain grass; negative is terrain
    // nobody wants to walk on (mud, water), which puts a dip in V and so pushes
    // walkers away; positive is a pre-existing path that attracts them.
    G0: Float32Array;
    L = 30; // side length of the ground, in sight radii
    h: number; //side length of ground unit
    walkersPerScore = 15; 

    // FFT stuff for the trail potential. M is the zero-padded width
    //  the padding stops the convolution wrapping around the domain
    M: number;
    fft: FFT;
    KHat: Float64Array; // kernel transform, built once
    pad: Float64Array; // M*M interleaved complex scratch for G
    lineIn: Float64Array; // one row/column, going in
    lineOut: Float64Array; // one row/column, coming out

    constructor(
        N: number = 256,
        dt: number = 1.953125e-4, // should be around h/(4*lambda)
        Gmax: number = 1,
        kappa: number = 3,
        lambda: number = 300,
        k_approx: number = 16,
        gates: Gate[] = [],
    ) {
        this.dt = dt;
        this.N = N;
        this.G = new Float32Array(N * N);
        this.G0 = new Float32Array(N * N);   // all grass until something paints it
        this.Gmax = Gmax; // constant for now, could be a function of position
        this.kappa = kappa;
        this.lambda = lambda;
        this.gates = gates.length ? gates : randomGates(3, this.L);
        this.k_approx = k_approx;
        this.frameCount = 0;

        this.h = this.L/this.N

        // fft stuff for V calc
        // h has to be set first: the kernel is sampled at spacing h
        this.M = 2 * N;
        this.fft = new FFT(this.M);
        this.pad = new Float64Array(2 * this.M * this.M);
        this.lineIn = new Float64Array(2 * this.M);
        this.lineOut = new Float64Array(2 * this.M);
        this.KHat = this.buildKernel();

        this.V = new Float32Array(N * N);
        this.updateV();


        this.walkers = []
        this.syncPopulation();
    }

    // V = h^2 (G * K). Conv is a pointwise product in fourier space
    // one forward transform od G against chaced kernel and one inverse
    updateV(): Float32Array {
        const { N, M, pad, KHat, G, V } = this;

        // G into the top-left corner of the padded buffer, rest zero
        pad.fill(0);
        for (let j = 0; j < N; j++) {
            for (let i = 0; i < N; i++) {
                pad[(j * M + i) * 2] = G[j * N + i];
            }
        }

        this.fft2(pad, false);

        // pointwise complex multiply: (a+bi)(c+di)
        for (let p = 0; p < pad.length; p += 2) {
            const a = pad[p], b = pad[p + 1];
            const c = KHat[p], d = KHat[p + 1];
            pad[p] = a * c - b * d;
            pad[p + 1] = a * d + b * c;
        }

        this.fft2(pad, true);

        // real part of the top-left corner, scaled by the area element
        const s = this.h * this.h;
        for (let j = 0; j < N; j++) {
            for (let i = 0; i < N; i++) {
                V[j * N + i] = pad[(j * M + i) * 2] * s;
            }
        }

        return V;
    }


    // e^-r sampled on the padded grid, with the origin at index 0 and negative offsets wrapped to the high indices
    // center it instead would shift V by half the domain
    buildKernel(): Float64Array {
        const { M, h } = this;
        const K = new Float64Array(2 * M * M);

        for (let j = 0; j < M; j++) {
            const dy = j < M / 2 ? j : j - M;
            for (let i = 0; i < M; i++) {
                const dx = i < M / 2 ? i : i - M;
                K[(j * M + i) * 2] = Math.exp(-h * Math.sqrt(dx * dx + dy * dy));
            }
        }

        this.fft2(K, false);
        return K;
    }

    // 2D transform in place. 1D transforms along every row, then every column.
    // fft.js divides by size on each inverse pass, so the two inverse passes together give the 1/M^2 a 2D inverse needs
    // no extra scaling.
    fft2(buf: Float64Array, inverse: boolean) {
        const { M, fft, lineIn, lineOut } = this;
        const run = inverse
            ? (o: Float64Array, d: Float64Array) => fft.inverseTransform(o, d)
            : (o: Float64Array, d: Float64Array) => fft.transform(o, d);

        for (let j = 0; j < M; j++) {
            const base = j * M * 2;
            for (let p = 0; p < 2 * M; p++) lineIn[p] = buf[base + p];
            run(lineOut, lineIn);
            for (let p = 0; p < 2 * M; p++) buf[base + p] = lineOut[p];
        }

        for (let i = 0; i < M; i++) {
            for (let j = 0; j < M; j++) {
                lineIn[2 * j] = buf[(j * M + i) * 2];
                lineIn[2 * j + 1] = buf[(j * M + i) * 2 + 1];
            }
            run(lineOut, lineIn);
            for (let j = 0; j < M; j++) {
                buf[(j * M + i) * 2] = lineOut[2 * j];
                buf[(j * M + i) * 2 + 1] = lineOut[2 * j + 1];
            }
        }
    }

    syncPopulation(spawnAt: Gate|null = null){
        let totalScore = 0;
        for (const g of this.gates) totalScore+=g.score;
        const target = Math.round(this.walkersPerScore*totalScore);

        //walkers are exchangable lol, so which onces get cut doesnt matter
        while (this.walkers.length>target){
            this.walkers.splice(Math.floor(Math.random()*this.walkers.length),1);
        }

        while (this.walkers.length<target){
                const home = spawnAt ?? this.pickGate(null);
                const w = new Walker(home.pos, this.pickGate(home));
                if (!spawnAt){
                    w.pos[0]=Math.random()*this.L;
                    w.pos[1]=Math.random()*this.L;
                }
                this.walkers.push(w)
        }
    }


    update() {
        this.updateG();
        this.frameCount++;
        if (this.frameCount % this.k_approx === 0) {
            this.V = this.updateV(); //this could be a every k frames thing
        }

        // wrapped rather than passed bare, so gradV keeps its `this`
        const gradV = (x: number, y: number) => this.gradV(x, y);

        for (const walker of this.walkers) {
            if (walker.advance(gradV, this.dt, this.lambda)){
                walker.retarget(this.pickGate(walker.dest));
            }
        }
    }


    updateG() {
        let deposit = new Float32Array(this.N * this.N).fill(0)
        for (const walker of this.walkers){
            // add deposit from walker on deposit
            const u = walker.pos[0] / this.h - 0.5;
            const v = walker.pos[1] / this.h - 0.5;
            const i0 = Math.floor(u);
            const j0 = Math.floor(v);
            const fx = u - i0;
            const fy = v - j0;

            this.addDeposit(deposit, i0,     j0,     (1 - fx) * (1 - fy));
            this.addDeposit(deposit, i0 + 1, j0,     fx * (1 - fy));
            this.addDeposit(deposit, i0,     j0 + 1, (1 - fx) * fy);
            this.addDeposit(deposit, i0 + 1, j0 + 1, fx * fy);
        }


        // add depot to G
        const c = this.kappa / (this.h * this.h);
        for (let i = 0; i<this.G.length;i++){
            const g = this.G[i];
            const g0 = this.G0[i];
            const next = g + this.dt*((g0 - g) + c*(1 - g/this.Gmax)*deposit[i]);
            // the floor is G0, not 0: a pond can't be trodden back up to grass
            this.G[i] = next < g0 ? g0 : next > this.Gmax ? this.Gmax : next;
        }
    }

    // adds a single walker's share of a footprint on (i,j)
    // footprint has mass 1, split across 4 nearby cells
    // bilinear weights
    addDeposit(deposit: Float32Array, i: number, j: number, weight: number) {
        // drop cells off the grid, so a walker near the edge deposits less than
        // a full footprint
        if (i < 0 || i >= this.N || j < 0 || j >= this.N) return;
        deposit[j * this.N + i] += weight;
    }

    // gradV at a continuous position. Central difference give the grad at center. 
    // use bilinear weights to interpolate.
    gradV(x: number, y: number): [number, number] {
        const { N, h, V } = this;

        const u = x / h - 0.5;
        const v = y / h - 0.5;
        const i0 = Math.floor(u);
        const j0 = Math.floor(v);
        const fx = u - i0;
        const fy = v - j0;

        let gx = 0;
        let gy = 0;

        for (let dj = 0; dj <= 1; dj++) {
            for (let di = 0; di <= 1; di++) {
                const w = (di ? fx : 1 - fx) * (dj ? fy : 1 - fy);
                if (w === 0) continue;

                // a walker off the edge reads the boundary cell
                const i = Math.min(Math.max(i0 + di, 0), N - 1);
                const j = Math.min(Math.max(j0 + dj, 0), N - 1);

                const ip = Math.min(i + 1, N - 1);
                const im = Math.max(i - 1, 0);
                const jp = Math.min(j + 1, N - 1);
                const jm = Math.max(j - 1, 0);

                gx += w * (V[j * N + ip] - V[j * N + im]) / ((ip - im) * h);
                gy += w * (V[jp * N + i] - V[jm * N + i]) / ((jp - jm) * h);
            }
        }

        return [gx, gy];
    }


    pickGate(exclude: Gate|null): Gate {
        let total = 0;
        for (const g of this.gates) {
            if (g !== exclude) total += g.score;
        }

        //every other gate has score 0, so there is nothing to prefer
        if (total <= 0) {
            for (const g of this.gates) if (g !== exclude) return g;
            return this.gates[0];
        }

        // walk the scores until the running total passes a uniform draw
        let r = Math.random() * total;
        for (const g of this.gates) {
            if (g === exclude) continue;
            r -= g.score;
            if (r <= 0) return g;
        }

        //only reachable through floating point drift on the last step
        for (let i = this.gates.length - 1; i >= 0; i--) {
            if (this.gates[i] !== exclude) return this.gates[i];
        }
        return this.gates[0];
    }

    addGate(x:number, y:number, score=1):Gate{
        const gate: Gate = {pos: new Float32Array([x,y]), score};
        this.gates.push(gate);
        this.syncPopulation(gate); //new walkers will start at this new gate, yay
        return gate;

    }

    removeGate(gate: Gate){
        if (this.gates.length<=2) return; //two is the minimum for a dest to exist
        const i = this.gates.indexOf(gate);
        if (i<0) return;

        this.gates.splice(i,1);

        //retarget before trimming or walkers steer at a deleted gate
        for (const w of this.walkers){
            if (w.dest===gate) w.dest = this.pickGate(null);
        }
        this.syncPopulation();
    }



}