from fastapi import FastAPI, HTTPException, Response
from sheets import get_data, cache
from stats import get_stats
from anomalies import find_iqr, find_zscore, find_moving_average, find_grubbs, anomalies_test
from pathlib import Path
from fastapi.staticfiles import StaticFiles
import numpy as np
from trend import fit_trend
from report import build_pdf

app = FastAPI()

@app.get("/stats")
def get_statistics():
    df = get_data()
    stats = get_stats(df).to_dict(orient="index")
    return stats

@app.get("/data")
def get_data_for_chart(refresh: bool = False):
    df = get_data(refresh)
    mines = {}
    mine_names = df.columns.drop("Date")
    for name in mine_names:
        mines[name] = df[name].to_list()
    data = {
        "loaded_at": cache["loaded_at"],
        "dates": df["Date"].dt.strftime("%Y-%m-%d").to_list(),
        "mines": mines,
        "total": df[mine_names].sum(axis=1).to_list(),
    }
    return data

@app.get('/anomalies')
def get_anomalies(test: str = 'iqr', k: float =1.5, threshold: float = 3, window: int = 7, percent: float = 25, alpha: float = 0.05):
    df = get_data()
    try:
        result = anomalies_test(df, test, k, threshold, window, percent, alpha)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/trend")
def get_trend_lines(degree: int):
    if degree not in [1,2,3,4]:
        raise HTTPException(status_code=400, detail="Provide degree to make lines")
    df = get_data()
    column_names = df.columns.drop("Date")
    total = df[column_names].sum(axis=1)
    mines = {}
    for name in column_names:
        trend = fit_trend(df[name], degree)
        mines[name] = trend
    line_for_total = fit_trend(total, degree)
    return {
        "dates": df["Date"].dt.strftime("%Y-%m-%d").to_list(),
        "mines": mines,
        "total": line_for_total
    }

@app.get("/report.pdf")
def get_report_pdf(test: str = 'iqr', k: float =1.5, threshold: float = 3, window: int = 7, percent: float = 25, alpha: float = 0.05, chart: str = 'line', degree: int = 0):
    df = get_data()
    stats = get_stats(df)
    params = {
        "k":k,
        "threshold":threshold,
        "window": window,
        "percent": percent,
        "alpha": alpha
    }
    try:
        anomalies = anomalies_test(df, test, k, threshold, window, percent, alpha)
    except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    pdf = build_pdf(df, stats, anomalies, test, chart, degree, params)
    return Response(content=pdf, media_type="application/pdf")

FRONTEND = Path(__file__).parent.parent / "frontend"
app.mount("/", StaticFiles(directory=FRONTEND, html=True))