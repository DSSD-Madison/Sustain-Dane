import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from pathlib import Path

PATH = "../kWh Projected Savings/Efficiency Navigator Program - Data Support Group (2).xlsx"
YLABEL = "Projected VMT Avoided"

COLORS = [
    "#1f77b4", # blue (oei)
    "#ff7f0e", # orange (cdbg/arpa)
    "#2ca02c", # green (capital 2024)
    "#d62728", # red (capital 2025)
]


def resolve_vmt_column(columns):
    for col in columns:
        if col.strip() == "Projected VMT Avoided":
            return col
    raise KeyError("Projected VMT Avoided column not found.")


def load_vmt_data(excel_path: Path) -> dict[str, pd.Series]:
    xls = pd.ExcelFile(excel_path)
    sheet_map = {
        "oei": None,
        "cdbg": None,
        "capital_2024": None,
        "capital_2025": None,
    }

    for name in xls.sheet_names:

        if name == "OEI by Measure":
            sheet_map["oei"] = name
        elif name == "CDBG and ARPA by Measure":
            sheet_map["cdbg"] = name
        elif name == "Madison Capital 2024":
            sheet_map["capital_2024"] = name
        elif name == "Madison Capital & EECBG 2025":
            sheet_map["capital_2025"] = name

    groups = {}
    for sheet_name in sheet_map.values():
        df = pd.read_excel(excel_path, sheet_name=sheet_name)
        col = resolve_vmt_column(df.columns)
        series = pd.to_numeric(df[col], errors="coerce").dropna()
        groups[f"{sheet_name} (n={len(series)})"] = series

    return groups


def plot_boxplot(groups: dict[str, pd.Series]) -> plt.Figure:
    fig, ax = plt.subplots(figsize=(10, 6))

    bp = ax.boxplot(
        list(groups.values()),
        tick_labels=list(groups.keys()),
        patch_artist=True,
        showfliers=True
    )

    for patch, color in zip(bp["boxes"], COLORS):
        patch.set_facecolor(color)

    ax.set_ylabel(YLABEL)
    ax.set_title(f"{YLABEL}: All Program Groups")
    ax.grid(axis="y", linestyle="--", alpha=0.4)
    fig.tight_layout()
    return fig


def plot_histogram(groups: dict[str, pd.Series]) -> plt.Figure:
    n = len(groups)
    fig, axes = plt.subplots(2, 2, figsize=(12, 8), sharex=True, sharey=True)
    axes = axes.flatten()

    all_vals = np.concatenate([s.values for s in groups.values()])
    bins = np.linspace(all_vals.min(), all_vals.max(), 25)

    for ax, ((label, series), color) in zip(axes, zip(groups.items(), COLORS)):
        ax.hist(series, bins=bins, color=color, edgecolor="black")
        ax.set_title(label, fontsize=10)
        ax.set_xlabel(YLABEL)
        ax.set_ylabel("Number of Projects")
        ax.grid(axis="y", linestyle="--", alpha=0.4)

    fig.suptitle(f"Distribution of {YLABEL}: All Program Groups")
    fig.tight_layout()
    return fig


def plot_cdf(groups: dict[str, pd.Series]) -> plt.Figure:
    fig, ax = plt.subplots(figsize=(9, 6))

    for (label, series), color in zip(groups.items(), COLORS):
        sorted_vals = np.sort(series.values)
        cumulative = np.arange(1, len(sorted_vals) + 1) / len(sorted_vals)
        ax.plot(sorted_vals, cumulative, linewidth=2, label=label, color=color)

    ax.set_xlabel(YLABEL)
    ax.set_ylabel("Cumulative Proportion of Projects")
    ax.set_title(f"CDF of {YLABEL}: All Program Groups")
    ax.legend()
    ax.grid(linestyle="--", alpha=0.4)
    fig.tight_layout()

    return fig

def resolve_implementation_column(df):
    implementation_keywords = [
        "insulation", "air sealing", "ventilation", "electrical",
        "ashp", "water heater", "other"
    ]

    best_col = None
    best_score = -1

    for col in df.columns:
        series = df[col].dropna().astype(str).str.strip()

        if len(series) == 0:
            continue

        score = 0
        col_name = str(col).strip().lower()

        if "implementation" in col_name:
            score += 5

        if str(col).startswith("Unnamed"):
            score += 1

        text_values = series[series.str.contains(r"[A-Za-z]", regex=True, na=False)]
        score += len(text_values) * 0.01

        keyword_hits = series.str.lower().apply(
            lambda x: any(keyword in x for keyword in implementation_keywords)
        ).sum()
        score += keyword_hits * 3

        numeric_count = pd.to_numeric(series, errors="coerce").notna().sum()
        score -= numeric_count * 2

        if score > best_score:
            best_score = score
            best_col = col

    if best_col is None:
        raise KeyError("Implementation column not found.")

    return best_col


def load_vmt_by_implementation(excel_path: Path) -> pd.Series:
    xls = pd.ExcelFile(excel_path)

    target_sheets = [
        "OEI by Measure",
        "CDBG and ARPA by Measure",
        "Madison Capital 2024",
        "Madison Capital & EECBG 2025",
    ]

    frames = []

    for sheet_name in target_sheets:
        df = pd.read_excel(excel_path, sheet_name=sheet_name)

        vmt_col = resolve_vmt_column(df.columns)
        impl_col = resolve_implementation_column(df)

        temp = df[[impl_col, vmt_col]].copy()
        temp.columns = ["Implementation", "Projected VMT Avoided"]

        temp["Implementation"] = temp["Implementation"].astype(str).str.strip()
        temp["Projected VMT Avoided"] = pd.to_numeric(
            temp["Projected VMT Avoided"], errors="coerce"
        )

        # remove bad implementation rows ("total" rows, blanks)
        temp = temp.dropna()

        temp = temp[
            (temp["Implementation"] != "") &
            (temp["Implementation"].str.lower() != "nan") &
            (~temp["Implementation"].str.lower().str.contains("total measures"))
        ]

        frames.append(temp)

    combined = pd.concat(frames, ignore_index=True)

    implementation_means = (
        combined.groupby("Implementation")["Projected VMT Avoided"]
        .mean()
        .sort_values(ascending=False)
    )

    return implementation_means


def plot_implementation_bar(excel_path: Path) -> plt.Figure:
    implementation_means = load_vmt_by_implementation(excel_path)

    fig, ax = plt.subplots(figsize=(12, 10))
    ax.barh(implementation_means.index, implementation_means.values)
    ax.set_xlabel(f"Average {YLABEL}")
    ax.set_ylabel("Implementation")
    ax.set_title(f"Average {YLABEL} by Implementation")
    ax.grid(axis="x", linestyle="--", alpha=0.4)
    fig.tight_layout()
    return fig


def save_fig(fig: plt.Figure, filename: str) -> None:
    out = f"{filename}.png"
    fig.savefig(out, dpi=150, bbox_inches="tight")
    print(f"Saved: {out}")


def main():
    groups = load_vmt_data(PATH)

    charts = [
        (plot_boxplot(groups), "vmt_boxplot"),
        (plot_histogram(groups), "vmt_histogram"),
        (plot_cdf(groups), "vmt_cdf"),
        (plot_implementation_bar(PATH), "vmt_by_implementation"),
    ]

    for fig, name in charts:
        save_fig(fig, name)

    plt.show()


if __name__ == "__main__":
    main()