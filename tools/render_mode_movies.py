#!/usr/bin/env python3
"""
render_mode_movies.py

Movies of the imaginary normal mode of each transition state (Section IV):
the residues of the QM region of TS.pdb around the reacting atoms, displaced
along mode 1 of the Molden file of the vibrational analysis, drawn in
ball-and-stick with VMD-like colours by 3Dmol.js in headless Chrome (same style
as the interactive panel of Section III), with the bonds that form or break as
dashed yellow lines, and encoded with ffmpeg as H.264 MP4 (looping one period),
in a dark and a light version, plus a poster image of the first frame.

Needs: playwright (Python) with a Chromium/Chrome browser, ffmpeg.

Example
    python3 tools/render_mode_movies.py --data-dir ../cp2k_files --out-dir assets/media \\
        --chrome /usr/bin/google-chrome
"""

import argparse
import asyncio
import base64
import json
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))
from cp2k_vib_analysis import read_molden, read_coords, qm_indices_from_inc, read_frequency_lists  # noqa: E402
from build_neb_panel_data import best_view, focus_atoms  # noqa: E402

PAGE = """<!DOCTYPE html><html><head><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:#000}#v{position:relative;width:%(width)dpx;height:%(height)dpx}</style>
<script>%(lib)s</script><script>%(mol)s</script></head>
<body><div id="v"></div></body></html>"""


def frames_pdb(atoms, sel, frames):
    """Multi-model PDB text of the selected atoms (as read by QMMol.parsePDBFrames)."""
    out = []
    for fr in frames:
        for n, i in enumerate(sel):
            a = atoms[i]
            x, y, z = fr[n]
            name = a.get("name", a["elem"])
            name = f" {name:<3s}" if len(name) < 4 else name[:4]
            out.append(f"ATOM  {n + 1:5d} {name} {a.get('resname', 'UNK')[:4]:<4s}X{str(a.get('resid', '1'))[-4:]:>4s}    "
                       f"{x:8.3f}{y:8.3f}{z:8.3f}  1.00  0.00          {a['elem']:>2s}")
        out.append("END")
    return "\n".join(out) + "\n"


async def render(page_html, jobs, width, height, chrome):
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        kw = {"args": ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]}
        if chrome:
            kw["executable_path"] = chrome
        browser = await p.chromium.launch(**kw)
        page = await browser.new_page(viewport={"width": width, "height": height}, device_scale_factor=1)
        await page.set_content(page_html)
        await page.evaluate("""() => { window.V = $3Dmol.createViewer(document.getElementById('v'),
                                       {antialias: true}); }""")
        for job in jobs:
            await page.evaluate("""(j) => {
                window.J = j;
                window.M = QMMol.parsePDBFrames(j.pdb);
                window.M.X = QMMol.orient(window.M.frames, j.view);
                window.CORE = new Set(j.core);
            }""", job)
            for k in range(job["nframes"]):
                await page.evaluate("""(k) => {
                    const j = window.J, X = window.M.X[k];
                    QMMol.draw(window.V, window.M, X, {keys: j.keys, light: j.light, visible: new Set(j.focus),
                                                       showDistances: false});
                    // the same view for every frame (and for both colour versions)
                    if (k === 0) { window.V.zoomTo({index: j.focus}); window.V.zoom(j.zoom);
                                   window.VIEW = window.V.getView(); }
                    else { window.V.setView(window.VIEW); }
                    window.V.render();
                }""", k)
                png = await page.evaluate("() => window.V.pngURI()")
                Path(job["dir"], f"f{k:04d}.png").write_bytes(base64.b64decode(png.split(",", 1)[1]))
        await browser.close()


