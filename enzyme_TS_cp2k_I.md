<br>
<h2> <p align="center"> <b>I - Geometry optimization of the reactant</b> </p></h2>

<br/>

<pre style="color: white; background-color: black;">
&GLOBAL
    PROJECT     GEO_OPT
    RUN_TYPE    GEO_OPT
...
</pre>

---

<br/>

<p align="justify">The first step is a QM/MM geometry optimization of the reactant, which is the reference (zero of energy) for everything that follows. The input is <a href="https://github.com/arvpinto/enzyme_neb_cp2k/blob/main/files/single_water/geo_opt.inp" target="_blank">files/single_water/geo_opt.inp</a>; the assisting-water input differs only in the coordinate file (subs.xyz instead of subs.pdb). The same &FORCE_EVAL section is used, unchanged, in all the inputs of the tutorial (geo_opt.inp, MEP.inp, VIB.inp and dimer.inp), so it is described here once.</p>

<h3><p align="center"> <b> MM part and system </b></p></h3>

<br/>

- <p align="justify">The AMBER parameters and the connectivity come from the &#42;prmtop file, given in &FORCE_EVAL/&MM/&FORCEFIELD and in &FORCE_EVAL/&SUBSYS/&TOPOLOGY. All the inputs use hpla2_ee.prmtop, the version of the topology where the charges at the QM/MM boundary were corrected with parmed for electrostatic embedding (see the overview page).</p>

<pre style="color: white; background-color: black;">
&FORCE_EVAL
    METHOD QMMM
    ...
    &MM
        &FORCEFIELD
            PARMTYPE       AMBER
            PARM_FILE_NAME hpla2_ee.prmtop
            EI_SCALE14     0.8333
            VDW_SCALE14    0.5000
            &SPLINE
                EMAX_SPLINE        1.0E8
                RCUT_NB [angstrom] 10
            &END SPLINE
        &END FORCEFIELD
        ...
</pre>

<br/>

- <p align="justify">EI_SCALE14 and VDW_SCALE14 are the 1-4 scaling factors of the AMBER force fields (1/1.2 and 1/2), and RCUT_NB is the non-bonded cutoff, here 10 Å. EMAX_SPLINE raises the maximum energy up to which the non-bonded splines are built, so they also cover the short contacts that can appear during the optimizations.</p>

- <p align="justify">Long-range electrostatics are treated with smooth particle mesh Ewald in a box periodic in X, Y and Z. GMAX follows the rule of thumb of about one grid point per Ångström of the cell (93 88 103 for a cell of 93.2 × 88.4 × 103.3 Å). Setting ALPHA without RCUT lets CP2K choose the real-space cutoff of the Ewald sum for the default accuracy; ALPHA should be large enough to keep that cutoff consistent with RCUT_NB, which is easy to check with single-point calculations (RUN_TYPE ENERGY) at a few ALPHA values, reading the RCUT reported in the output.</p>

<pre style="color: white; background-color: black;">
&FORCE_EVAL
    ...
    &MM
        ...
        &POISSON
            POISSON_SOLVER PERIODIC
            PERIODIC       XYZ
            &EWALD
                EWALD_TYPE SPME
                ALPHA      .35
                GMAX       93 88 103
            &END EWALD
        &END POISSON
    &END MM
</pre>

<br/>

- <p align="justify">The cell, the topology and the starting coordinates go in &FORCE_EVAL/&SUBSYS. The system has 50774 atoms: the hGIIA sPLA2 enzyme bound to a phospholipid bilayer, with the POPC substrate in the active site, water and ions.</p>

<pre style="color: white; background-color: black;">
&FORCE_EVAL
    ...
    &SUBSYS
        &CELL
            ABC [angstrom]   9.3210001945495605E+01  8.8409994125366225E+01  1.0329999667406082E+02
            ALPHA_BETA_GAMMA 90.0 90.0 90.0
            PERIODIC         XYZ
            SYMMETRY         ORTHORHOMBIC
        &END CELL
        &TOPOLOGY
            COORD_FILE_FORMAT PDB
            COORD_FILE_NAME   subs.pdb
            CONN_FILE_FORMAT  AMBER
            CONN_FILE_NAME    hpla2_ee.prmtop
        &END TOPOLOGY
        ...
