import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from pathlib import Path


def find_kwh_column(columns):
    """
    Try to find the 'kWh Projected Savings' column in a case-insensitive,
    slightly fuzzy way, in case of minor naming differences.
    """
    target_tokens = ["kwh", "projected", "saving"]
    lowered = {col.lower(): col for col in columns}

    # Exact match first
    for col in columns:
        if col.strip().lower() == "kwh projected savings":
            return col

    # Fuzzy: require all tokens to appear in the column name
    for lower_name, original_name in lowered.items():
        if all(token in lower_name for token in target_tokens):
            return original_name

    raise KeyError(
        "Could not find a 'kWh Projected Savings' column. "
        f"Available columns: {list(columns)}"
    )


def load_sheet_series(excel_path: Path, sheet_name: str) -> pd.Series:
    """Load the kWh Projected Savings series from a given sheet."""
    df = pd.read_excel(excel_path, sheet_name=sheet_name)
    kwh_col = find_kwh_column(df.columns)
    return df[kwh_col].dropna()


def main():
    # Point to the Excel file in the same folder as this script
    excel_path = Path(__file__).with_name(
        "Efficiency Navigator Program - Data Support Group (2).xlsx"
    )

    if not excel_path.exists():
        raise FileNotFoundError(f"Excel file not found at: {excel_path}")

    # Inspect sheet names
    xls = pd.ExcelFile(excel_path)
    sheet_names = [str(name) for name in xls.sheet_names]

    # Try to identify OEI and CDBG/ARPA sheets by name
    oei_sheet = None
    cdbg_sheet = None
    for name in sheet_names:
        lname = name.lower()
        if "oei" in lname:
            oei_sheet = name
        if "cdbg" in lname or "arpa" in lname:
            cdbg_sheet = name

    if oei_sheet is None or cdbg_sheet is None:
        raise ValueError(
            "Could not automatically identify OEI and CDBG/ARPA sheets.\n"
            f"Found sheets: {sheet_names}\n"
            "Update 'oei_sheet' and 'cdbg_sheet' in this script to match your sheet names."
        )

    # Load kWh Projected Savings series from both sheets
    oei_kwh = load_sheet_series(excel_path, oei_sheet)
    cdbg_kwh = load_sheet_series(excel_path, cdbg_sheet)

    data = [oei_kwh, cdbg_kwh]
    oei_label = f"{oei_sheet} (n={len(oei_kwh)})"
    cdbg_label = f"{cdbg_sheet} (n={len(cdbg_kwh)})"
    labels = [oei_label, cdbg_label]

    # ── Chart 1: Side-by-side boxplot ──────────────────────────────
    fig1, ax1 = plt.subplots(figsize=(8, 6))
    ax1.boxplot(data, labels=labels, showfliers=True)
    ax1.set_ylabel("kWh Projected Savings")
    ax1.set_title("Projected kWh Savings: OEI vs CDBG/ARPA")
    ax1.grid(axis="y", linestyle="--", alpha=0.4)
    fig1.tight_layout()

    # ── Chart 2: Overlaid histogram ────────────────────────────────
    fig2, ax2 = plt.subplots(figsize=(9, 6))
    bin_lo = min(oei_kwh.min(), cdbg_kwh.min())
    bin_hi = max(oei_kwh.max(), cdbg_kwh.max())
    bins = np.linspace(bin_lo, bin_hi, 25)

    ax2.hist(oei_kwh, bins=bins, alpha=0.55, label=oei_label, edgecolor="black")
    ax2.hist(cdbg_kwh, bins=bins, alpha=0.55, label=cdbg_label, edgecolor="black")
    ax2.set_xlabel("kWh Projected Savings")
    ax2.set_ylabel("Number of Projects")
    ax2.set_title("Distribution of kWh Projected Savings: OEI vs CDBG/ARPA")
    ax2.legend()
    ax2.grid(axis="y", linestyle="--", alpha=0.4)
    fig2.tight_layout()

    # ── Chart 3: Cumulative Distribution Function (CDF) ───────────
    fig3, ax3 = plt.subplots(figsize=(9, 6))
    for series, label in [(oei_kwh, oei_label), (cdbg_kwh, cdbg_label)]:
        sorted_vals = np.sort(series.values)
        cumulative = np.arange(1, len(sorted_vals) + 1) / len(sorted_vals)
        ax3.plot(sorted_vals, cumulative, linewidth=2, label=label)

    ax3.set_xlabel("kWh Projected Savings")
    ax3.set_ylabel("Cumulative Proportion of Projects")
    ax3.set_title("CDF of kWh Projected Savings: OEI vs CDBG/ARPA")
    ax3.legend()
    ax3.grid(linestyle="--", alpha=0.4)
    fig3.tight_layout()

    plt.show()


if __name__ == "__main__":
    main()

