# Implementation

Everything below is in the rescaled variables ($\tilde{\vec r}$, $\tilde t$), so the only free parameters are $\kappa$ and $\lambda$. Tildes will be dropped for readability.

## The Ground

The ground is a square of side length $L$, divided into $N \times N$ square cells of length $h = L/N$

$G_{ij}$ is the ground condition at the center of cell $(i,j)$. Walker positions $\vec r_\alpha$ stay continuous and rarely land on a cell center, so both exchanges between walker and grid are spread across the four surrounding cells, weighted by proximity: a footprint is split among them, and $\nabla V$ is read back as their weighted average.

$h$ sets the trail width. A walker's path is a 1-D curve with zero area, so the continuous model gives trails zero width. The grid regularizes this: a trail is as wide as the cells it touches. Changing $N$ changes the trails even at fixed $\kappa$ and $\lambda$.

## Discretizing the ground equation

$\delta^2$ has units of $1/\text{length}^2$, so on a grid it becomes a spike of height $1/h^2$ in the occupied cell. We spread each footprint across the four nearest cells with bilinear weights $S_{ij}(\vec r_\alpha)$ summing to 1, which avoids staircase artifacts along trails:

```math
\delta^2(\vec r - \vec r_\alpha) \;\longrightarrow\; \frac{1}{h^2} S_{ij}(\vec r_\alpha)
```

Forward Euler at timestep $\Delta t$:

```math
G_{ij}^{n+1} = G_{ij}^{n} + \Delta t \left\{ \underbrace{\left[G_0 - G_{ij}^{n}\right]}_{\text{regeneration}} + \underbrace{\frac{\kappa}{h^2}\left[1 - \frac{G_{ij}^{n}}{G_{max}}\right] \sum_{\alpha} S_{ij}(\vec r_\alpha^{\,n})}_{\text{footprints}} \right\}
```

The saturation bracket holds $G$ below $G_{max}$, but a large step can overshoot, so we clamp to $[0, G_{max}]$ after each update.

The $\kappa/h^2$ means refining the grid makes each footprint hit harder, since the same wear is concentrated into a smaller cell. $\kappa$ and $N$ are not independent knobs.

## Discretizing the trail potential

Evaluated once per walker, the trail potential costs $O(WN^2)$ per step for $W$ walkers. But $V_{tr}$ is a convolution, so we compute the whole field once and let every walker sample it:

```math
V_{ij} = h^2 \sum_{k,l} e^{-\|\vec r_{ij} - \vec r_{kl}\|}\, G_{kl} \qquad\Longleftrightarrow\qquad V = h^2 \,(G \ast K), \quad K_{pq} = e^{-h\sqrt{p^2+q^2}}
```

The $h^2$ is the area element of the Riemann sum. Cost is now one convolution per step, independent of walker count.

Direct evaluation is $O(N^4)$, so we use an FFT. Both arrays are zero-padded, which is also the correct boundary condition: the potential integrates over the green area only, so ground past the edge contributes nothing.

TO DO: Implement direct sum for testing. At $N = 64$ the two must agree.

## Discretizing the equation of motion

Central differences give the gradient on the grid:

```math
(\nabla V)_{ij} = \left( \frac{V_{i+1,j} - V_{i-1,j}}{2h}, \;\; \frac{V_{i,j+1} - V_{i,j-1}}{2h} \right)
```

Walkers sit between grid points, so we bilinearly interpolate this field at $\vec r_\alpha$, then step explicitly:

```math
\vec u_\alpha = (\vec d_\alpha - \vec r_\alpha) + \nabla V(\vec r_\alpha), \qquad
\vec r_\alpha^{\,n+1} = \vec r_\alpha^{\,n} + \Delta t \, \lambda_\alpha \frac{\vec u_\alpha}{\|\vec u_\alpha\|}
```

If $\|\vec u_\alpha\|$ falls below some $\epsilon$ the walker has arrived and the direction is undefined, so we despawn rather than divide by zero.

## Choosing a timestep

Walkers move $\lambda \Delta t$ per step. More than a cell per step and they skip cells without wearing them, which shows up as dashed trails, so the default is

$$
\Delta t = \frac{1}{4}\frac{h}{\lambda}
$$

## Planned loop

```
each frame:
  1. splat footprints from every walker into a deposit buffer
  2. update G (regeneration + deposit), clamp to [0, Gmax]
  3. V = separable_blur(G)                 # every k frames; G changes slowly
  4. for each walker:
       sample grad(V) at its position
       add destination pull, normalize, advance
  5. spawn new walkers, despawn arrived ones
  6. render G to canvas
```

$\lambda \gg 1$ means the ground evolves slowly relative to walker motion, so step 3 can run every $k$ frames instead of every frame. Computing V is the mostly costly part of this loop. 


