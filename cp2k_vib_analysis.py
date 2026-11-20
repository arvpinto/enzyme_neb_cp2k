#!/usr/bin/env python3
"""
cp2k_vib_analysis.py

Tools for a CP2K VIBRATIONAL_ANALYSIS (full or MODE_SELECTIVE) of a QM/MM system:

  1. --out VIB.out          print the frequency list(s) found in the output
                            (imaginary frequencies are printed as negative numbers)
  2. --molden FILE --mode N read normal mode N from the Molden file written by
                            CP2K (PROJECT-VIBRATIONS-1.mol, section [FR-NORM-COORD])
       --top K              list the K atoms that move the most in that mode
       --animate            write a multi-frame XYZ or PDB file of the mode,
                            optionally restricted to the QM region
                            (--qmmm-inc forceeval_qmmm.cp2k.inc) or to a list of
                            atoms (--atoms), to watch it in VMD, PyMOL, ...
       --dimer-vector FILE  write the mode (all atoms, normalised) as the include
                            file of &MOTION/&GEO_OPT/&TRANSITION_STATE/&DIMER/&DIMER_VECTOR

The equilibrium coordinates are read from the Molden file ([FR-COORD] or
[Atoms]) or, if they are missing there, from --coords (PDB or XYZ with all the
atoms of the system, in the same order as in CP2K). With a PDB file the atom
and residue names are kept in the output and in the --top list.

Examples
    ./cp2k_vib_analysis.py --out VIB.out
    ./cp2k_vib_analysis.py --molden VIB-VIBRATIONS-1.mol --mode 1 --coords TS.pdb \\
        --qmmm-inc forceeval_qmmm.cp2k.inc --top 10 --animate --format pdb
    ./cp2k_vib_analysis.py --molden VIB-VIBRATIONS-1.mol --mode 1 --dimer-vector vector.inc
"""

import argparse
import math
import re
import sys
from pathlib import Path

BOHR = 0.529177210903


# ----------------------------------------------------------------------------- readers

def read_frequency_lists(path):
    """All 'FREQUENCY AND CONVERGENCE LIST' blocks (one per run) of a CP2K output.
    Returns a list of lists of (frequency, converged) tuples."""
    blocks, cur, inside = [], [], False
    with open(path, errors="replace") as fh:
        for line in fh:
            if "FREQUENCY AND CONVERGENCE LIST" in line:
                if cur:
                    blocks.append(cur)
                cur, inside = [], True
                continue
            if inside:
                s = line.strip()
                if s.startswith("VIB|"):
                    p = s.split()
                    cur.append((float(p[1]), p[-1] == "YES"))
                elif cur and not s.startswith("FREQUENCY"):
                    inside = False
    if cur:
        blocks.append(cur)
    # plain (non mode-selective) runs only print "VIB|Frequency (cm^-1)" lines
    if not blocks:
        freqs = []
        with open(path, errors="replace") as fh:
            for line in fh:
                if line.strip().startswith("VIB|Frequency"):
                    freqs += [(float(x), True) for x in line.split(")")[-1].split()]
        if freqs:
            blocks.append(freqs)
    return blocks


def read_molden(path):
    """Return dict with 'coords' (list of (elem, x, y, z) in Angstrom or None),
    'freqs' (list or None) and 'modes' {number: [(dx, dy, dz), ...]}."""
    coords, freqs, modes, coord_tag = None, None, {}, None
    section, unit_au, cur_mode = None, False, None
    with open(path, errors="replace") as fh:
        for raw in fh:
            line = raw.strip()
            if not line:
                continue
            if line.startswith("["):
                tag = line.split("]")[0][1:].upper()
                section = tag
                # [FR-COORD] (bohr) is preferred; [Atoms] (Angstrom or AU) only if it is missing
                if tag == "FR-COORD" or (tag == "ATOMS" and coords is None):
                    coords, coord_tag = [], tag
                    unit_au = tag == "FR-COORD" or "AU" in line.upper().split("]")[-1]
                elif tag == "FREQ":
                    freqs = []
                continue
            if section in ("ATOMS", "FR-COORD") and coords is not None and section == coord_tag:
                p = line.split()
                xyz = [float(v) for v in p[-3:]]
                if unit_au:
                    xyz = [v * BOHR for v in xyz]
                coords.append((p[0], *xyz))
            elif section == "FREQ":
                freqs.append(float(line.split()[0]))
            elif section == "FR-NORM-COORD":
                if line.lower().startswith("vibration"):
                    cur_mode = int(line.split()[-1])
                    modes[cur_mode] = []
                elif cur_mode is not None:
                    modes[cur_mode].append(tuple(float(v) for v in line.split()[:3]))
    return {"coords": coords or None, "freqs": freqs, "modes": modes}


