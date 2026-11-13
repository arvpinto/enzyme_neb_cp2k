#!/usr/bin/env python3
"""
cp2k_band_evolution.py

Follow a CP2K band calculation (RUN_TYPE BAND: NEB, IT-NEB, CI-NEB) through
its energy file, PROJECT-1.ener. Each line of that file holds

    step   E(replica 1) ... E(replica N)   d(1,2) ... d(N-1,N)

(energies in Hartree; d = distance between adjacent replicas as reported by
CP2K in the DISTANCES REP block of the main output, in atomic units).

The script prints the energy profile of the last step (or of any step),
flags the highest image and the largest gap between adjacent replicas, and
plots how the profile changed from step to step.

Examples
    ./cp2k_band_evolution.py CI_NEB-1.ener
    ./cp2k_band_evolution.py CI_NEB-1.ener --ref-out geo_opt.out --plot band.png
    ./cp2k_band_evolution.py CI_NEB-1.ener --step 0 --x distance
"""

import argparse
import re
import sys

import numpy as np

HARTREE = {"kcal": 627.509474, "kj": 2625.499639, "ev": 27.211386}
UNIT_LABEL = {"kcal": "kcal/mol", "kj": "kJ/mol", "ev": "eV"}
RE_FE = re.compile(r"ENERGY\|\s+Total FORCE_EVAL\s+\(\s*\w+\s*\)\s+energy\s+\[a\.u\.\]:\s+(\S+)")


def read_ener(path):
    rows = []
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            rows.append([float(x) for x in line.split()])
    if not rows:
        sys.exit(f"error: {path} is empty")
    ncol = {len(r) for r in rows}
    if len(ncol) != 1:
        sys.exit(f"error: lines of {path} have different numbers of columns: {sorted(ncol)}")
    ncol = ncol.pop()
    if ncol % 2:
        sys.exit(f"error: {ncol} columns found; expected 1 + N energies + (N-1) distances")
    data = np.array(rows)
    n = ncol // 2
    return data[:, 0].astype(int), data[:, 1:n + 1], data[:, n + 1:]


def last_energy(out):
    e = None
    with open(out, errors="replace") as fh:
        for line in fh:
            m = RE_FE.search(line)
            if m:
                e = float(m.group(1))
    if e is None:
        sys.exit(f"error: no 'Total FORCE_EVAL' energy in {out}")
    return e


