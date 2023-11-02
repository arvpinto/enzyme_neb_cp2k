<p align="center"> <h3><b>I - Geometry optimization of the reactant</b></h3> </p>

<br/>

```js
&GLOBAL
    RUN_TYPE GEO_OPT
...
```

---

<br/>

#### <p align="center"><b> MM geometry optimization </b></p>

<br/>

We start by specifying the parameters used for the MM part:

- <p align="justify">The parameters have to be specified in the &FORCE_EVAL/&MM/&FORCEFIELD section by the PARMTYPE and PARM_FILE_NAME keywords.</p>

```js
&FORCE_EVAL
    ...
    &MM
        &FORCEFIELD
            ...
            PARMTYPE AMBER
            PARM_FILE_NAME AMBER.prmtop
            ...
```

<br/>
 
- <p align="justify">The non-bonded interactions scaling factors,EI_SCALE14 and VDW_SCALE14, and RCUT_NB have to be set in accordance to the parameterization used in the force field.</p>

```js
&FORCE_EVAL
    ...
    &MM
        &FORCEFIELD
            EI_SCALE14 0.8333
            VDW_SCALE14 0.5000
            ...
            &SPLINE
                RCUT_NB [angstrom] 10
                ...
```

<br/>
 
- <p align="justify">A periodic poisson solver is used for a cell periodic in the X,Y and Z directions.</p>

```js
&FORCE_EVAL
    ...
    &MM
        ...
        &POISSON
            POISSON_SOLVER PERIODIC
            PERIODIC XYZ 
            ...
```

<br/>
 

- <p align="justify">Additional care is required for the treatment of long-range electrostatics, where the the Ewald parameters ALPHA and GMAX have to be tuned. We can start by defining GMAX in accordance to our cell size, using the rule of thumb "1 point per Angstrom". Setting ALPHA without RCUT automatically uses a RCUT value that leads to an expected accuracy in the Ewald sum of 1.0E-6 (this is the default value). The real-space cutoff of the Ewald summation, RCUT, influences the construction of the neighboor lists for non-bonded terms, if bigger than the non-bonded cutoff specified by RCUT_NB. Therefore we should use an ALPHA value large enough to guarantee a RCUT consistent with the non-bonded cutoff that we are using. We can easily check this by running single-point energy calculations (change RUN_TYPE to ENERGY) with varying ALPHA values, and seeing what the RCUT parameter is being set to and how the energy of the system changes.</p>

```js
&FORCE_EVAL
    ...
    &MM
        ...
        &POISSON
            &EWALD
                EWALD_TYPE SPME
                ALPHA 0.35 
                GMAX 110 75 87
                ...
```

<br/>

This concludes the section of the MM parameters, and now we can start defining the system in the &SUBSYS section:

- <p align="justify">The size and type of the simulation box have to be set in the &FORCE_EVAL/&SUBSYS/&CELL section, as well as the periodicity of the system, which is set to XYZ to apply periodic boundary conditions (PBC).</p>

```js
&FORCE_EVAL
    ...
    &SUBSYS
        &CELL
            ABC [angstrom]  110.0094   74.8199   87.0002
            ALPHA_BETA_GAMMA 90.0 90.0 90.0
            SYMMETRY ORTHORHOMBIC
            PERIODIC XYZ
        &END CELL
        ...
```

<br/>
 
- <p align="justify">The connectivity has to be specified in the &FORCE_EVAL/&SUBSYS/&TOPOLOGY section by the CONN_FILE_FORMAT and CONN_FILE_NAME keywords. The coordinates also have to be specified in the &FORCE_EVAL/&SUBSYS/&TOPLOGY section by the COORD_FILE_FORMAT and COORD_FILE_NAME keywords.</p>

```js
&FORCE_EVAL
    ...
    &SUBSYS
        ...
        &TOPOLOGY
            CONN_FILE_FORMAT AMBER
            CONN_FILE_NAME AMBER.prmtop 
            COORD_FILE_FORMAT CRD 
            COORD_FILE_NAME AMBER.rst7
            ...
```

<br/>
 
- <p align="justify">The coordinates are centered in the box. The &FORCE_EVAL/&SUBSYS/&TOPOLOGY/&CENTER_COORDINATES section is only used in the first GEO_OPT run and is left out for the rest of the tutorial.</p>

