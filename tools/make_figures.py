#!/usr/bin/env python3
"""
make_figures.py

Static figures of the tutorial pages, from assets/data/neb_panel.json (written
by build_neb_panel_data.py) and tools/pathways.json:

  assets/img/neb_energy_geometry.png   CI-NEB energy profile and key distances of
                                       every image, for both pathways (Section III)
  assets/img/energy_diagram.png        R / TS / P energies of both pathways (Section V)

The band-evolution figures of Section III are made with cp2k_band_evolution.py.
Every figure is shown on screen (unless --no-show) and saved at --dpi (600).

Example
    python3 tools/make_figures.py --no-show
"""

import argparse
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

NAVY, RED, TEAL, AMBER, PURPLE, BLUE, GREY = "#1f3b73", "#d1495b", "#2a9d8f", "#e09f3e", "#6d597a", "#3a86ff", "#8d99ae"
KEY_COLOURS = [NAVY, RED, TEAL, AMBER, PURPLE, BLUE]


def style(ax):
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    ax.tick_params(labelsize=8)


def tex(label):
    """Plain key label -> mathtext with subscripts (OW1 -> O$_{W1}$, Nδ1 -> N$_{δ1}$)."""
    out = label
    for a, b in (("OW1", "O$_{W1}$"), ("OW2", "O$_{W2}$"), ("OW", "O$_{W}$"), ("Nδ1", r"N$_{\delta 1}$")):
        out = out.replace(a, b)
    return out.replace("···", r"$\cdots$")


def main():
    ap = argparse.ArgumentParser(description="Static figures of the tutorial.")
    ap.add_argument("--panel", default=str(ROOT / "assets/data/neb_panel.json"), help="panel data (default: assets/data/neb_panel.json)")
    ap.add_argument("--config", default=str(HERE / "pathways.json"), help="pathway definitions (default: tools/pathways.json)")
    ap.add_argument("--out-dir", default=str(ROOT / "assets/img"), help="output folder (default: assets/img)")
    ap.add_argument("--dpi", type=int, default=600, help="resolution (default: 600)")
    ap.add_argument("--no-show", action="store_true", help="only save the figures")
    args = ap.parse_args()

    import matplotlib
    if args.no_show:
        matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.rcParams.update({"font.family": "DejaVu Sans", "axes.titlesize": 10, "axes.labelsize": 9})

    panel = json.loads(Path(args.panel).read_text())
    cfg = {p["key"]: p for p in json.loads(Path(args.config).read_text())["pathways"]}
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    pws = panel["pathways"]

    # ------------------------------------------------ energies + key distances
    fig, axes = plt.subplots(2, len(pws), figsize=(7.6, 5.6), sharex="col",
                             gridspec_kw={"height_ratios": [1, 1.25]})
    for c, p in enumerate(pws):
        x = list(range(1, p["nimages"] + 1))
        top = p["highest_image"]
        ax = axes[0, c]
        ax.axhline(0, color="0.8", lw=0.8, zorder=0)
        ax.axhline(p["ts_dimer"], color=RED, lw=1.0, ls="--", zorder=1)
        ax.text(x[-1], p["ts_dimer"] + 0.6, f"dimer TS {p['ts_dimer']:.1f}", color=RED, fontsize=7.5, ha="right", va="bottom")
        ax.plot(x, p["energies"], "-o", color=NAVY, lw=1.6, ms=3.8, zorder=3)
        ax.plot(top, p["energies"][top - 1], "o", ms=9, mfc="none", mec=RED, mew=1.3, zorder=4)
        ax.set_title(p["label"], fontweight="bold")
        ax.set_ylabel(r"$\Delta E$ (kcal/mol)")
        lo = min(p["energies"] + [0]) - 2
        ax.set_ylim(lo, max(p["energies"] + [p["ts_dimer"]]) + 3)
        style(ax)
        ax = axes[1, c]
        ax.axvline(top, color=RED, lw=0.8, alpha=0.35, zorder=0)
        for k, key in enumerate(p["keys"]):
            ax.plot(x, key["d"], "-o", ms=2.8, lw=1.3, color=KEY_COLOURS[k % len(KEY_COLOURS)], label=tex(key["label"]))
        ax.set_ylabel(r"Distance ($\mathrm{\AA}$)")
        ax.set_xlabel("Image")
        ax.set_xticks(x[::1] if len(x) <= 16 else x[::2])
        ax.legend(fontsize=7, frameon=False, ncol=2, loc="upper center", bbox_to_anchor=(0.5, -0.2))
        style(ax)
    fig.tight_layout()
    f1 = out / "neb_energy_geometry.png"
    fig.savefig(f1, dpi=args.dpi, facecolor="white")
    print(f"saved {f1} ({args.dpi} dpi)")

    # ------------------------------------------------ R / TS / P diagram
    fig, ax = plt.subplots(figsize=(6.2, 3.9))
    cols = {pws[0]["key"]: NAVY, pws[-1]["key"]: RED}
    w = 0.15
    for n, p in enumerate(pws):
        pimg = cfg[p["key"]].get("product_image", p["nimages"])
        levels = [0.0, p["ts_dimer"], p["energies"][pimg - 1]]
        col = cols.get(p["key"], GREY)
        dx = (n - (len(pws) - 1) / 2) * 0.36
        for i, e in enumerate(levels):
            ax.plot([i - w + dx, i + w + dx], [e, e], color=col, lw=2.8, solid_capstyle="butt",
                    label=p["label"] if i == 0 else None)
            if i:
                ax.plot([i - 1 + w + dx, i - w + dx], [levels[i - 1], e], color=col, lw=0.9, ls=":")
            below = e < 0
            ax.text(i + dx, e + (-0.6 if below else 0.6), f"{e:.1f}".replace("-", "\u2212"), color=col,
                    ha="center", va="top" if below else "bottom", fontsize=8.5, fontweight="bold")
    ax.set_xticks([0, 1, 2])
    ax.set_xticklabels(["R", "TS", "P"], fontsize=10)
    ax.set_xlim(-0.55, 2.55)
    ax.set_ylabel(r"$\Delta E$ (kcal/mol)")
    ax.axhline(0, color="0.85", lw=0.8, zorder=0)
    ax.legend(frameon=False, fontsize=8.5, loc="lower left")
    style(ax)
    ax.spines["bottom"].set_visible(False)
    ax.tick_params(axis="x", length=0)
    fig.tight_layout()
    f2 = out / "energy_diagram.png"
    fig.savefig(f2, dpi=args.dpi, facecolor="white")
    print(f"saved {f2} ({args.dpi} dpi)")

    if not args.no_show:
        plt.show()


if __name__ == "__main__":
    main()
