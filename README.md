# Trail Formation Visualizations
Based on [_Modelling the Evolution of Human Trail Systems (Helbing, D., Keltsch, J., & Molnár, P. 1997)_](https://arxiv.org/abs/cond-mat/9805158)

# The Active Walker Model

Helbing, Keltsch, and Molnar introduce a model to describe pedestrian motion to explore the evolution of trails in urban green spaces such as parks. Honestly, I found their model difficult to follow given the dump of notation and confusing prose, so I've redescribed it below:

Let $G(\vec r, t):=$ the ground condition at position $\vec r$ and time $t$. This reflects the comfort of walking, where pedestrians (or 'active walkers') prefer higher values of $G$. Trails are charecterized by these high values of $G$.

Pedestrians, $\alpha$, at their position $\vec r = \vec r _\alpha (t)$ leave 'footprints.' These footprints have an assumed intensity.

Let $I(\vec r):=$ the base intensity of how much a single footstep "wears the ground at position r" (independant of trail history). The assumed intensity of foot traffic is $I(\vec r)*[1- G(\vec r , t)/G_{max}(\vec r, t)]$. This causes a saturation effect by new footprints. 

If that didn't make sense, consider $G(\vec r , t)/G_{max}(\vec r, t)$ to be how close to fully-worm a piece of ground already is as a fraction from 0 to 1. For new grass, this value is 0 and the intensity is $I(\vec r)[1-0]=I(\vec t)$ and for warn grass, where this value approaches 1, $I(\vec r)[1-1]=0$. This is the same shape as logistic growth: the closer you get to the max, the smaller each additional contirbution becomes (a nice condition to prevent our trails from becoming infinitely worn and instead maintains the existing trail).

The ground can also regenerate, restoring the ground to its intitial conditions, $G_0(\vec r)$. The restoration is charecterized by a 'weathering rate,' $\frac{1}{T(\vec r)}$ where $T(\vec r)$ describes the durability of the trail (this rate describes the weathering of the trail, not the ground. I know, bad terminology).


With this, we can describe the change in our ground condition with respect to time to be: 
$$
\begin{aligned}
\frac{dG(\vec r, t)}{dt} = \;
& \underbrace{\frac{1}{T(\vec r)}\left[G_0(\vec r) - G(\vec r, t)\right]}_{\text{regeneration toward } G_0} \\
& + \underbrace{I(\vec r)\left[1 - \frac{G(\vec r, t)}{G_{max}(\vec r, t)}\right]}_{\text{saturating wear per footstep}} \cdot \underbrace{\sum_{\alpha} \delta(\vec r - \vec r_\alpha(t))}_{\text{only where a walker stands}}
\end{aligned}
$$

Next, we need to model a pedestrian's affinity for the ground beneath them. Let $V_{tr}(\vec r_\alpha, t):=$ the trail potential: how attractive the surrounding ground looks to walker $\alpha$, standing at $\vec r_\alpha$, at time $t$.


Attractiveness isn't just G at a point. It's everything the walker can see, weighted by how well they can see it. Nearby trail segments count more than distant ones, and how fast that fallout happens depends on the walker's visibility range, $\sigma(\vec r_\alpha)$.

$$
V_{tr}(\vec r_\alpha, t) = \int d^2r \; \underbrace{e^{-|\vec r - \vec r_\alpha|/\sigma(\vec r_\alpha)}}_{\text{decreases with distance, scaled by visibility}} \; \underbrace{G(\vec r, t)}_{\text{ground condition at } \vec r}
$$


Now we can discuss the walking direction $\vec e_\alpha$ of a pedestrian. There are two seperate attractors:
- **The Destination**. If a walker has a goal $d_\alpha$ and the ground is homogenous ($G(\vec r, t)$ is a constant), just go straight to it. $\frac{(\vec d_\alpha - \vec r_\alpha)}{|\vec d_\alpha - \vec r_\alpha|}$. 
- **Better Trails**. We also want to move in the direction with the greatest increase of ground attraction, given by the normalized gradient $\nabla_{r\alpha} V_{tr}(\vec r, t)$. 

We can combine these two attractors to get the walking direction $\vec e_\alpha$: add both raw pulls together, then normalize once, at the end:

$$
\vec e_\alpha(\vec r_\alpha, t) = \frac{\underbrace{(\vec d_\alpha - \vec r_\alpha)}_{\text{destination pull}} + \underbrace{\nabla_{r_\alpha} V_{tr}(\vec r_\alpha, t)}_{\text{trail pull}}}{\left|(\vec d_\alpha - \vec r_\alpha) + \nabla_{r_\alpha} V_{tr}(\vec r_\alpha, t)\right|}
$$

Because the sum is normalized only once, at the end, the *raw* length of the destination pull matters. Far from the destination, that term dominates. Close to it, the term shrinks, and nearby trails can pull the walker off a straight line.

Now that we have a direction, we have the following equation of motion:


$$
\frac{d\vec r_\alpha}{dt} = v_\alpha^0 \, \vec e_\alpha(\vec r_\alpha, t)
$$

$v_\alpha^0$ is just a scalar: the walker's preferred speed (the original authors mistakenly use velocity).


### Recap Of The Full Model 
$\vec e_\alpha$ was just a unit vector scaling $v_\alpha^0$ linearly — substitute it straight into the equation of motion and drop it as its own line. Three coupled equations:

$$
\begin{aligned}
\frac{dG(\vec r, t)}{dt} &= \frac{1}{T(\vec r)}\left[G_0(\vec r) - G(\vec r, t)\right] + I(\vec r)\left[1 - \frac{G(\vec r, t)}{G_{max}(\vec r)}\right] \sum_{\alpha} \delta(\vec r - \vec r_\alpha(t)) \\[6pt]
V_{tr}(\vec r_\alpha, t) &= \int d^2r \; e^{-|\vec r - \vec r_\alpha|/\sigma(\vec r_\alpha)} \, G(\vec r, t) \\[6pt]
\frac{d\vec r_\alpha}{dt} &= v_\alpha^0 \, \frac{(\vec d_\alpha - \vec r_\alpha) + \nabla_{r_\alpha} V_{tr}(\vec r_\alpha, t)}{\left|(\vec d_\alpha - \vec r_\alpha) + \nabla_{r_\alpha} V_{tr}(\vec r_\alpha, t)\right|}
\end{aligned}
$$

Ground wears and regenerates ($G$), attractiveness aggregates that wear over a walker's field of view ($V_{tr}$), and the walker moves at their preferred speed toward a blend of destination and attractiveness ($d\vec r_\alpha/dt$) which wears the ground again, closing the loop.


The paper notes that we can collapse this whole model down to two dimenionless parameters:

 Rescale position and time by the model's only two natural scales, $\tilde{\vec r} = \vec r/\sigma$ (length, in units of visibility range) and $\tilde t = t/T$ (time, in units of trail durability). $G$ needs no rescaling; it's already dimensionless.
 



---
Why TypeScript? I didn't know TypeScript, so this was a good excuse to learn. 