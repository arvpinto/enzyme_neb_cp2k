#!/usr/bin/env python3
"""
build_neb_panel_data.py

Builds the data of the interactive CI-NEB panel of Section III
(assets/data/neb_panel.json) and copies the band trajectories (QM region of
every image, one PDB model per image, ended by END) next to it.

For each pathway listed in tools/pathways.json it reads, from
--data-dir/<pathway dir>:
  * the band trajectory (*_traj.pdb, QM atoms in increasing MM_INDEX order),
  * forceeval_qmmm.cp2k.inc (to map CP2K atom numbers onto the trajectory),
  * the final energy of every replica (CI_NEB-BAND*.out),
  * the reference energy (geo_opt.out of the reactant),
  * the energy of the saddle point refined with the dimer method (dimer.out),
  * the imaginary frequency of the saddle point (last list in VIB.out).

Example
    python3 tools/build_neb_panel_data.py --data-dir ../cp2k_files --out-dir assets/data
"""

import argparse
import glob
import json
import re
import shutil
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from cp2k_energy_analysis import parse_output, natural_key  # noqa: E402
from cp2k_vib_analysis import read_frequency_lists, qm_indices_from_inc  # noqa: E402

HA2KCAL = 627.509474
RE_FE = re.compile(r"ENERGY\|\s+Total FORCE_EVAL\s+\(\s*\w+\s*\)\s+energy\s+\[a\.u\.\]:\s+(\S+)")
COV = {"H": 0.31, "C": 0.76, "N": 0.71, "O": 0.66, "P": 1.07, "S": 1.05}


def read_traj(path):
    meta, frames, cur = [], [], []
    with open(path) as fh:
        for line in fh:
            if line.startswith(("ATOM", "HETATM")):
                cur.append([float(line[30:38]), float(line[38:46]), float(line[46:54])])
                if not frames:
                    name = line[12:16].strip()
                    el = line[76:78].strip() or name[:1]
                    if len(el) == 2 and not name.upper().startswith(el.upper()):
                        el = name[:1]   # e.g. a carbon named C32 written with element "CA"
                    meta.append({"name": name, "resn": line[17:21].strip(), "resi": line[22:27].strip(),
                                 "el": el.capitalize()})
            elif line.startswith("END") and cur:
                frames.append(np.array(cur))
                cur = []
    if cur:
        frames.append(np.array(cur))
    return meta, frames


def dimer_ts_energy(path):
    """Energy of the dimer centre when CP2K reports convergence (first force
    evaluation after 'GEOMETRY OPTIMIZATION COMPLETED', i.e. the final point)."""
    energies, done, e_final = [], False, None
    with open(path, errors="replace") as fh:
        for line in fh:
            if "GEOMETRY OPTIMIZATION COMPLETED" in line:
                done = True
                continue
            m = RE_FE.search(line)
            if m:
                energies.append(float(m.group(1)))
                if done and e_final is None:
                    e_final = float(m.group(1))
    if e_final is None:
        raise SystemExit(f"error: dimer run in {path} did not converge")
    return e_final, len(energies)


def bonds(meta, X, factor=1.15):
    out = set()
    for i in range(len(meta)):
        ri = COV.get(meta[i]["el"])
        if ri is None:
            continue
        for j in range(i + 1, len(meta)):
            rj = COV.get(meta[j]["el"])
            if rj is None:
                continue
            if np.linalg.norm(X[i] - X[j]) < factor * (ri + rj):
                out.add((i, j))
    return out


def focus_atoms(meta, frames, key_atoms, residue_cut=3.3, atom_cut=4.5, max_res_size=25, extra=()):
    """Atoms shown in the 3D views: whole residues (up to max_res_size atoms, i.e.
    amino acids, waters, ions) with an atom within residue_cut of a reacting atom,
    and, for large residues (the lipid), the atoms within atom_cut of a reacting
    atom plus the hydrogens bonded to them, in any of the given frames, and the
    `extra` atoms (e.g. the Ca2+ ion)."""
    res = {}
    for i, m in enumerate(meta):
        res.setdefault((m["resn"], m["resi"]), []).append(i)
    keep = set(key_atoms) | set(extra)
    for X in frames:
        K = X[sorted(key_atoms)]
        d = np.linalg.norm(X[:, None, :] - K[None, :, :], axis=-1).min(axis=1)
        for members in res.values():
            if len(members) <= max_res_size:
                if d[members].min() < residue_cut:
                    keep.update(members)
            else:
                heavy = {i for i in members if d[i] < atom_cut and meta[i]["el"] != "H"}
                # drop atoms that would float alone (no bonded heavy atom kept)
                heavy = {i for i in heavy if i in key_atoms or any(
                    j != i and meta[j]["el"] != "H" and np.linalg.norm(X[i] - X[j]) < 1.9 for j in heavy)}
                keep.update(heavy)
                for i in heavy:
                    for j in members:
                        if meta[j]["el"] == "H" and np.linalg.norm(X[i] - X[j]) < 1.2:
                            keep.add(j)
    return sorted(keep)


