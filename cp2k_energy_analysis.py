#!/usr/bin/env python3
"""
cp2k_energy_analysis.py

Energy decomposition of a set of CP2K QM/MM outputs (geometry optimizations,
PES scan points, the replica outputs of a CI-NEB run, a dimer run, ...).

For every output the script reads the LAST force evaluation (for a converged
geometry optimization or dimer run, the energy CP2K re-evaluates at the final
geometry) and reports

    E_T        total QM/MM energy       "ENERGY| Total FORCE_EVAL ( QMMM ) energy [a.u.]:"
    E_QM       QM energy, including the QM/MM electrostatic coupling
               (last "Total energy:" line of the SCF that belongs to that
               force evaluation)
    E_MM       E_T - E_QM (MM energy, including the MM part of the QM/MM
               van der Waals and bonded terms)

and the differences of the three terms with respect to a reference, in
kcal/mol (or kJ/mol / eV). The reference is the first output after sorting,
any output of the list (--ref-index), another CP2K output (--ref), e.g. the
optimized reactant, or an energy given in Hartree (--ref-energy).

Examples
    ./cp2k_energy_analysis.py CI_NEB-BAND*.out
    ./cp2k_energy_analysis.py CI_NEB-BAND*.out --ref geo_opt.out --plot neb_energy.png
    ./cp2k_energy_analysis.py scan_*.out --reverse --csv scan.csv
"""

import argparse
import csv
import math
import re
import sys
from pathlib import Path

HARTREE = {"kcal": 627.509474, "kj": 2625.499639, "ev": 27.211386}
UNIT_LABEL = {"kcal": "kcal/mol", "kj": "kJ/mol", "ev": "eV"}

RE_FE = re.compile(r"ENERGY\|\s+Total FORCE_EVAL\s+\(\s*\w+\s*\)\s+energy\s+\[a\.u\.\]:\s+(\S+)")
RE_QM = re.compile(r"^\s+Total energy:\s+(\S+)")


def parse_output(path):
    """Return (number of force evaluations, E_T, E_QM).

    The energies are those of the last force evaluation, except for converged
    geometry optimizations (including dimer TS searches), where CP2K re-evaluates
    the energy at the converged geometry ("Reevaluating energy at the minimum"):
    the first force evaluation after that line is used, because a dimer run
    still evaluates the rotated dimer images afterwards. Replica outputs of a band
    run (CI_NEB-BAND*.out) always give the last force evaluation: with
    USE_COLVARS they contain one constrained geometry optimization per band step,
    and the band energy is the evaluation that follows it."""
    n_fe = 0
    e_t = e_qm_last_fe = e_qm_running = None
    final, reeval, band = None, False, False
    with open(path, "r", errors="replace") as fh:
        for line in fh:
            if "BAND EVALUATION OF ENERGIES AND FORCES" in line:
                band = True
            if "Reevaluating energy at the minimum" in line:
                reeval, final = True, None
                continue
            m = RE_QM.match(line)
            if m:
                e_qm_running = float(m.group(1))
                continue
            m = RE_FE.search(line)
            if m:
                n_fe += 1
                e_t = float(m.group(1))
                e_qm_last_fe = e_qm_running
                e_qm_running = None
                if reeval and final is None:
                    final = (e_t, e_qm_last_fe)
                    reeval = False
    if e_t is None:
        raise ValueError(f"no 'Total FORCE_EVAL' energy found in {path}")
    if final is not None and not band:
        return n_fe, final[0], final[1]
    return n_fe, e_t, e_qm_last_fe


def natural_key(text):
    """Sort 'file_2' before 'file_10' and '2.75' before '3.00'."""
    parts = re.split(r"(\d+(?:\.\d+)?)", str(text))
    return [float(p) if re.fullmatch(r"\d+(?:\.\d+)?", p) else p.lower() for p in parts]


def short_label(name):
    """Short x-axis label: the last number in the file name, or the stem."""
    nums = re.findall(r"\d+(?:\.\d+)?", Path(name).stem)
    return nums[-1].lstrip("0") or "0" if nums else Path(name).stem


def fmt(x, width, prec):
    return f"{'n/a':>{width}}" if x is None or (isinstance(x, float) and math.isnan(x)) else f"{x:>{width}.{prec}f}"