```js
&FORCE_EVAL
    ...
    &SUBSYS
        ...
        &TOPOLOGY
            ...
            &CENTER_COORDINATES T
            &END CENTER_COORDINATES
        ...
```

<br/>
 
- <p align="justify">Some atom types might not well interpreted by CP2K. For example, if the type of calcium ion is Ca2+ in the \*prmtop as exemplified below, the CP2K run be aborted.</p>

```js
... O2  O2  Ca2+OW  HW ...
```

<br/>
 
- <p align="justify">We can corrected this by modifying the atomn type to Ca2 and specifying this change in the CP2K input:</p>

```js
... O2  O2  Ca2 OW  HW ...
```

```js
&FORCE_EVAL
    ...
    &SUBSYS
        ...
        &KIND Ca2
            ELEMENT Ca
        &END KIND
        ...
```

<br/>
 
After, we define the parameters relative to the geometry optimization process in the &MOTION section:

- <p align="justify">The first calculation is a molecular mechanics (MM) geometry optimization using the limited memory BFGS algorithm, a large number of maximum steps and very tight convergence criteria. This exploits the speed of MM calculations to facilitate the convergence of the next geometry optimizations.</p>

```js
&MOTION
    &GEO_OPT
        OPTIMIZER LBFGS
        MAX_ITER 30000
        MAX_DR    1.8E-05
        RMS_DR    1.2E-05
        MAX_FORCE 4.5E-06
        RMS_FORCE 3.0E-06
    ...
```

<br/>
 
- <p align="justify">The format and frequency of output writting for coordinates and restart files can be set in the &MOTION/&PRINT section.</p>

```js
&MOTION
    ...
    &PRINT
        &TRAJECTORY                               
            FORMAT DCD                            
            ADD_LAST NUMERIC                      
            &EACH                                 
                GEO_OPT 10
            &END EACH
        &END TRAJECTORY
        &RESTART                                 
            ADD_LAST NUMERIC
        &END RESTART
        &RESTART_HISTORY
            ADD_LAST NUMERIC
        &END RESTART_HISTORY
    &END PRINT
    ...
```

<br/>
 
---

<br/>

<p align="center"> <b> QM/MM geometry optimization - mechanical embedding </b></p>

<br/>
 
In the next geometry optimization, the QM method is introduced:

- <p align="justify">To keep the CP2K input simple, we specify the QMMM section through an additional forceeval_qmmm.cp2k.inc file.</p>

```js
&FORCE_EVAL
    ...
    &QMMM
        @INCLUDE forceeval_qmmm.cp2k.inc
        ...
```

<br/>
 
- <p align="justify">The QM cell has to be specified in the forceeval_qmmm.cp2k.inc file as follows:</p>

```js
&CELL
    ABC [angstrom] 25.200000762939453  24.459999084472656  30.450000762939453  
    ALPHA_BETA_GAMMA 90.0 90.0 90.0      
&END CELL
```

<br/>
 
- <p align="justify">Then we have to specify the MM_INDEX for each atom &KIND of our QM layer:</p>

```js
&QM_KIND H
    MM_INDEX 1295 1297 1299 1300 1302 1306 1308 1309 1313 1315 1317 1319 1320 1321 1323 2574 2576 2578 2579 2584 2586 2588 2598 2599 2603 2604 2605 2609 2611 2613 2614       3016   3017 3019 3021 3022 3023 3025 3026 3027 5030 5031 5034 5036 5039 5041 5043 5045 5239 5240 5242 5243 5245 5248 5249 5251 5252 5294 5295 5298 5300 5302 5304 5306 5314  5315    5317 5359 5360 5362 6484 6485 6506 6507 6508 6516 6517 6520 6522 6524 6526 6528 6992 6994 6996 6997 7000 7002 7005 7009 7011 7013 7014 28387 28388
&END QM_KIND
```

<br/>
 
- <p align="justify">And the QM/MM link treatment:</p>

```js
&LINK
    ALPHA_IMOMM 1.38     
    LINK_TYPE IMOMM
    MM_INDEX  1289
    QM_INDEX  1292
    QMMM_SCALE_FACTOR 0.8
&END LINK
```

<br/>
 
- <p align="justify">Where IMOMM is the method used to treat the QM/MM link, ALPHA_IMOMM is a scaling factor for projecting the forces on the capping hydrogen that can be estimated by the bond distances of the forcefield (alpha=r_eq(QM-MM)/r_eq(QM-H)) and QMMM_SCALE_FACTOR is a scaling factor for the MM charge in the QM/MM link. MM_INDEX and QM_INDEX are the MM and QM atoms involved in the QM/MM link, respectively.</p>


