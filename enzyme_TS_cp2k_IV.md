<br>
<h2><p align="center"><b>IV - Vibrational analysis</b></p></h2>

<br/>

<pre style="color: white; background-color: black;">
&GLOBAL
    PROJECT     VIB
    RUN_TYPE    VIBRATIONAL_ANALYSIS
...
</pre>

---

<br/>

<p align="justify">A vibrational analysis is used twice in this workflow: on the TS guess (e.g. the highest image of the band), to check that it has a negative curvature along the reaction and to obtain the starting direction of the dimer method (Section V), and on the saddle point found by the dimer method, to confirm that it has one, and only one, imaginary frequency associated with the reaction. The inputs are files/single_water/VIB.inp and files/assisting_water/VIB.inp, set up for the second use (the coordinates are those of the dimer TS); for the first one only the coordinate file changes.</p>

<h3><p align="center"> <b> Mode-selective vibrational analysis </b></p></h3>

<br/>

- <p align="justify">A full Hessian of a QM/MM system with thousands of moving atoms is out of reach, but the modes that matter for a TS involve a few atoms. The &MODE_SELECTIVE section computes only the modes dominated by the motion of the atoms given in ATOMS, with a Davidson-like iterative scheme: here the ester oxygen O21 and the proton transferred in each pathway (1981 and 34856 for single water, 38797 and 1981 for assisting water). &INVOLVED_ATOMS with RANGE −5000 0 tracks the modes of those atoms with negative (imaginary) frequencies, and LOWEST_FREQUENCY sets the lowest frequency written to the output.</p>

<pre style="color: white; background-color: black;">
&VIBRATIONAL_ANALYSIS
    FULLY_PERIODIC T
    NPROC_REP      128
    &MODE_SELECTIVE
        ATOMS            1981 34856
        LOWEST_FREQUENCY -5000
        &INVOLVED_ATOMS
            INVOLVED_ATOMS 1981 34856
            RANGE          -5000 0
        &END INVOLVED_ATOMS
    &END MODE_SELECTIVE
    &PRINT
        &PROGRAM_RUN_INFO ON
        &END PROGRAM_RUN_INFO
    &END PRINT
&END VIBRATIONAL_ANALYSIS
</pre>

<br/>

- <p align="justify">NPROC_REP is the number of MPI tasks of each replica environment: the finite-difference displacements are distributed over replicas, so the total number of MPI tasks should be a multiple of it (128 for single water and 64 for assisting water in these runs). FULLY_PERIODIC T keeps the rotations in the Hessian (they are not projected out), as appropriate for a periodic system. The &MOTION section, with the fixed atoms, is the same as in the other inputs.</p>

<br/>

---

<br/>

<h3><p align="center"> <b> Frequencies </b></p></h3>

<br/>

- <p align="justify">The output ends with a list of the tracked frequencies, where imaginary frequencies are printed as negative numbers. cp2k_vib_analysis.py prints every list found in an output (one per run). The single-water VIB.out holds two runs: the first one on a TS guess taken from an earlier version of the band (its 12th image), and the second one on the saddle point refined with the dimer method.</p>

<pre style="color: white; background-color: black;">
./cp2k_vib_analysis.py --out VIB.out --nfreq 5
# VIB.out: frequency list 1 of 2 (132 modes, 1 imaginary)
 MODE    FREQ/cm-1  CONVERGED
    1    -1282.972  yes   <- imaginary
    2       79.141  yes
    3      146.127  yes
    4      202.208  yes
    5      249.837  yes
# VIB.out: frequency list 2 of 2 (54 modes, 1 imaginary)
 MODE    FREQ/cm-1  CONVERGED
    1     -116.495  yes   <- imaginary
    2      167.907  yes
    3      328.236  no
    4      391.411  no
    5      562.056  no
</pre>

<pre style="color: white; background-color: black;">
./cp2k_vib_analysis.py --out VIB.out --nfreq 5           # assisting water
# VIB.out: frequency list 1 of 1 (104 modes, 1 imaginary)
 MODE    FREQ/cm-1  CONVERGED
    1     -254.672  yes   <- imaginary
    2      130.723  yes
    3      157.219  yes
    4      186.607  yes
    5      307.128  no
</pre>

<br/>

- <p align="justify">Both saddle points have a single imaginary frequency, 116.5i cm<sup>−1</sup> (single water) and 254.7i cm<sup>−1</sup> (assisting water). The CONVERGENCE column refers to the iterative scheme: the modes that matter here (the imaginary one and the lowest real ones) are converged, the higher ones, which were not tracked, are not. The imaginary frequency of the single-water TS guess (1283i cm<sup>−1</sup>) is much larger than that of the refined TS: a structure near the top of the band can have a very different curvature from the saddle point, so the refined structure has to be checked again.</p>

<br/>

---

<br/>

<h3><p align="center"> <b> The imaginary modes </b></p></h3>

<br/>