def main():
    ap = argparse.ArgumentParser(
        description="Energy decomposition (total, QM+QM/MM, MM) of CP2K QM/MM outputs.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__.split("Examples", 1)[1] if "Examples" in __doc__ else None,
    )
    ap.add_argument("outputs", nargs="+", help="CP2K output files (e.g. CI_NEB-BAND*.out)")
    ap.add_argument("--sort", choices=["natural", "none"], default="natural",
                    help="order of the outputs: natural sort of the file names (default) or as given")
    ap.add_argument("--reverse", action="store_true", help="reverse the order (e.g. a scan run from large to small CV)")
    ref = ap.add_mutually_exclusive_group()
    ref.add_argument("--ref", metavar="OUT", help="CP2K output used as the zero of energy (e.g. the reactant geo_opt.out)")
    ref.add_argument("--ref-index", type=int, default=1, metavar="N",
                     help="use the N-th output of the (sorted) list as reference (default: 1)")
    ref.add_argument("--ref-energy", type=float, metavar="E_HA",
                     help="total energy (Hartree) used as reference; only the total is referenced, QM and MM are then given relative to the first output")
    ap.add_argument("--unit", choices=list(HARTREE), default="kcal", help="unit of the energy differences (default: kcal)")
    ap.add_argument("--csv", metavar="FILE", help="also write the table to a CSV file")
    ap.add_argument("--plot", metavar="FILE", help="plot the energy differences and save the figure (PNG, PDF, SVG, ...)")
    ap.add_argument("--dpi", type=int, default=600, help="resolution of the saved figure (default: 600)")
    ap.add_argument("--title", default=None, help="title of the plot")
    ap.add_argument("--xlabel", default="Output", help="x-axis label of the plot (default: Output)")
    ap.add_argument("--total-only", action="store_true", help="plot only the total energy")
    ap.add_argument("--no-show", action="store_true", help="do not open a window with the plot (only save it)")
    args = ap.parse_args()

    files = list(dict.fromkeys(args.outputs))
    if args.sort == "natural":
        files.sort(key=natural_key)
    if args.reverse:
        files.reverse()

    rows = []
    for f in files:
        try:
            n_fe, e_t, e_qm = parse_output(f)
        except (OSError, ValueError) as err:
            print(f"warning: {err}", file=sys.stderr)
            continue
        e_mm = e_t - e_qm if e_qm is not None else None
        rows.append({"file": f, "n_fe": n_fe, "E_T": e_t, "E_QM": e_qm, "E_MM": e_mm})
    if not rows:
        sys.exit("error: no energies could be read")

    conv = HARTREE[args.unit]
    if args.ref:
        _, rt, rq = parse_output(args.ref)
        ref_t, ref_qm = rt, rq
        ref_name = args.ref
    elif args.ref_energy is not None:
        ref_t, ref_qm = args.ref_energy, rows[0]["E_QM"]
        ref_name = f"{args.ref_energy:.9f} Ha"
    else:
        if not 1 <= args.ref_index <= len(rows):
            sys.exit(f"error: --ref-index must be between 1 and {len(rows)}")
        r = rows[args.ref_index - 1]
        ref_t, ref_qm, ref_name = r["E_T"], r["E_QM"], r["file"]
    ref_mm = ref_t - ref_qm if ref_qm is not None else None

    for r in rows:
        r["dE_T"] = (r["E_T"] - ref_t) * conv
        r["dE_QM"] = (r["E_QM"] - ref_qm) * conv if (r["E_QM"] is not None and ref_qm is not None) else None
        r["dE_MM"] = (r["E_MM"] - ref_mm) * conv if (r["E_MM"] is not None and ref_mm is not None) else None

    u = UNIT_LABEL[args.unit]
    w = max(len("OUTPUT"), max(len(Path(r["file"]).name) for r in rows))
    print(f"# reference: {ref_name}")
    head = (f"{'OUTPUT':<{w}}  {'N_FE':>5}  {'E_T/Ha':>18}  {'E_QM+QM/MM/Ha':>16}  {'E_MM/Ha':>16}  "
            f"{'dE_T/' + u:>14}  {'dE_QM+QM/MM/' + u:>20}  {'dE_MM/' + u:>15}")
    print(head)
    print("-" * len(head))
    for r in rows:
        print(f"{Path(r['file']).name:<{w}}  {r['n_fe']:>5d}  {r['E_T']:>18.9f}  {fmt(r['E_QM'], 16, 8)}  {fmt(r['E_MM'], 16, 8)}  "
              f"{r['dE_T']:>14.2f}  {fmt(r['dE_QM'], 20, 2)}  {fmt(r['dE_MM'], 15, 2)}")
    imax = max(range(len(rows)), key=lambda i: rows[i]["dE_T"])
    print("-" * len(head))
    print(f"# highest total energy: {Path(rows[imax]['file']).name} "
          f"({rows[imax]['dE_T']:.2f} {u} above the reference)")

    if args.csv:
        with open(args.csv, "w", newline="") as fh:
            wr = csv.writer(fh)
            wr.writerow(["output", "n_force_evals", "E_T_Ha", "E_QM_Ha", "E_MM_Ha",
                         f"dE_T_{args.unit}", f"dE_QM_{args.unit}", f"dE_MM_{args.unit}"])
            for r in rows:
                wr.writerow([r["file"], r["n_fe"], f"{r['E_T']:.12f}",
                             "" if r["E_QM"] is None else f"{r['E_QM']:.12f}",
                             "" if r["E_MM"] is None else f"{r['E_MM']:.12f}",
                             f"{r['dE_T']:.4f}",
                             "" if r["dE_QM"] is None else f"{r['dE_QM']:.4f}",
                             "" if r["dE_MM"] is None else f"{r['dE_MM']:.4f}"])
        print(f"# table written to {args.csv}")

    if args.plot:
        import matplotlib
        if args.no_show:
            matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        x = list(range(1, len(rows) + 1))
        fig, ax = plt.subplots(figsize=(6.4, 4.0))
        ax.axhline(0, color="0.75", lw=0.8, zorder=0)
        ax.plot(x, [r["dE_T"] for r in rows], "-o", color="#1f3b73", lw=1.8, ms=5, label=r"$\Delta E_{T}$", zorder=3)
        if not args.total_only and all(r["dE_QM"] is not None for r in rows):
            ax.plot(x, [r["dE_QM"] for r in rows], "--s", color="#d1495b", lw=1.2, ms=4, label=r"$\Delta E_{QM+QM/MM}$")
            ax.plot(x, [r["dE_MM"] for r in rows], ":^", color="#2a9d8f", lw=1.2, ms=4, label=r"$\Delta E_{MM}$")
        ax.plot(x[imax], rows[imax]["dE_T"], "o", ms=11, mfc="none", mec="#1f3b73", mew=1.4)
        ax.set_xticks(x)
        ax.set_xticklabels([short_label(r["file"]) for r in rows],
                           rotation=0 if len(rows) <= 20 else 90, fontsize=8)
        ax.set_xlabel(args.xlabel)
        ax.set_ylabel(f"$\\Delta E$ ({u})")
        if args.title:
            ax.set_title(args.title)
        ax.legend(frameon=False, fontsize=9)
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