def random_rotations(n, seed=7):
    rng = np.random.default_rng(seed)
    q = rng.normal(size=(n, 4))
    q /= np.linalg.norm(q, axis=1)[:, None]
    w, x, y, z = q.T
    return np.stack([
        np.stack([1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], -1),
        np.stack([2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], -1),
        np.stack([2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)], -1)], 1)


def best_view(frames, which, keys, key_atoms, behind, centre, n=6000, occluders=()):
    """Rotation matrix (rows = screen x, y and the axis towards the viewer) in which
    the reacting atoms and the midpoints of their bonds are as spread out as
    possible on the screen, the atoms in `behind` (Ca2+) stay behind the reaction
    centre, and few of the `occluders` (other atoms drawn) sit in front of a
    reacting atom."""
    best, best_R = -1e9, np.eye(3)
    rots = random_rotations(n)
    occ = [i for i in occluders if i not in set(key_atoms)]
    for R in rots:
        score = 1e9
        for f in which:
            X = (frames[f] - centre) @ R.T
            pts = [X[i] for i in key_atoms] + [(X[k["a"]] + X[k["b"]]) / 2 for k in keys]
            P = np.array(pts)[:, :2]
            d = np.linalg.norm(P[:, None] - P[None], axis=-1)
            s = d[np.triu_indices(len(P), 1)].min()
            for b in behind:   # Ca2+ (and other listed atoms) must not hide the centre
                if X[b, 2] > -1.0:
                    s -= 0.5 * (X[b, 2] + 1.0)
            if occ:
                K, O = X[key_atoms], X[occ]
                dxy = np.linalg.norm(O[:, None, :2] - K[None, :, :2], axis=-1)
                front = O[:, None, 2] > K[None, :, 2] + 0.5
                s -= 0.25 * np.count_nonzero((dxy < 1.2) & front)
            score = min(score, s)
        if score > best:
            best, best_R = score, R
    return best_R

