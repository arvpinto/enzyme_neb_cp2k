<br>
<p align="justify"><b>This tutorial characterizes, with QM/MM methods in CP2K, the reactant, transition state and product of an enzymatic reaction found with the climbing image nudged elastic band (CI-NEB) and dimer methods. The example is the hydrolysis of a phospholipid by the human group IIA secreted phospholipase A2 (hGIIA sPLA2), studied for two mechanistic hypotheses: the single-water and the assisting-water pathways.</b></p>

<p align="justify">sPLA2 enzymes hydrolyse the ester bond at the sn-2 position of phospholipids, giving a fatty acid and a lysophospholipid. In the active site, a Ca<sup>2+</sup> ion binds the carbonyl oxygen of that ester, and His47, paired with Asp91, hydrogen bonds the water molecules next to the scissile bond. Two proposals differ in how the attacking water is activated and in the path of its proton: in the <b>single-water</b> pathway the water gives a proton to His47, which then protonates the leaving oxygen of the glycerol; in the <b>assisting-water</b> pathway a second water molecule takes the proton of the attacking water and passes one of its own to the leaving oxygen. Both pathways are followed in parallel, from the same enzyme-membrane system with a POPC substrate, through the five sections of the tutorial:</p>

<ol>
<li><p align="justify"><a href="https://arvpinto.github.io/enzyme_neb_cp2k/enzyme_TS_cp2k_I.html">Geometry optimization</a> of the reactant, with the QM/MM (PBE/AMBER) setup used in all the inputs;</p></li>
<li><p align="justify"><a href="https://arvpinto.github.io/enzyme_neb_cp2k/enzyme_TS_cp2k_II.html">Reaction coordinate and initial band</a>: the collective variables of each hypothesis and a PES scan to build the starting images;</p></li>
<li><p align="justify"><a href="https://arvpinto.github.io/enzyme_neb_cp2k/enzyme_TS_cp2k_III.html">Nudged elastic band</a>: the CI-NEB minimum energy path, with an interactive view of the energy profile and of the structure of every image;</p></li>
<li><p align="justify"><a href="https://arvpinto.github.io/enzyme_neb_cp2k/enzyme_TS_cp2k_IV.html">Vibrational analysis</a>: mode-selective frequencies of the TS guess and of the saddle point, and movies of the imaginary modes;</p></li>
<li><p align="justify"><a href="https://arvpinto.github.io/enzyme_neb_cp2k/enzyme_TS_cp2k_V.html">Dimer method</a>: refinement of the saddle points and the final energetics of both pathways.</p></li>
</ol>

<p align="justify">It requires the &#42;prmtop and coordinate files of a solvated protein-ligand complex parameterized with an Amber force field, previously equilibrated with MD simulations in the intended ensemble and PBC corrected. The &#42;prmtop file and the &QMMM section of the CP2K input should be prepared according to the tutorial <a href="https://www.cp2k.org/howto:biochem_qmmm" target="_blank">QMMM for biochemical systems</a> (and the previous tutorial of this series). With electrostatic embedding, parmed is used to produce an additional &#42;prmtop file in which the charges at the QM/MM boundary have been corrected, considering that the MM charges of the QM atoms are removed. The QM region should be chosen carefully, weighing the accuracy required by the reaction against the computational resources available. Most of the information in this tutorial comes from the <a href="https://www.cp2k.org/" target="_blank">CP2K site</a>, the <a href="https://manual.cp2k.org/" target="_blank">CP2K manual</a> and the <a href="https://groups.google.com/g/cp2k" target="_blank">CP2K discussion group</a>. The calculations shown here are part of the work published in <a href="https://doi.org/10.1039/d4sc02315c" target="_blank">Revisiting the reaction pathways for phospholipid hydrolysis catalyzed by phospholipase A2 with QM/MM methods</a> (Chem. Sci. 2024, 15, 9793).</p>

<p align="center"><b> Once these requirements are fulfilled, you are ready to start this tutorial. </b></p>

<p align="justify">The QM region (164 or 167 atoms) is described with the PBE functional and DZVP-GTH basis sets, coupled to the AMBER force field with electrostatic embedding. At this level a band of 16 images ran on 1024 cores, so the inputs are meant to be adapted to your own resources. GGA functionals such as PBE tend to underestimate reaction barriers, and the energies obtained here should be refined with more accurate methods (see the end of Section V).</p>

---

### Files

| Where | What |
|---|---|
| <a href="https://github.com/arvpinto/enzyme_neb_cp2k/tree/main/files/single_water" target="_blank">files/single_water</a>, <a href="https://github.com/arvpinto/enzyme_neb_cp2k/tree/main/files/assisting_water" target="_blank">files/assisting_water</a> | CP2K inputs (geo_opt.inp, MEP.inp, VIB.inp, dimer.inp), include files (forceeval_qmmm.cp2k.inc, fixed_atoms.inc), topologies (hpla2.prmtop.gz, hpla2_ee.prmtop.gz) and the final reactant, transition state and product (R.pdb.gz, TS.pdb.gz, P.pdb.gz); unpack with gunzip |
| <a href="https://github.com/arvpinto/enzyme_neb_cp2k/blob/main/cp2k_energy_analysis.py" target="_blank">cp2k_energy_analysis.py</a> | energies of a set of CP2K outputs (scan points, band replicas, optimizations, dimer) relative to a reference, as a table, CSV and plot |
| <a href="https://github.com/arvpinto/enzyme_neb_cp2k/blob/main/cp2k_band_evolution.py" target="_blank">cp2k_band_evolution.py</a> | energy profile of a band at every step, from the PROJECT-1.ener file |
| <a href="https://github.com/arvpinto/enzyme_neb_cp2k/blob/main/cp2k_vib_analysis.py" target="_blank">cp2k_vib_analysis.py</a> | frequencies of a vibrational analysis, atoms involved in a mode, animation of a mode and dimer vector |
| <a href="https://github.com/arvpinto/enzyme_neb_cp2k/releases/tag/cp2k_files" target="_blank">Release cp2k_files</a> | all the CP2K outputs, the starting coordinates, the band images and the dimer vectors |

<p align="justify">The scripts need Python 3 with NumPy, and Matplotlib for the plots; run any of them with -h to see all the options. The tools/ folder of the repository holds the scripts that made the figures, the movies and the data of the interactive panel of these pages.</p>

---

### Useful Links:

- <a href="https://github.com/bioexcel/cp2K_qmmm_tutorials_for_biological_simulations" target="_blank">QM/MM tutorials adapted to CP2K</a>
- <a href="https://docs.bioexcel.eu/qmmm_simulation_bpg/en/main/index.html" target="_blank">Best Practices in QM/MM Simulation of Biomolecular Systems</a>
- <a href="https://manual.cp2k.org/trunk/CP2K_INPUT/MOTION/BAND.html" target="_blank">CP2K manual: &BAND</a>, <a href="https://manual.cp2k.org/trunk/CP2K_INPUT/VIBRATIONAL_ANALYSIS.html" target="_blank">&VIBRATIONAL_ANALYSIS</a> and <a href="https://manual.cp2k.org/trunk/CP2K_INPUT/MOTION/GEO_OPT/TRANSITION_STATE/DIMER.html" target="_blank">&DIMER</a>