def main():
    ap = argparse.ArgumentParser(description="Movies of the imaginary mode of each TS (QM region).")
    ap.add_argument("--data-dir", required=True, help="folder with one sub-folder per pathway (TS.pdb, Molden file, ...)")
    ap.add_argument("--config", default=str(HERE / "pathways.json"), help="pathway definitions (default: tools/pathways.json)")
    ap.add_argument("--out-dir", default="assets/media", help="output folder (default: assets/media)")
    ap.add_argument("--width", type=int, default=960, help="movie width in pixels (default: 960)")
    ap.add_argument("--height", type=int, default=720, help="movie height in pixels (default: 720)")
    ap.add_argument("--frames", type=int, default=60, help="frames per period (default: 60)")
    ap.add_argument("--fps", type=int, default=30, help="frames per second (default: 30)")
    ap.add_argument("--amplitude", type=float, default=0.45,
                    help="largest displacement of a QM atom, in Angstrom (default: 0.45)")
    ap.add_argument("--zoom", type=float, default=1.05, help="zoom after fitting the atoms around the reaction (default: 1.05)")
    ap.add_argument("--crf", type=int, default=22, help="x264 quality (default: 22)")
    ap.add_argument("--chrome", default=None, help="Chrome/Chromium executable (default: the one of playwright)")
    args = ap.parse_args()

    if not shutil.which("ffmpeg"):
        sys.exit("error: ffmpeg not found")
    cfg = json.loads(Path(args.config).read_text())
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    lib = (ROOT / "assets/js/3Dmol-min.js").read_text()
    mol_js = (ROOT / "assets/js/qmmm-mol.js").read_text()
    html = PAGE % {"width": args.width, "height": args.height, "lib": lib, "mol": mol_js}

    tmp = Path(tempfile.mkdtemp(prefix="modes_"))
    jobs = []
    for p in cfg["pathways"]:
        d = Path(args.data_dir) / p["dir"]
        atoms = read_coords(d / p["ts_pdb"])
        mol = read_molden(d / p["molden"])
        vec = np.array(mol["modes"][1])
        if len(vec) != len(atoms):
            sys.exit(f"error: {len(vec)} atoms in the mode, {len(atoms)} in {p['ts_pdb']}")
        qm = [i - 1 for i in qm_indices_from_inc(d / p["qmmm_inc"])]
        pos = {a + 1: n for n, a in enumerate(qm)}
        X0 = np.array([[atoms[i]["x"], atoms[i]["y"], atoms[i]["z"]] for i in qm])
        V = vec[qm]
        vmax = np.linalg.norm(V, axis=1).max()
        U = V / vmax                                     # largest QM displacement = 1
        freq = read_frequency_lists(d / p["vib_output"])[-1][0][0]

        keys = [{"a": pos[k["atoms"][0]], "b": pos[k["atoms"][1]], "label": k["label"]} for k in p["keys"]]
        key_atoms = sorted({x for k in keys for x in (k["a"], k["b"])})
        meta = [{"resn": atoms[i].get("resname", ""), "resi": atoms[i].get("resid", ""), "el": atoms[i]["elem"]}
                for i in qm]
        focus = focus_atoms(meta, [X0], key_atoms, extra=[pos[x] for x in p.get("extra_core_atoms", [])])
        centre = X0[key_atoms].mean(axis=0)
        R = best_view([X0], [0], keys, key_atoms, [pos[x] for x in p.get("extra_core_atoms", [])],
                      centre, occluders=focus)

        ph = [2 * math.pi * k / args.frames for k in range(args.frames)]
        frames = [X0 + args.amplitude * math.sin(t) * U for t in ph]
        pdb = frames_pdb(atoms, qm, frames)
        for light in (False, True):
            tag = f"mode_{p['key']}_{'light' if light else 'dark'}"
            fdir = tmp / tag
            fdir.mkdir()
            jobs.append({"tag": tag, "dir": str(fdir), "pdb": pdb, "nframes": args.frames, "light": light,
                         "view": {"centre": [float(c) for c in centre], "rotation": R.tolist()},
                         "keys": keys, "focus": focus, "zoom": args.zoom})
        print(f"{p['label']}: {len(qm)} QM atoms ({len(focus)} drawn), mode 1 = {freq:.1f} cm-1")

    asyncio.run(render(html, jobs, args.width, args.height, args.chrome))

    for job in jobs:
        mp4 = out_dir / f"{job['tag']}.mp4"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(args.fps),
                        "-i", str(Path(job["dir"]) / "f%04d.png"),
                        "-vf", f"scale={args.width}:{args.height}:flags=lanczos", "-c:v", "libx264", "-preset", "veryfast",
                        "-crf", str(args.crf), "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(mp4)],
                       check=True)
        poster = out_dir / f"{job['tag']}.jpg"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(Path(job["dir"]) / "f0000.png"),
                        "-vf", f"scale={args.width}:{args.height}:flags=lanczos", "-q:v", "3", str(poster)], check=True)
        print(f"written {mp4} ({mp4.stat().st_size / 1024:.0f} kB) and {poster}")
    shutil.rmtree(tmp)


if __name__ == "__main__":
    main()
