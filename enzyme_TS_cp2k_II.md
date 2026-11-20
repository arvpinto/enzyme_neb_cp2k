<br>
<h2><p align="center"> <b> II - Reaction coordinate and initial band</b> </p> </h2>

<br/>

<pre style="color: white; background-color: black;">
&GLOBAL
    RUN_TYPE GEO_OPT
...
</pre>

---

<br/>

<p align="justify">The CI-NEB method of Section III needs a set of structures (images) that already go, roughly, from the reactant to the product. This section defines the collective variables (CVs) that describe each mechanistic hypothesis, shows how to build the images with restrained optimizations along them (a potential energy surface scan), and how to choose the atoms that stay fixed.</p>

<h3><p align="center"> <b> Fixed atoms </b></p></h3>

<br/>

- <p align="justify">Fixing the atoms far from the active site makes every optimization cheaper and keeps the MM part of the energy from drifting between the structures of the path, so that the energy differences are dominated by the reaction. A VMD selection similar to the following can be used, here keeping free the whole residues within 15 Å of the substrate and the reacting waters (resid 128 is the PC residue of POPC):</p>

<pre style="color: white; background-color: black;">
same residue as all not within 15 of (resid 128 or index 34853)
</pre>

<br/>

- <p align="justify">The atom serial numbers of the selection are written to a file from the VMD command line:</p>

<pre style="color: white; background-color: black;">
set sel [atomselect top "same residue as all not within 15 of (resid 128 or index 34853)"]
set outfile [open freeze.dat w]
puts $outfile [$sel get serial]
close $outfile
</pre>

<br/>

- <p align="justify">CP2K cannot read thousands of atoms in a single LIST line, so the list is split into lines of 100 atoms, which become the fixed_atoms.inc file included in the &MOTION/&CONSTRAINT/&FIXED_ATOMS section of every input.</p>

<pre style="color: white; background-color: black;">
tr -s ' \n' '\n' < freeze.dat | grep -v '^$' | \
    awk 'NR % 100 == 1 {if (NR > 1) print ""; printf "LIST"} {printf " %s", $0} END {print ""}' > fixed_atoms.inc
</pre>

<pre style="color: white; background-color: black;">
&MOTION
    ...
    &CONSTRAINT
        &FIXED_ATOMS
            @INCLUDE fixed_atoms.inc
        &END FIXED_ATOMS
    &END CONSTRAINT
    ...
</pre>

<br/>

---

<br/>

<h3><p align="center"> <b> Collective variables for the two hypotheses </b></p></h3>

<br/>

<p align="justify">In both hypotheses a water molecule attacks the carbonyl carbon (C21) of the sn-2 ester of POPC, the ester bond to the glycerol oxygen (C21-O21) breaks, and O21 is protonated, giving the fatty acid and the lysophospholipid. They differ in where the proton released by the attacking water goes:</p>