def main():
    ap = argparse.ArgumentParser(description="Data of the interactive CI-NEB panel.")
    ap.add_argument("--data-dir", required=True, help="folder with one sub-folder per pathway (CP2K inputs and outputs)")
    ap.add_argument("--traj-dir", default=None, help="folder with the *_traj.pdb files (default: the pathway folders)")
    ap.add_argument("--config", default=str(HERE / "pathways.json"), help="pathway definitions (default: tools/pathways.json)")
    ap.add_argument("--out-dir", default="assets/data", help="output folder (default: assets/data)")
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text())
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    panel = {"unit": cfg.get("unit", "kcal/mol"), "pathways": []}

    for p in cfg["pathways"]:
        d = Path(args.data_dir) / p["dir"]
        traj = Path(args.traj_dir or d) / p["traj"]
        meta, frames = read_traj(traj)
        qm = qm_indices_from_inc(d / p["qmmm_inc"])
        if len(qm) != len(meta):
            raise SystemExit(f"error: {len(qm)} QM atoms in the include file, {len(meta)} in {traj}")
        pos = {a: i for i, a in enumerate(qm)}

        outs = sorted(glob.glob(str(d / p["band_outputs"])), key=natural_key)
        if len(outs) != len(frames):
            raise SystemExit(f"error: {len(outs)} replica outputs but {len(frames)} images in {traj}")
        e_img = [parse_output(f)[1] for f in outs]
        e_ref = parse_output(d / p["reference_output"])[1]
        e_ts, n_dimer = dimer_ts_energy(d / p["dimer_output"])
        freqs = read_frequency_lists(d / p["vib_output"])[-1]

        keys = []
        for k in p["keys"]:
            a, b = (pos[x] for x in k["atoms"])
            keys.append({"a": a, "b": b, "label": k["label"], "html": k["html"], "role": k["role"],
                         "d": [round(float(np.linalg.norm(f[a] - f[b])), 3) for f in frames]})

        # atoms drawn in ball-and-stick: key atoms, their bonded neighbours (first and
        # last image), listed residue side chains and extra atoms
        key_atoms = {i for k in keys for i in (k["a"], k["b"])}
        core = set(key_atoms) | {pos[x] for x in p.get("extra_core_atoms", [])}
        backbone = {"N", "H", "CA", "HA", "C", "O"}
        for res in p.get("core_residues", []):
            rn, ri = res.split()
            for i, m in enumerate(meta):
                if m["resn"] == rn and m["resi"] == ri and (rn == "CA" or m["name"] not in backbone):
                    core.add(i)
        for X in (frames[0], frames[-1]):
            for i, j in bonds(meta, X):
                if i in key_atoms:
                    core.add(j)
                if j in key_atoms:
                    core.add(i)

        # view: orientation in which the reacting atoms and the bonds between them are
        # as spread out on the screen as possible and hidden by few other atoms
        # (searched over random rotations, scored on the highest image, as for the
        # movies of the TSs), with the Ca2+ ion kept behind the reaction centre; an extra rotation can be added in the
        # configuration file (view_rotate_deg = [x, y, z], degrees, applied in that order)
        rel0 = [(e - e_ref) for e in e_img]
        top = int(np.argmax(rel0[1:-1])) + 1
        centre = frames[top][sorted(key_atoms)].mean(axis=0)
        focus = focus_atoms(meta, [frames[0], frames[top], frames[-1]], key_atoms,
                            extra=[pos[x] for x in p.get("extra_core_atoms", [])])
        R = best_view(frames, [top], keys, sorted(key_atoms),
                      [pos[x] for x in p.get("extra_core_atoms", [])], centre, occluders=focus)
        for ax, deg in zip("xyz", p.get("view_rotate_deg", [0, 0, 0])):
            t = np.radians(deg)
            c, s_ = np.cos(t), np.sin(t)
            M = {"x": [[1, 0, 0], [0, c, -s_], [0, s_, c]],
                 "y": [[c, 0, s_], [0, 1, 0], [-s_, 0, c]],
                 "z": [[c, -s_, 0], [s_, c, 0], [0, 0, 1]]}[ax]
            R = np.array(M) @ R

        named = {pos[int(k)]: v for k, v in p.get("named_atoms", {}).items()}
        rel = [round((e - e_ref) * HA2KCAL, 3) for e in e_img]
        imax = int(np.argmax(rel[1:-1])) + 1
        shutil.copyfile(traj, out_dir / p["traj"])
        panel["pathways"].append({
            "key": p["key"], "label": p["label"], "traj": p["traj"],
            "nimages": len(frames), "natoms": len(meta),
            "energies": rel,
            "energies_ha": [round(e, 9) for e in e_img],
            "reference_ha": round(e_ref, 9),
            "highest_image": imax + 1,
            "ts_dimer": round((e_ts - e_ref) * HA2KCAL, 3),
            "ts_dimer_ha": round(e_ts, 9),
            "ts_freq": freqs[0][0],
            "keys": keys,
            "core": sorted(core),
            "focus": focus,
            "named": {str(k): v for k, v in named.items()},
            "view": {"centre": [round(float(x), 4) for x in centre],
                     "rotation": [[round(float(x), 6) for x in row] for row in R]},
        })
        print(f"{p['label']}: {len(frames)} images, {len(meta)} QM atoms, highest image {imax + 1} "
              f"({rel[imax]:.2f} kcal/mol), dimer TS {(e_ts - e_ref) * HA2KCAL:.2f} kcal/mol "
              f"after {n_dimer} force evaluations, imaginary frequency {freqs[0][0]:.1f} cm-1")

    (out_dir / "neb_panel.json").write_text(json.dumps(panel, ensure_ascii=False, separators=(",", ":")))
    print(f"written {out_dir / 'neb_panel.json'}")


if __name__ == "__main__":
    main()