- <p align="justify">CP2K writes the normal modes to a Molden file (VIB-VIBRATIONS-1.mol). With <code>--molden</code>, cp2k_vib_analysis.py reads one mode and lists the atoms that move the most (<code>--top</code>), optionally only those of the QM region (<code>--qmmm-inc</code>). The coordinates are read from the Molden file or, here, from the structure that was analysed (<code>--coords</code>, a PDB file gives the atom and residue names):</p>

<pre style="color: white; background-color: black;">
./cp2k_vib_analysis.py --molden VIB-VIBRATIONS-1.mol --mode 1 --coords TS.pdb --qmmm-inc forceeval_qmmm.cp2k.inc --top 8
# VIB-VIBRATIONS-1.mol: mode 1, 50774 atoms                       (single water)
   ATOM  NAME  RES    RESID      |d|
  34856  H2    WAT     4707   0.7816
   1982  C21   PC       128   0.2434
   1953  HX    PC       128   0.1715
   1955  HA    PC       128   0.1707
    684  ND1   HIE       47   0.1603
   1981  O21   PC       128   0.1601
    683  CG    HIE       47   0.1395
   1989  H3S   OL       129   0.1329

# VIB-VIBRATIONS-1.mol: mode 1, 50774 atoms                       (assisting water)
   ATOM  NAME  RES    RESID      |d|
   1981  O21   PC       128   0.5698
  38798  H2    WAT     6021   0.4560
  48032  H2    WAT     9099   0.3740
   1982  C21   PC       128   0.2375
   1953  HX    PC       128   0.2148
   1952  C2    PC       128   0.1872
  48031  H1    WAT     9099   0.1560
   1986  H2S   OL       129   0.1559
</pre>

<br/>

- <p align="justify"><code>--animate</code> writes the selected atoms displaced back and forth along the mode (<code>--frames</code> per period, largest displacement <code>--amplitude</code> in Å) as a multi-frame XYZ or PDB file, to watch in VMD, PyMOL or any other viewer:</p>

<pre style="color: white; background-color: black;">
./cp2k_vib_analysis.py --molden VIB-VIBRATIONS-1.mol --mode 1 --coords TS.pdb \
    --qmmm-inc forceeval_qmmm.cp2k.inc --animate --format pdb --amplitude 0.5
# 40 frames of 164 atoms written to VIB_MODE_1.pdb
vmd VIB_MODE_1.pdb
</pre>

<br/>

<p align="justify">The movies below show the residues of the QM region around the reacting atoms of each saddle point (TS.pdb) moving along its imaginary mode, in the same style as the panel of Section III, with the bonds that form or break as dashed yellow lines.</p>

<div class="pair">
  <figure>
    <video class="theme-dark-only" src="assets/media/mode_single_dark.mp4" poster="assets/media/mode_single_dark.jpg" autoplay loop muted playsinline preload="metadata" aria-label="Imaginary mode of the single-water transition state"></video>
    <video class="theme-light-only" src="assets/media/mode_single_light.mp4" poster="assets/media/mode_single_light.jpg" autoplay loop muted playsinline preload="metadata" aria-label="Imaginary mode of the single-water transition state"></video>
    <figcaption><b>Single water, 116.5i cm<sup>−1</sup>.</b> H&#42; moves between Nδ1 of His47 and O21, coupled with the C21-O21 bond (2.11 Å at the TS): the proton transfer to the leaving group as the ester bond breaks.</figcaption>
  </figure>
  <figure>
    <video class="theme-dark-only" src="assets/media/mode_assisting_dark.mp4" poster="assets/media/mode_assisting_dark.jpg" autoplay loop muted playsinline preload="metadata" aria-label="Imaginary mode of the assisting-water transition state"></video>
    <video class="theme-light-only" src="assets/media/mode_assisting_light.mp4" poster="assets/media/mode_assisting_light.jpg" autoplay loop muted playsinline preload="metadata" aria-label="Imaginary mode of the assisting-water transition state"></video>
    <figcaption><b>Assisting water, 254.7i cm<sup>−1</sup>.</b> O21 moves away from C21 (C21-O21 1.73 Å at the TS) while H&#42;&#42; moves from W2 to O21 and H&#42; from W1 to W2: both proton transfers are coupled to the ester cleavage.</figcaption>
  </figure>
</div>

<br/>

---

<br/>

<h3><p align="center"> <b> Dimer vector </b></p></h3>

<br/>

- <p align="justify">The imaginary mode of the TS guess is the best starting direction for the dimer method: it already points along the reaction, so the dimer does not have to find it by rotating from a random direction. <code>--dimer-vector</code> writes the mode of all the atoms (normalised) in the format of the &DIMER_VECTOR section, one line per atom:</p>

<pre style="color: white; background-color: black;">
./cp2k_vib_analysis.py --molden VIB-VIBRATIONS-1.mol --mode 1 --dimer-vector vector.inc
# VIB-VIBRATIONS-1.mol: mode 1, 50774 atoms
# dimer vector (50774 atoms, normalised) written to vector.inc
</pre>

<br/>

- <p align="justify">The vector.inc file is then included in the dimer input of Section V. Run this on the Molden file of the TS guess, not on the one of the refined TS.</p>

<br/>