- <p align="justify">Here, the QM/MM boundary is treated with a mechanical embedding scheme by setting the ECOUPL keyword to NONE.</p>

```js
&FORCE_EVAL
    ...
    &QMMM
        ...
        ECOUPL NONE
```
        
<br/>
 
- <p align="justify">As mentioned in the introduction, the QM method used here is SCC-DFTB-D3(0):</p>

```js
&FORCE_EVAL
    ...
    &DFT
        CHARGE -1 ! QM charge
        MULTIPLICITY 1 ! Singlet multiplicity
        &MGRID
            CUTOFF 1.0 ! Default for DFTB
        &END MGRID
        &QS
            METHOD DFTB
            &DFTB
                SELF_CONSISTENT    T ! Self-consistent-charge (SCC)
                DO_EWALD           T ! Ewald for Coulomb interaction
                DISPERSION         T ! Dispersion correction
                &PARAMETER
                    PARAM_FILE_PATH  /PATH-TO-SCC-DIRECTORY/scc ! Directory with parameters for SCC-DFTB
                    PARAM_FILE_NAME  scc_parameter ! File with names of Slater-Koster tables
                    DISPERSION_TYPE  D3 ! Grimme D3 method
                    D3_SCALING    1.0 1.1372 0.0 ! Scaling parameters for D3(0) with SCC-DFTB taken from the SCM Amsterdam Modelling Manual
                    DISPERSION_PARAMETER_FILE dftd3.dat ! File with dispersion parameters
                &END PARAMETER
            &END DFTB
        &END QS
        &SCF
            EPS_SCF 1E-6
            MAX_SCF 30 
            SCF_GUESS ATOMIC
            &OT
                MINIMIZER DIIS 
                PRECONDITIONER FULL_SINGLE_INVERSE
                SAFE_DIIS TRUE
            &END OT
            &OUTER_SCF
                EPS_SCF 1E-6
                MAX_SCF 30
            &END OUTER_SCF
        &END SCF
        &POISSON
            &EWALD
                EWALD_TYPE SPME
                ALPHA 1.0 ! ALPHA=1 is recommended for Tight-binding 
                GMAX 25 25 30 ! rule of thumb "1 point per Angstrom"
            &END EWALD
        &END POISSON
    &END DFT
    ...
```

<br/>
 
- <p align="justify">Now, we can lower the geometry optimization criteria to acceptable values (we use the default values from the Gaussian software). </p>

```js
&MOTION
    &GEO_OPT
        OPTIMIZER LBFGS
        MAX_ITER 5000
        MAX_DR    1.8E-03
        RMS_DR    1.2E-03
        MAX_FORCE 4.5E-04
        RMS_FORCE 3.0E-04
    ...
```

<br/>
 
- <p align="justify">Here we start using the &EXT_RESTART section to load data from the previous run. The RESTART_FILE_NAME keyword specifies the restart file from a previous calculation. The RESTART_DEFAULT .TRUE. keyword loads all the variables present in the restart file by setting them to .TRUE.. The RESTART_CELL and RESTART_POS keywords load the cell information and the coordinates, respectively. We can then remove the &CELL section and the COORD_FILE_FORMAT COORD_FILE_NAME keywords from the input.</p>

```js
&EXT_RESTART
    RESTART_FILE_NAME EM-MM-1_8581.restart
    RESTART_POS .TRUE.
    RESTART_CELL .TRUE.
&END EXT_RESTART
```

<br/>
 
---

<br/>

#### **<p align="center"> QM/MM geometry optimization - electrostatic embedding </p>**

<br/>
 
In the last geometry optimization, the QM/MM boundary has been changed to electrostatic embbeding:  

- <p align="justify">To use electrostatic embedding with DFTB, the ECOUPL keyword is set to COLOUMB and the *prmtop is changed to the version where the charges at the QM border have been corrected (considering that the MM charges in the QM region are removed within this scheme).</p>

```js
&FORCE_EVAL
    ...
    &MM
        &FORCEFIELD
            ...
            PARM_FILE_NAME AMBER_ee.prmtop
            ...
    &QMMM
        ...
        ECOUPL COULOMB
        ...
```

<br/>
