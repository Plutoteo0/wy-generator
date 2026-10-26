from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, Image, PageBreak
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import cm
from trend import fit_trend
from reportlab.platypus import TableStyle, Spacer
from reportlab.lib import colors
import pandas as pd
import io
from anomalies import create_table, anomalies_test
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

METRICS = {
    "z": ("Z-score", "{:.2f}"),
    "deviation": ("Deviation from moving average, %", "{:+.1f}"),
    "g": ("Grubbs G", "{:.3f}"),
}

TEST_NAMES = {
    "iqr": "IQR rule",
    "zscore": "Z-score",
    "moving_average": "Moving average deviation",
    "grubbs": "Grubbs test",
}

TEST_PARAMS = {
    "iqr": ["k"],
    "zscore": ["threshold"],
    "moving_average": ["window", "percent"],
    "grubbs": ["alpha"],
}

def format_range(a):
    if "lower" in a and "upper" in a:
        return f"{a['lower']:,.1f} - {a['upper']:,.1f}"
    return "-"

def add_test_block(story, styles, df, stats, found, test, params, chart, degree):
    param_text = ", ".join(f"{p}={params[p]}" for p in TEST_PARAMS[test])
    story.append(Paragraph(f"{TEST_NAMES[test]} ({param_text})", styles["Heading2"]))
    chart_png = build_chart(df, found, chart, degree)
    story.append(Image(io.BytesIO(chart_png), width=16*cm, height=8*cm))
    if not found:
        story.append(Paragraph("No anomalies found", styles["Normal"]))
        return
    anomaly_data = [["Series", "Date", "Value", "Expected range"]]
    for a in found:
        anomaly_data.append([a["name"], a["date"], f"{a['value']:,.1f}", format_range(a)])
    story.append(make_table(anomaly_data, num_cols=(2,)))
    for a in found[:20]:
        story.append(Paragraph(f"{a['name']}, {a['date']}", styles["Heading3"]))
        lines = []
        if "lower" in a and "upper" in a:
            if a["value"] > a["upper"]:
                kind = "Spike"
                lines.append(f"Above the upper bound by {a['value'] - a['upper']:,.1f}")
            else:
                kind = "Drop"
                lines.append(f"Below the lower bound by {a['lower'] - a['value']:,.1f}")
        else:
            kind = "Spike" if a["value"] > stats.loc[a["name"], "mean"] else "Drop"
        lines.insert(0, f"Type: {kind}")
        for key, (label, fmt) in METRICS.items():
            if key in a:
                lines.append(f"{label}: {fmt.format(a[key])}")
        story.append(Paragraph("<br/>".join(lines), styles["Normal"]))
    if len(found) > 20:
        story.append(Paragraph(f"Showing first 20 of {len(found)} anomalies.", styles["Normal"]))

def build_pdf(df, stats, anomalies, test, chart, degree, params):
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer)
    styles = getSampleStyleSheet()
    data = [["Series", "Mean", "Std", "Median", "IQR"]]
    for name, row in stats.iterrows():
        data.append([name, f"{row['mean']:,.1f}", f"{row['std']:,.1f}", f"{row['median']:,.1f}", f"{row['iqr']:,.1f}"])
    story = [Paragraph("WY mines output", styles["Title"]), make_table(data, num_cols=(1, 2, 3, 4)), Spacer(1, 12)]
    for t in TEST_NAMES:
        found = anomalies_test(df, t, params["k"], params["threshold"], params["window"], params["percent"], params["alpha"])
        add_test_block(story, styles, df, stats, found, t, params, chart, degree)
        story.append(PageBreak())
    doc.build(story)
    return buffer.getvalue()

def build_chart(df, anomalies, chart, degree):
    table = create_table(df).drop(columns="Total")
    plot_data = table.cumsum(axis=1) if chart == "stacked" else table
    n = len(table.columns)
    fig, ax = plt.subplots(figsize=(10, 5))
    for i, name in enumerate(table.columns):
        color = f"C{i}"
        if chart == "line":
            ax.plot(table.index, table[name], label=name, color=color)
        elif chart == "bar":
            width = 0.8 / n
            ax.bar(table.index + pd.Timedelta(days=i * width), table[name], width=width, label=name, color=color)
        else:
            ax.bar(table.index, table[name], bottom=plot_data[name] - table[name], label=name, color=color)
        if degree > 0:
            trend_color = color if chart == "line" else "black"
            ax.plot(table.index, fit_trend(plot_data[name].values, degree), linestyle="--", color=trend_color)
    for a in anomalies:
        if a["name"] == "Total":
            continue
        date = pd.to_datetime(a["date"])
        ax.scatter(date, plot_data.loc[date, a["name"]], color="red", zorder=3)
    buffer = io.BytesIO()
    ax.legend()
    fig.savefig(buffer, format="png", dpi=150)
    plt.close(fig)
    return buffer.getvalue()

def make_table(data, num_cols=()):
    table = Table(data, hAlign="LEFT", repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1f2933")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f3f4f6")]),
        ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#d1d5db")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    for col in num_cols:
        style.append(("ALIGN", (col, 0), (col, -1), "RIGHT"))
    table.setStyle(TableStyle(style))
    return table