from fastapi import FastAPI, HTTPException
from sheets import get_data, cache
from stats import get_stats
from anomalies import find_iqr, find_zscore, find_moving_average
from pathlib import Path
from fastapi.staticfiles import StaticFiles
import numpy as np
from trend import fit_trend

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
    TESTS_HANDLERS = {
        "iqr": lambda df: find_iqr(df, k),
        "zscore": lambda df: find_zscore(df, threshold),
        "moving_average": lambda df: find_moving_average(df, window, percent)
    }
    if test not in TESTS_HANDLERS:
        raise HTTPException(status_code=400, detail="Bad test selected")
    return TESTS_HANDLERS[test](df)

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

FRONTEND = Path(__file__).parent.parent / "frontend"
app.mount("/", StaticFiles(directory=FRONTEND, html=True))