def read_coords(path):
    """Coordinates of a PDB (ATOM/HETATM, first model) or XYZ file.
    Returns a list of dicts with elem, x, y, z and (PDB only) name, resname, resid."""
    atoms = []
    if Path(path).suffix.lower() == ".pdb":
        with open(path) as fh:
            for line in fh:
                if line.startswith(("ATOM", "HETATM")):
                    name = line[12:16].strip()
                    elem = line[76:78].strip() or re.sub(r"[^A-Za-z]", "", name)[:1]
                    if len(elem) == 2 and not name.upper().startswith(elem.upper()):
                        elem = name[:1]   # e.g. a carbon named C32 written with element "CA"
                    atoms.append({"elem": elem.capitalize(), "name": name, "resname": line[17:21].strip(),
                                  "resid": line[22:27].strip(), "x": float(line[30:38]),
                                  "y": float(line[38:46]), "z": float(line[46:54])})
                elif line.startswith(("ENDMDL", "END")) and atoms:
                    break
    else:
        with open(path) as fh:
            n = int(fh.readline().split()[0])
            fh.readline()
            for _ in range(n):
                p = fh.readline().split()
                atoms.append({"elem": p[0], "x": float(p[1]), "y": float(p[2]), "z": float(p[3])})
    return atoms


def qm_indices_from_inc(path):
    """1-based MM_INDEX values of all &QM_KIND sections (sorted)."""
    txt = Path(path).read_text()
    idx = []
    for body in re.findall(r"&QM_KIND\s+\S+(.*?)&END", txt, flags=re.S | re.I):
        for m in re.finditer(r"MM_INDEX([\d\s]+)", body, flags=re.I):
            idx += [int(v) for v in m.group(1).split()]
    if not idx:
        sys.exit(f"error: no &QM_KIND / MM_INDEX found in {path}")
    return sorted(set(idx))


def parse_atom_list(text):
    """'1981 34856 10-20' -> sorted list of 1-based indices."""
    out = set()
    for tok in re.split(r"[\s,]+", text.strip()):
        if not tok:
            continue
        if "-" in tok:
            a, b = tok.split("-")
            out.update(range(int(a), int(b) + 1))
        else:
            out.add(int(tok))
    return sorted(out)


# ----------------------------------------------------------------------------- writers

def write_xyz(path, frames, atoms, sel, comment):
    with open(path, "w") as fh:
        for k, fr in enumerate(frames):
            fh.write(f"{len(sel)}\n{comment}, frame {k + 1}\n")
            for i in sel:
                x, y, z = fr[i]
                fh.write(f"{atoms[i]['elem']:<3s} {x:12.6f} {y:12.6f} {z:12.6f}\n")


def write_pdb(path, frames, atoms, sel, comment):
    with open(path, "w") as fh:
        fh.write(f"REMARK   {comment}\n")
        for k, fr in enumerate(frames):
            fh.write(f"MODEL     {k + 1:4d}\n")
            for n, i in enumerate(sel, start=1):
                a = atoms[i]
                x, y, z = fr[i]
                name = a.get("name", a["elem"])
                name = f" {name:<3s}" if len(name) < 4 else name[:4]
                resid = str(a.get("resid", "1"))
                resid = resid[-4:] if len(resid) > 4 else resid
                fh.write(f"ATOM  {n % 100000:5d} {name} {a.get('resname', 'UNK')[:4]:<4s}X{resid:>4s}    "
                         f"{x:8.3f}{y:8.3f}{z:8.3f}  1.00  0.00          {a['elem']:>2s}\n")
            fh.write("ENDMDL\n")
        fh.write("END\n")