- <p align="justify"><b>Single water</b>: the attacking water (W, residue 4707) gives a proton (H&#42;) to Nδ1 of His47, and His47 later gives it to O21.</p>

- <p align="justify"><b>Assisting water</b>: the attacking water (W1, residue 9099) gives a proton (H&#42;) to a second water (W2, residue 6021), which gives one of its own protons (H&#42;&#42;) to O21. His47 only hydrogen bonds to W2.</p>

<p align="justify">The CVs are sums of distances that all shrink (bonds that form) or all grow (bonds that break) as the reaction proceeds. A &DISTANCE_FUNCTION CV is defined as d1 + COEFFICIENT·d2, with d1 between the first two atoms and d2 between the last two, so COEFFICIENT +1.0 gives the sum of the two distances (−1.0 would give their difference).</p>

- <p align="justify">Single water, two CVs: CV1 = d(O<sub>W</sub>-C21) + d(Nδ1-H&#42;) (nucleophilic attack and proton transfer to His47) and CV2 = d(O21-C21) + d(O<sub>W</sub>-H&#42;) (ester cleavage and loss of the proton by the water).</p>

<pre style="color: white; background-color: black;">
&FORCE_EVAL
    ...
    &SUBSYS
        ...
        &COLVAR
            &DISTANCE_FUNCTION
                ATOMS       34854 1982 684 34856
                COEFFICIENT +1.0
            &END DISTANCE_FUNCTION
        &END COLVAR
        &COLVAR
            &DISTANCE_FUNCTION
                ATOMS       1981 1982 34854 34856
                COEFFICIENT +1.0
            &END DISTANCE_FUNCTION
        &END COLVAR
    &END SUBSYS
</pre>

<br/>

- <p align="justify">Assisting water, one CV made of three distances with &COMBINE_COLVAR: d(C21-O<sub>W1</sub>) + d(O<sub>W2</sub>-H&#42;) + d(H<sub>W2</sub>-O21), i.e. the attack, the proton transfer from W1 to W2 and the proton transfer from W2 to O21.</p>

<pre style="color: white; background-color: black;">
&FORCE_EVAL
    ...
    &SUBSYS
        ...
        &COLVAR
            &COMBINE_COLVAR
                FUNCTION  CV1+CV2
                VARIABLES CV1 CV2
                &COLVAR
                    &DISTANCE_FUNCTION
                        ATOMS       1982 48030 38796 48032
                        COEFFICIENT +1.0
                    &END DISTANCE_FUNCTION
                &END COLVAR
                &COLVAR
                    &DISTANCE
                        ATOMS 38797 1981
                    &END DISTANCE
                &END COLVAR
            &END COMBINE_COLVAR
        &END COLVAR
    &END SUBSYS
</pre>

<br/>

<p align="justify">The atom numbers (MM_INDEX of the whole system, as in the &#42;prmtop) are:</p>

| Atom | Single water | Assisting water |
|---|---|---|
| C21, carbonyl carbon of the sn-2 ester (PC 128) | 1982 | 1982 |
| O21, ester oxygen of the glycerol (PC 128) | 1981 | 1981 |
| Nδ1 of His47 | 684 | 684 |
| O of the attacking water (W / W1) | 34854 | 48030 |
| H&#42; transferred from the attacking water | 34856 | 48032 |
| O of the assisting water (W2) | | 38796 |
| H of W2 in the CV (H1) / H that reaches O21 in the band (H2, H&#42;&#42;) | | 38797 / 38798 |

<br/>

<p align="justify">A detail worth checking in your own systems: in the assisting-water band of Section III, the proton that ends on O21 is the other hydrogen of W2 (atom 38798, H&#42;&#42;), which was already hydrogen bonded to O21 in the reactant, and not the one in the CV (38797). The CVs only guide the band, but after any run, look at which atoms actually reacted and, if needed, redefine the CVs.</p>

<br/>

---

<br/>

<h3><p align="center"> <b> Building the images with a PES scan </b></p></h3>

<br/>

- <p align="justify">The images can be generated with restrained geometry optimizations at successive values of the CV(s), each one starting from the structure optimized at the previous value. The CVs are restrained in the &MOTION/&CONSTRAINT/&COLLECTIVE section, with a harmonic restraint (the same force constant, 25 kcal mol<sup>−1</sup> Å<sup>−2</sup>, is used for the band in Section III). With two CVs there is one &COLLECTIVE section per CV.</p>

<pre style="color: white; background-color: black;">
&MOTION
    ...
    &CONSTRAINT
        &COLLECTIVE
            COLVAR         1
            INTERMOLECULAR TRUE
            TARGET [angstrom] TARGET1_TAG
            &RESTRAINT
                K [angstrom^-2*kcalmol] 25.0
            &END RESTRAINT
        &END COLLECTIVE
        &COLLECTIVE
            COLVAR         2
            INTERMOLECULAR TRUE
            TARGET [angstrom] TARGET2_TAG
            &RESTRAINT
                K [angstrom^-2*kcalmol] 25.0
            &END RESTRAINT
        &END COLLECTIVE
        &FIXED_ATOMS
            @INCLUDE fixed_atoms.inc
        &END FIXED_ATOMS
    &END CONSTRAINT
    ...
</pre>

<br/>

- <p align="justify">CP2K has no automatic scan, but a short bash loop does it. Starting from the input of the reactant optimization, make a template scan.inp with PROJECT SCAN_TAG, the &COLLECTIVE sections above and an &EXT_RESTART section that reads the previous point (all but the constraints and the counters). The loop reads the target values of the CVs from targets.dat (one line per scan point, one column per CV, in Å), writes one input per point and runs them in order. Copy the restart file of the reactant optimization to SCAN_0-1.restart before starting.</p>

<pre style="color: white; background-color: black;">
&EXT_RESTART
    RESTART_FILE_NAME  RESTART_TAG
    RESTART_DEFAULT    .TRUE.
    RESTART_CONSTRAINT .FALSE.
    RESTART_COUNTERS   .FALSE.
&END EXT_RESTART
</pre>

<pre style="color: white; background-color: black;">
#!/usr/bin/env bash
# targets.dat: one line per scan point, e.g. "3.90 2.45" for CV1 and CV2
n=0
while read -r t1 t2; do
    n=$((n + 1))
    sed -e "s/SCAN_TAG/SCAN_${n}/g" \
        -e "s/RESTART_TAG/SCAN_$((n - 1))-1.restart/g" \
        -e "s/TARGET1_TAG/${t1}/g" \
        -e "s/TARGET2_TAG/${t2}/g" scan.inp > scan_${n}.inp
    mpirun cp2k.psmp -i scan_${n}.inp -o scan_${n}.out
done < targets.dat
</pre>

<br/>

- <p align="justify">Use small steps (about 0.1-0.25 Å per CV), so each optimization starts close to its target; large jumps make the optimizations slow or make them fail. Running the scan from both ends (from the reactant towards the product and back) helps to see hysteresis, i.e. whether the structures depend on the direction of the scan.</p>

- <p align="justify">The energies of the scan points can be tabulated with the script of the tutorial, with the reactant as reference:</p>

<pre style="color: white; background-color: black;">
./cp2k_energy_analysis.py scan_*.out --ref geo_opt.out --plot scan.png --xlabel "Scan point"
</pre>

<br/>

- <p align="justify">Finally, the structures of the images are written as XYZ files (REPLICA_1.xyz, REPLICA_2.xyz, ...), e.g. the last frame of the trajectory of each scan point (with &TRAJECTORY FORMAT XYZ in the scan inputs, or converting the DCD file), which are read by the band in Section III. The scan also gives a first estimate of the barrier and of the TS geometry, before any band is run.</p>

<br/>
