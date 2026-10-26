from sheets import load_data
import numpy as np
from scipy import stats

def create_table(df):
    table = df.set_index("Date")
    table["Total"] = table.sum(axis=1)
    return table

def find_iqr(df, k=1.5):
    table = create_table(df)
    q1 = table.quantile(0.25)
    q3 = table.quantile(0.75)
    iqr = q3 - q1
    lower = q1 - k * iqr
    upper = q3 + k * iqr
    mask = (table < lower) | (table > upper)
    stacked = mask.stack()
    outliers = stacked[stacked]
    info = []
    for date, name in outliers.index:
        info.append({"name": name,
                "date": date.strftime("%Y-%m-%d"),
                "value": float(table.loc[date, name]),
                "lower": float(lower[name]),
                "upper": float(upper[name]),
                "test": "iqr"})
    return info

def find_zscore(df, threshold=3):
    table = create_table(df)
    mean = table.mean()
    std = table.std()
    z_table = (table - mean) / std
    mask = z_table.abs() > threshold
    stacked = mask.stack()
    outliers = stacked[stacked]
    info = []
    for date, name in outliers.index:
        info.append({"name": name,
                "date": date.strftime("%Y-%m-%d"),
                "value": float(table.loc[date, name]),
                "z": float(z_table.loc[date, name]),
                "lower": float(mean[name] - threshold * std[name]),
                "upper": float(mean[name] + threshold * std[name]),
                "test": "z-score"})
    return info

def find_moving_average(df, window=7, percent=25):
    table = create_table(df)
    ma = table.rolling(window).mean().shift(1)
    deviation = (table - ma) / ma * 100
    mask = deviation.abs() > percent
    stacked = mask.stack()
    outliers = stacked[stacked]
    info = []
    for date, name in outliers.index:
        info.append({
            "name": name,
            "date": date.strftime("%Y-%m-%d"),
            "value": float(table.loc[date, name]),
            "deviation": float(deviation.loc[date, name]),
            "lower": float(ma.loc[date, name] * (1 - percent / 100)),
            "upper": float(ma.loc[date, name] * (1 + percent / 100)),
            "test": "moving-average"
        })
    return info

def find_grubbs(df, alpha = 0.05):
    table = create_table(df)
    info = []
    column_names = table.columns
    for name in column_names:
        s = table[name].copy()
        while len(s) > 2:
            n = len(s)
            row_mean = s.mean()
            row_std = s.std()
            g = ((s - row_mean) / row_std).abs()
            g_date = g.idxmax()
            g_value = g.max()
            t = stats.t.ppf(1 - alpha / (2 * n), n - 2)
            g_crit = (n - 1) / np.sqrt(n) * np.sqrt(t ** 2 / (n - 2 + t**2))
            if g_value < g_crit:
                break
            else:
                info.append({
                    "name": name,
                    "date": g_date.strftime("%Y-%m-%d"),
                    "value": float(s[g_date]),
                    "g": float(g_value),
                    "test": "grubbs"
                })
                s = s.drop(g_date)
    return info

def anomalies_test(df, test: str, k: float, threshold: float , window: int , percent: float , alpha: float):
    TEST_HANDLERS = {
        "iqr": lambda df: find_iqr(df, k),
        "zscore": lambda df: find_zscore(df, threshold),
        "moving_average": lambda df: find_moving_average(df, window, percent),
        "grubbs": lambda df: find_grubbs(df, alpha)
    }
    if test not in TEST_HANDLERS:
            raise ValueError(f"Bad test selected {test!r}")
    return TEST_HANDLERS[test](df)