</pre>

<br/>

- <p align="justify">CP2K takes the element of each MM atom from its AMBER atom type. Types it cannot interpret (ions such as Na+, Cl- or Ca2+, and a few water and lipid types of this system) must be mapped to an element with a &KIND section. A type with a "+" or "-" sign in the &#42;prmtop may also have to be renamed (e.g. Ca2+ to Ca2) before CP2K accepts it.</p>

<pre style="color: white; background-color: black;">
&FORCE_EVAL
    ...
    &SUBSYS
        ...
        &KIND Na+
            ELEMENT Na
        &END KIND
        &KIND CL-
            ELEMENT Cl
        &END KIND
        &KIND Ca2
            ELEMENT Ca
        &END KIND
        &KIND OO
            ELEMENT O
        &END KIND
        &KIND HX1
            ELEMENT H
        &END KIND
        ...
</pre>

<br/>

---

<br/>

<h3><p align="center"> <b> QM part: PBE with GPW </b></p></h3>

<br/>

- <p align="justify">The QM region is treated with the PBE functional and the Gaussian and plane waves (GPW) method of Quickstep, with GTH pseudopotentials, DZVP-GTH-PBE basis sets (DZV for hydrogen) and a plane-wave cutoff of 300 Ry. The QM region is neutral and a singlet. SCF_GUESS RESTART reads the wavefunction of a previous run when there is one (CP2K falls back to an atomic guess otherwise), which saves many SCF cycles along the tutorial.</p>

<pre style="color: white; background-color: black;">
&FORCE_EVAL
    ...
    &DFT
        CHARGE                0
        MULTIPLICITY          1
        BASIS_SET_FILE_NAME   BASIS_SET
        POTENTIAL_FILE_NAME   GTH_POTENTIALS
        &QS
            METHOD GPW
        &END QS
        &MGRID
            CUTOFF 300
            COMMENSURATE
        &END MGRID
        &XC
            &XC_FUNCTIONAL PBE
            &END XC_FUNCTIONAL
        &END XC
        &SCF
            SCF_GUESS  RESTART
            EPS_SCF    1E-6
            MAX_SCF    60
            &OT
                MINIMIZER       DIIS
                PRECONDITIONER  FULL_SINGLE_INVERSE
                SAFE_DIIS       TRUE
            &END OT
            &OUTER_SCF
                EPS_SCF  1E-6
                MAX_SCF  30
            &END OUTER_SCF
        &END SCF
    &END DFT
    ...
</pre>

<br/>

- <p align="justify">Each QM element needs a basis set and a pseudopotential, given in &FORCE_EVAL/&SUBSYS/&KIND (H, C, N, O, P and S as below, and Ca with GTH-PBE-q10).</p>

<pre style="color: white; background-color: black;">
&FORCE_EVAL
    ...
    &SUBSYS
        ...
        &KIND H
            BASIS_SET DZV-GTH-PBE
            POTENTIAL GTH-PBE-q1
        &END KIND
        &KIND C
            BASIS_SET DZVP-GTH-PBE
            POTENTIAL GTH-PBE-q4
        &END KIND
        ...
        &KIND Ca
            BASIS_SET DZVP-GTH-PBE
            POTENTIAL GTH-PBE-q10
        &END KIND
        ...
</pre>

<br/>

---

<br/>

<h3><p align="center"> <b> QM/MM coupling </b></p></h3>

<br/>

- <p align="justify">The QM/MM electrostatic coupling uses the Gaussian expansion of the electrostatic potential (GEEP, ECOUPL GAUSS), here with 6 Gaussian functions (USE_GEEP_LIB 6). The rest of the &QMMM section comes from an include file, which is the only part of the &FORCE_EVAL that differs between the two pathways.</p>

