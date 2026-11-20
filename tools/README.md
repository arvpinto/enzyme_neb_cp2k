# tools

Scripts that build the figures, movies and data of the tutorial pages (they are
not needed to follow the tutorial). They read the CP2K inputs and outputs of
both pathways from a folder with one sub-folder per pathway (`single_water/`,
`assisting_water/`, as in the release `cp2k_files`), plus the band trajectories
(`neb_*_traj.pdb`) and the Molden files of the vibrational analyses of the
transition states (`*_vib.mol`).

| Script | Output |
|---|---|
| `pathways.json` | definition of both pathways: files, atoms of the bonds that form or break, product image |
| `build_neb_panel_data.py` | `assets/data/neb_panel.json` and the band trajectories used by the interactive panel of Section III |
| `make_figures.py` | `assets/img/neb_key_distances.png` and `assets/img/energy_diagram.png` (600 dpi) |
| `render_mode_movies.py` | `assets/media/mode_*_{dark,light}.mp4` and posters (needs Playwright with Chrome/Chromium, and ffmpeg) |

The band-evolution figures of Section III (`assets/img/band_evolution_*.png`) are made
with `cp2k_band_evolution.py`, as shown on that page.

```bash
python3 tools/build_neb_panel_data.py --data-dir ../cp2k_files --out-dir assets/data
python3 tools/make_figures.py --no-show
python3 tools/render_mode_movies.py --data-dir ../cp2k_files --out-dir assets/media --chrome /usr/bin/google-chrome
```

The interactive panel and the movies draw the QM region with
[3Dmol.js](https://3dmol.csb.pitt.edu/) (`assets/js/3Dmol-min.js`, BSD 3-Clause
licence in `assets/js/3Dmol-LICENSE.txt`) through `assets/js/qmmm-mol.js`, so both
look the same.