# ----------------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(
        description="Frequencies, normal-mode animations and dimer vectors from a CP2K vibrational analysis.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__.split("Examples", 1)[1],
    )
    ap.add_argument("--out", metavar="VIB.out", help="CP2K output: print the frequency list(s)")
    ap.add_argument("--nfreq", type=int, default=10, help="number of frequencies printed per run (default: 10)")
    ap.add_argument("--molden", metavar="FILE", help="Molden file written by CP2K (PROJECT-VIBRATIONS-1.mol)")
    ap.add_argument("--mode", type=int, default=1, help="normal mode to analyse (default: 1, the lowest one)")
    ap.add_argument("--coords", metavar="FILE",
                    help="PDB or XYZ with the equilibrium coordinates of all atoms (if the Molden file has none)")
    sel = ap.add_mutually_exclusive_group()
    sel.add_argument("--qmmm-inc", metavar="FILE", help="restrict --top/--animate to the QM atoms of this include file")
    sel.add_argument("--atoms", metavar="LIST", help="restrict --top/--animate to these atoms (1-based, e.g. '1981 34856 600-700')")
    ap.add_argument("--top", type=int, default=0, metavar="K", help="list the K atoms with the largest displacement")
    ap.add_argument("--animate", action="store_true", help="write a multi-frame file of the mode")
    ap.add_argument("--format", choices=["xyz", "pdb"], default="xyz", help="format of the animation (default: xyz)")
    ap.add_argument("--frames", type=int, default=40, help="frames per vibration period (default: 40)")
    ap.add_argument("--cycles", type=int, default=1, help="number of periods written (default: 1)")
    ap.add_argument("--amplitude", type=float, default=0.5,
                    help="largest atomic displacement in the animation, in Angstrom (default: 0.5)")
    ap.add_argument("--prefix", default="VIB_MODE", help="prefix of the animation file (default: VIB_MODE)")
    ap.add_argument("--dimer-vector", metavar="FILE", help="write the mode as a CP2K DIMER_VECTOR include file")
    args = ap.parse_args()

    if not args.out and not args.molden:
        ap.error("nothing to do: give --out and/or --molden")

    if args.out:
        blocks = read_frequency_lists(args.out)
        if not blocks:
            print(f"# no frequencies found in {args.out}")
        for r, blk in enumerate(blocks, start=1):
            nimag = sum(1 for f, _ in blk if f < 0)
            print(f"# {args.out}: frequency list {r} of {len(blocks)} "
                  f"({len(blk)} modes, {nimag} imaginary)")
            print(f"{'MODE':>5}  {'FREQ/cm-1':>11}  CONVERGED")
            for i, (f, ok) in enumerate(blk[:args.nfreq], start=1):
                print(f"{i:>5d}  {f:>11.3f}  {'yes' if ok else 'no'}{'   <- imaginary' if f < 0 else ''}")

    if not args.molden:
        return

    mol = read_molden(args.molden)
    if args.mode not in mol["modes"]:
        sys.exit(f"error: mode {args.mode} not in {args.molden} (modes: {sorted(mol['modes'])})")
    vec = mol["modes"][args.mode]
    natom = len(vec)
    freq = None
    if mol["freqs"] and len(mol["freqs"]) >= args.mode:
        freq = mol["freqs"][args.mode - 1]
    print(f"# {args.molden}: mode {args.mode}"
          + (f" ({freq:.2f} cm-1)" if freq is not None else "") + f", {natom} atoms")

    atoms = None
    if args.coords:
        atoms = read_coords(args.coords)
    elif mol["coords"]:
        atoms = [{"elem": e.capitalize(), "x": x, "y": y, "z": z} for e, x, y, z in mol["coords"]]
    if atoms is not None and len(atoms) != natom:
        sys.exit(f"error: {len(atoms)} atoms in the coordinates but {natom} in the mode")

    if args.qmmm_inc:
        sel = [i - 1 for i in qm_indices_from_inc(args.qmmm_inc)]
    elif args.atoms:
        sel = [i - 1 for i in parse_atom_list(args.atoms)]
    else:
        sel = list(range(natom))
    if max(sel) >= natom:
        sys.exit(f"error: atom index {max(sel) + 1} larger than the number of atoms ({natom})")

    norm = math.sqrt(sum(dx * dx + dy * dy + dz * dz for dx, dy, dz in vec))
    if args.top:
        mags = sorted(((math.sqrt(sum(c * c for c in vec[i])) / norm, i) for i in sel), reverse=True)
        print(f"{'ATOM':>7}  {'NAME':<5} {'RES':<5} {'RESID':>6}  {'|d|':>7}")
        for m, i in mags[:args.top]:
            a = atoms[i] if atoms else {}
            print(f"{i + 1:>7d}  {a.get('name', a.get('elem', '?')):<5} {a.get('resname', ''):<5} "
                  f"{str(a.get('resid', '')):>6}  {m:7.4f}")

    if args.dimer_vector:
        with open(args.dimer_vector, "w") as fh:
            for dx, dy, dz in vec:
                fh.write(f"{dx / norm:14.6f} {dy / norm:14.6f} {dz / norm:14.6f}\n")
        print(f"# dimer vector ({natom} atoms, normalised) written to {args.dimer_vector}")

    if args.animate:
        if atoms is None:
            sys.exit("error: --animate needs coordinates (--coords, or a Molden file with [FR-COORD])")
        dmax = max(math.sqrt(sum(c * c for c in vec[i])) for i in sel)
        scale = args.amplitude / dmax if dmax > 0 else 0.0
        nfr = args.frames * args.cycles
        frames = []
        for k in range(nfr):
            s = scale * math.sin(2.0 * math.pi * k / args.frames)
            fr = {}
            for i in sel:
                a = atoms[i]
                fr[i] = (a["x"] + s * vec[i][0], a["y"] + s * vec[i][1], a["z"] + s * vec[i][2])
            frames.append(fr)
        out = f"{args.prefix}_{args.mode}.{args.format}"
        comment = f"mode {args.mode}" + (f" ({freq:.2f} cm-1)" if freq is not None else "") + \
                  f", max displacement {args.amplitude} A"
        (write_pdb if args.format == "pdb" else write_xyz)(out, frames, atoms, sel, comment)
        print(f"# {nfr} frames of {len(sel)} atoms written to {out}")


if __name__ == "__main__":
    main()