<pre style="color: white; background-color: black;">
&FORCE_EVAL
    ...
    &QMMM
        ECOUPL       GAUSS
        USE_GEEP_LIB 6
        @INCLUDE forceeval_qmmm.cp2k.inc
    &END QMMM
</pre>

<br/>

- <p align="justify">forceeval_qmmm.cp2k.inc holds the QM cell, the atoms of each QM element (MM_INDEX) and the QM/MM links. The QM region has 164 atoms in the single-water pathway and 167 in the assisting-water pathway (one water more): the backbone of the calcium-binding loop (from the His27 carbonyl to Gly32), His47 and Asp48 (with the Thr46 carbonyl and the N-Cα of Cys49), the side chains of Tyr51, Tyr66 and Asp91, the Ca<sup>2+</sup> ion, the glycerol and phosphocholine of the POPC substrate with the first carbons of both acyl chains, and the reacting water molecule (single water) or molecules (assisting water). The QM cell must contain the whole QM region with some vacuum around it.</p>

<pre style="color: white; background-color: black;">
! CP2K > FORCE_EVAL > QMMM > CELL
&CELL
  ABC [angstrom] 31.90999984741211  25.830001831054688  25.179996490478516     !size of cell
  ALPHA_BETA_GAMMA 90.0 90.0 90.0      !shape of cell
&END CELL

! CP2K > FORCE_EVAL > QMMM > QM_KIND
&QM_KIND H
  MM_INDEX 430 432 440 442 443 447 449 463 465 466 470 472 473 677 679 681 682 686 688 690 694 696 698 699 706 708 730 731 734 736 739 741 743 987 988 991 993 996 998 1000 1359 1360 1941 1942 1944 1945 1950 1951 1953 1955 1956 1961 1962 1964 1965 1968 1969 1970 1972 1973 1974 1976 1977 1978 1985 1986 1988 1989 1991 1992 1994 1995 34855 34856
&END QM_KIND
...
&QM_KIND Ca
  MM_INDEX 1898
&END QM_KIND
</pre>

<br/>

- <p align="justify">Each covalent bond cut by the QM/MM boundary (12 here) is capped with a hydrogen atom using the IMOMM scheme. ALPHA_IMOMM scales the position of the capping hydrogen and can be estimated from the equilibrium bond lengths of the force field (alpha = r<sub>eq</sub>(QM-MM)/r<sub>eq</sub>(QM-H)); QMMM_SCALE_FACTOR scales the charge of the MM atom of the link. MM_INDEX and QM_INDEX are the MM and QM atoms of the cut bond. Note how the values were tuned for some of the links.</p>

<pre style="color: white; background-color: black;">
! CP2K > FORCE_EVAL > QMMM > LINK
&LINK
  ALPHA_IMOMM 1.38     !CT-C bond (default is ALPHA_IMOMM 1.38 for C-C bond)
  LINK_TYPE IMOMM
  MM_INDEX  414
  QM_INDEX  427
  QMMM_SCALE_FACTOR 0.8
&END LINK
&LINK
  ALPHA_IMOMM 1.41     !CT-CT bond (default is ALPHA_IMOMM 1.38 for C-C bond)
  LINK_TYPE IMOMM
  MM_INDEX  450
  QM_INDEX  448
  QMMM_SCALE_FACTOR 0.5
&END LINK
...
</pre>

<br/>

---

<br/>

<h3><p align="center"> <b> Geometry optimization </b></p></h3>

<br/>

- <p align="justify">The optimization uses the limited-memory BFGS algorithm with the default convergence criteria of Gaussian. Atoms far from the active site are kept fixed with the fixed_atoms.inc include file (36847 of the 50774 atoms in the single-water system; Section II shows how to build that file). Fixing them makes the optimizations faster and keeps the MM part of the energy comparable between all the structures of the reaction path.</p>

