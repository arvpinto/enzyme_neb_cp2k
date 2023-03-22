<p align="center"> | <a href="https://github.com/arvpinto/enzyme_ts_cp2k/blob/main/enzyme_TS_cp2k_main.md" target="_blank">MAIN PAGE</a> | <a href="https://github.com/arvpinto/enzyme_ts_cp2k/blob/main/enzyme_TS_cp2k_I.md" target="_blank">SECTION I</a> | <a href="https://github.com/arvpinto/enzyme_ts_cp2k/blob/main/enzyme_TS_cp2k_II.md" target="_blank">SECTION II</a> | <a href="https://github.com/arvpinto/enzyme_ts_cp2k/blob/main/enzyme_TS_cp2k_III.md" target="_blank">SECTION III</a> | <a href="https://github.com/arvpinto/enzyme_ts_cp2k/blob/main/enzyme_TS_cp2k_IV.md" target="_blank">SECTION IV</a> | <a href="https://github.com/arvpinto/enzyme_ts_cp2k/blob/main/enzyme_TS_cp2k_V.md" target="_blank">SECTION V</a> | </p> 


---

 
### <p align="center"> **V - TS optimization with the Dimer method** </p>

<br/>

```js
&GLOBAL
    RUN_TYPE GEO_OPT
...
```

---

<br/>
 
In this section, we use the dimer method to optimize the geometry of the TS guess:

- <p align="justify">With the TYPE TRANSITION_STATE keyword we specify a transition state optimization in the &MOTION/&GEO_OPT section.</p>

```js
&MOTION
    &GEO_OPT
        TYPE TRANSITION_STATE
    ...
```

<br/>
 
- <p align="justify">We use a conjugate gradients algorithm for the geometry optimization.</p>

```js
&MOTION
    &GEO_OPT
        ...
        OPTIMIZER CG
        &CG
            MAX_STEEP_STEPS 10
            &LINE_SEARCH
                TYPE 2PNT
                &2PNT
                ...
```

<br/>
 
- <p align="justify">Then we specify the transition state search method in the &MOTION/&GEO_OPT/&TRANSITION_STATE section with the METHOD DIMER keyword. In the &MOTION/&GEO_OPT/&TRANSITION_STATE/&DIMER section we specify the DR parameter, which is associated with the displacement between dimer images and influences the efficiency of your search, since it has to be adequate for the PES region we are studying and might require some tunning. In addition we have to set the ANGLE_TOLERANCE parameter, which controls the tolerance of the angle used in the optimization of the dimer orientation, and turn on the INTERPOLATE_GRADIENT keyword to interpolate the gradient whenever possible during the dimer optimization.</p>

```js
&MOTION
    &GEO_OPT
        ...
        &TRANSITION_STATE
            METHOD DIMER
            &DIMER
                DR 0.01
                ANGLE_TOLERANCE [deg] 1.5
                INTERPOLATE_GRADIENT  T
```

<br/>
 
- <p align="justify">In the &MOTION/&GEO_OPT/&TRANSITION_STATE/&DIMER/&DIMER_VECTOR section we take advantage from the previous VIBRATIONAL_ANALYSIS run by specifying the initial dimer vector to direct the orientation of the dimer instead of being chosen randomly.</p>



```js
&MOTION
    &GEO_OPT
        ...
        &TRANSITION_STATE
            ...
            &DIMER
                ...
                &DIMER_VECTOR
                    @INCLUDE dimer_vector.inc
                ...
```

<br/>
 
- <p align="justify">We also have to specify the section that defines the parameters for the optimization of the dimer rotation. </p>

```js
&MOTION
    &GEO_OPT
        ...
        &TRANSITION_STATE
            ...
            &DIMER
                ...
                &ROT_OPT
                    OPTIMIZER CG
                    MAX_ITER  500
                    &CG
                        MAX_STEEP_STEPS 10
                        &LINE_SEARCH
                            TYPE 2PNT
                            &2PNT
                            ...
```

<br/>

- <p align="justify">After getting an optimized TS structure, we recommend doing a geometry optimization of the minima corresponding to reactant and product, as well as a vibrational analysis to check if there aren't any imaginary frequencies in the minima, and a single imaginary frequency in your saddle point. We also suggest to further re-optimize these final structures with a higher level of theory, such as DFT with the PBE or B3LYP functional, to refine your results.</p>


 
---

<p align="center"> | <a href="https://github.com/arvpinto/enzyme_ts_cp2k/blob/main/enzyme_TS_cp2k_main.md" target="_blank">MAIN PAGE</a> | <a href="https://github.com/arvpinto/enzyme_ts_cp2k/blob/main/enzyme_TS_cp2k_I.md" target="_blank">SECTION I</a> | <a href="https://github.com/arvpinto/enzyme_ts_cp2k/blob/main/enzyme_TS_cp2k_II.md" target="_blank">SECTION II</a> | <a href="https://github.com/arvpinto/enzyme_ts_cp2k/blob/main/enzyme_TS_cp2k_III.md" target="_blank">SECTION III</a> | <a href="https://github.com/arvpinto/enzyme_ts_cp2k/blob/main/enzyme_TS_cp2k_IV.md" target="_blank">SECTION IV</a> | <a href="https://github.com/arvpinto/enzyme_ts_cp2k/blob/main/enzyme_TS_cp2k_V.md" target="_blank">SECTION V</a> | </p> 