def main():
    ap = argparse.ArgumentParser(
        description="Energy profile of a CP2K band (NEB/CI-NEB) run from its PROJECT-1.ener file.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__.split("Examples", 1)[1],
    )
    ap.add_argument("ener", help="band energy file (e.g. CI_NEB-1.ener)")
    ap.add_argument("--step", type=int, default=None,
                    help="band step to tabulate (default: the last one in the file)")
    ref = ap.add_mutually_exclusive_group()
    ref.add_argument("--ref-image", type=int, default=1, metavar="I",
                     help="replica used as the zero of energy (default: 1)")
    ref.add_argument("--ref-out", metavar="OUT",
                     help="CP2K output whose last energy is the zero (e.g. the reactant geo_opt.out)")
    ref.add_argument("--ref-energy", type=float, metavar="E_HA", help="reference energy in Hartree")
    ap.add_argument("--unit", choices=list(HARTREE), default="kcal", help="energy unit (default: kcal)")
    ap.add_argument("--x", choices=["image", "distance"], default="image",
                    help="x axis of the plot: replica number or cumulative distance along the band (default: image)")
    ap.add_argument("--plot", metavar="FILE", help="save a plot of the profile at every step")
    ap.add_argument("--dpi", type=int, default=600, help="resolution of the saved figure (default: 600)")
    ap.add_argument("--title", default=None, help="title of the plot")
    ap.add_argument("--no-show", action="store_true", help="do not open a window with the plot (only save it)")
    args = ap.parse_args()

    steps, E, D = read_ener(args.ener)
    nrep = E.shape[1]
    conv = HARTREE[args.unit]
    u = UNIT_LABEL[args.unit]

    if args.step is None:
        k = len(steps) - 1
    else:
        hits = np.where(steps == args.step)[0]
        if not len(hits):
            sys.exit(f"error: step {args.step} not in {args.ener} (steps: {steps.min()}-{steps.max()})")
        k = hits[-1]

    if args.ref_out:
        e0, ref_name = last_energy(args.ref_out), args.ref_out
    elif args.ref_energy is not None:
        e0, ref_name = args.ref_energy, f"{args.ref_energy:.9f} Ha"
    else:
        if not 1 <= args.ref_image <= nrep:
            sys.exit(f"error: --ref-image must be between 1 and {nrep}")
        e0, ref_name = E[k, args.ref_image - 1], f"replica {args.ref_image}"

    dE = (E - e0) * conv
    print(f"# {args.ener}: {nrep} replicas, {len(steps)} band steps (step {steps[0]} to {steps[-1]})")
    print(f"# profile of step {steps[k]}; reference: {ref_name}")
    print(f"{'IMAGE':>5}  {'E/Ha':>18}  {'dE/' + u:>14}  {'d(i,i+1)/a.u.':>14}")
    for i in range(nrep):
        dist = f"{D[k, i]:>14.4f}" if i < nrep - 1 else f"{'':>14}"
        print(f"{i + 1:>5d}  {E[k, i]:>18.9f}  {dE[k, i]:>14.2f}  {dist}")
    imax = int(np.argmax(dE[k, 1:-1])) + 1   # interior images only (the climbing image is never an end point)
    jgap = int(np.argmax(D[k]))
    print(f"# highest interior image: {imax + 1} ({dE[k, imax]:.2f} {u})")
    print(f"# largest gap between adjacent images: {jgap + 1}-{jgap + 2} ({D[k, jgap]:.3f} a.u.; "
          f"mean {D[k].mean():.3f} a.u.)")
    if k > 0:
        change = np.abs(dE[k] - dE[k - 1]).max()
        print(f"# largest energy change of a replica since the previous step ({steps[k - 1]}): {change:.3f} {u}")

    if args.plot:
        import matplotlib
        if args.no_show:
            matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        fig, ax = plt.subplots(figsize=(6.4, 4.0))
        cmap = plt.get_cmap("viridis")
        for j in range(len(steps)):
            x = np.arange(1, nrep + 1) if args.x == "image" else np.concatenate([[0.0], np.cumsum(D[j])])
            last = j == len(steps) - 1
            ax.plot(x, dE[j], "-", color="#1f3b73" if last else cmap(j / max(1, len(steps) - 1)),
                    lw=2.0 if last else 0.9, alpha=1.0 if last else 0.55, zorder=3 if last else 2,
                    marker="o" if last else None, ms=4.5)
        xk = np.arange(1, nrep + 1) if args.x == "image" else np.concatenate([[0.0], np.cumsum(D[-1])])
        ax.plot(xk[imax], dE[-1, imax], "o", ms=11, mfc="none", mec="#d1495b", mew=1.5, zorder=4)
        sm = plt.cm.ScalarMappable(cmap=cmap, norm=plt.Normalize(steps[0], steps[-1]))
        cb = fig.colorbar(sm, ax=ax, pad=0.02)
        cb.set_label("Band step")
        ax.axhline(0, color="0.75", lw=0.8, zorder=0)
        if args.x == "image":
            ax.set_xticks(range(1, nrep + 1))
            ax.set_xlabel("Image")
        else:
            ax.set_xlabel("Distance along the band (a.u.)")
        ax.set_ylabel(f"$\\Delta E$ ({u})")
        if args.title:
            ax.set_title(args.title)
        for side in ("top", "right"):
            ax.spines[side].set_visible(False)
        fig.tight_layout()
        fig.savefig(args.plot, dpi=args.dpi)
        print(f"# figure saved to {args.plot} ({args.dpi} dpi)")
        if not args.no_show:
            if matplotlib.get_backend().lower() in ("agg", "pdf", "svg", "ps", "cairo"):
                print("# no display available: the figure was only saved", file=sys.stderr)
            else:
                plt.show()


if __name__ == "__main__":
    main()