<pre style="color: white; background-color: black;">
&MOTION
    &GEO_OPT
        OPTIMIZER LBFGS
        MAX_ITER  5000
        MAX_DR    1.8E-03
        RMS_DR    1.2E-03
        MAX_FORCE 4.5E-04
        RMS_FORCE 3.0E-04
    &END GEO_OPT
    &CONSTRAINT
        &FIXED_ATOMS
            @INCLUDE fixed_atoms.inc
        &END FIXED_ATOMS
    &END CONSTRAINT
    ...
</pre>

<br/>

- <p align="justify">The &MOTION/&PRINT section sets the format and frequency of the trajectory and restart files.</p>

<pre style="color: white; background-color: black;">
&MOTION
    ...
    &PRINT
        &TRAJECTORY
            FORMAT   DCD
            ADD_LAST NUMERIC
            &EACH
                GEO_OPT 1
            &END EACH
        &END TRAJECTORY
        &RESTART
            ADD_LAST NUMERIC
        &END RESTART
        &RESTART_HISTORY
            ADD_LAST NUMERIC
        &END RESTART_HISTORY
    &END PRINT
&END MOTION
</pre>

<br/>

- <p align="justify">The L-BFGS optimizer of CP2K can also stop on its own internal criteria (projected gradient and relative energy change), as happened here for both reactants: in the last step the maximum gradient is still above MAX_FORCE, but the RMS gradient is well below RMS_FORCE and the energy no longer changes. The output then re-evaluates the energy at the final geometry. If you want the four Gaussian criteria to be met strictly, restart the optimization with the CG optimizer.</p>

<pre style="color: white; background-color: black;">
 --------  Informations at step =    30 ------------
  Optimization Method        =                LBFGS
  Total Energy               =     -1164.5677222894
  Real energy change         =         0.0000000037
  ...
  Max. gradient              =         0.0039551658
  Conv. limit for gradients  =         0.0004500000
  Conv. for gradients        =                   NO
  RMS gradient               =         0.0000251730
  Conv. limit for RMS grad.  =         0.0003000000
  Conv. in RMS gradients     =                  YES
 ---------------------------------------------------

 ***********************************************
 * Specific L-BFGS convergence criteria         
 * WANTED_PROJ_GRADIENT and WANTED_REL_F_ERROR  
 * satisfied .... run CONVERGED!                
 ***********************************************

                    Reevaluating energy at the minimum
 ...
 ENERGY| Total FORCE_EVAL ( QMMM ) energy [a.u.]:          -1164.567722277413850
</pre>

<br/>

- <p align="justify">The optimized reactants (R.pdb in <a href="https://github.com/arvpinto/enzyme_neb_cp2k/tree/main/files" target="_blank">files/</a>) have total energies of −1164.567722 Ha (single water) and −1180.365786 Ha (assisting water). The two numbers cannot be compared with each other, since the QM regions are different, but each one is the zero of energy of its pathway in the rest of the tutorial.</p>

<br/>

---

<br/>

<h3><p align="center"> <b> Before electrostatic embedding </b></p></h3>

<br/>

<p align="justify">When the starting structure comes straight from an MD simulation, the electrostatic-embedding optimization above converges more easily after a couple of cheaper ones:</p>

- <p align="justify">an MM-only optimization (METHOD FIST instead of QMMM, without the &DFT and &QMMM sections) with the original topology (hpla2.prmtop) and tight criteria, which relaxes the MM part at almost no cost;</p>

- <p align="justify">a QM/MM optimization with mechanical embedding (ECOUPL NONE), still with the original topology, since in mechanical embedding the MM charges of the QM atoms are kept.</p>

<p align="justify">Each run restarts from the previous one with an &EXT_RESTART section, which loads the coordinates and the cell, so the COORD_FILE_NAME and &CELL sections can then be removed.</p>

<pre style="color: white; background-color: black;">
&EXT_RESTART
    RESTART_FILE_NAME GEO_OPT-1.restart
    RESTART_POS  .TRUE.
    RESTART_CELL .TRUE.
&END EXT_RESTART
</pre>

<br/>
