import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from pathlib import Path

EXCEL_PATH = (
    Path(__file__).parent.parent
    / "kWh Projected Savings"
    / "Efficiency Navigator Program - Data Support Group (2).xlsx"
)
OUTPUT_DIR = Path(__file__).parent
CO2_TOKENS = ["yearly", "co2", "emission", "saving"]
YLABEL = "Yearly CO2 Emissions Savings (kg)"


def resolve_co2_column(columns):
    for col in columns:
        if col.strip().lower() == "yearly co2 emissions savings (kg)":
            return col
    for col in columns:
        if all(t in col.lower() for t in CO2_TOKENS):
            return col
    raise KeyError(f"CO2 column not found. Available columns: {list(columns)}")


def load_co2_data(excel_path: Path) -> dict[str, pd.Series]:
    xls = pd.ExcelFile(excel_path)
    sheet_map = {"oei": None, "cdbg": None}

    for name in xls.sheet_names:
        lname = name.lower()
        if "oei" in lname:
            sheet_map["oei"] = name
        elif "cdbg" in lname or "arpa" in lname:
            sheet_map["cdbg"] = name

    missing = [k for k, v in sheet_map.items() if v is None]
    if missing:
        raise ValueError(
            f"Could not find sheets for: {missing}. Found: {xls.sheet_names}"
        )

    groups = {}
    for sheet_name in sheet_map.values():
        df = pd.read_excel(excel_path, sheet_name=sheet_name)
        col = resolve_co2_column(df.columns)
        series = df[col].dropna()
        groups[f"{sheet_name} (n={len(series)})"] = series

    return groups

def plot_boxplot(groups: dict[str, pd.Series]) -> plt.Figure:
    fig, ax = plt.subplots(figsize=(8, 6))
    ax.boxplot(list(groups.values()), labels=list(groups.keys()), showfliers=True)
    ax.set_ylabel(YLABEL)
    ax.set_title(f"{YLABEL}: OEI vs CDBG/ARPA")
    ax.grid(axis="y", linestyle="--", alpha=0.4)
    fig.tight_layout()
    return fig


def plot_histogram(groups: dict[str, pd.Series]) -> plt.Figure:
    fig, ax = plt.subplots(figsize=(9, 6))
    all_vals = np.concatenate([s.values for s in groups.values()])
    bins = np.linspace(all_vals.min(), all_vals.max(), 25)

    for label, series in groups.items():
        ax.hist(series, bins=bins, alpha=0.55, label=label, edgecolor="black")

    ax.set_xlabel(YLABEL)
    ax.set_ylabel("Number of Projects")
    ax.set_title(f"Distribution of {YLABEL}: OEI vs CDBG/ARPA")
    ax.legend()
    ax.grid(axis="y", linestyle="--", alpha=0.4)
    fig.tight_layout()
    return fig


def plot_cdf(groups: dict[str, pd.Series]) -> plt.Figure:
    fig, ax = plt.subplots(figsize=(9, 6))

    for label, series in groups.items():
        sorted_vals = np.sort(series.values)
        cumulative = np.arange(1, len(sorted_vals) + 1) / len(sorted_vals)
        ax.plot(sorted_vals, cumulative, linewidth=2, label=label)

    ax.set_xlabel(YLABEL)
    ax.set_ylabel("Cumulative Proportion of Projects")
    ax.set_title(f"CDF of {YLABEL}: OEI vs CDBG/ARPA")
    ax.legend()
    ax.grid(linestyle="--", alpha=0.4)
    fig.tight_layout()
    return fig

def save_fig(fig: plt.Figure, filename: str) -> None:
    out = OUTPUT_DIR / f"{filename}.png"
    fig.savefig(out, dpi=150, bbox_inches="tight")
    print(f"Saved: {out}")

def main():
    if not EXCEL_PATH.exists():
        raise FileNotFoundError(f"Excel file not found at: {EXCEL_PATH}")

    groups = load_co2_data(EXCEL_PATH)

    charts = [
        (plot_boxplot(groups),   "co2_boxplot"),
        (plot_histogram(groups), "co2_histogram"),
        (plot_cdf(groups),       "co2_cdf"),
    ]

    for fig, name in charts:
        save_fig(fig, name)

    plt.show()


if __name__ == "__main__":
    main()
