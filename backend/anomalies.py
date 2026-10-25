from sheets import load_data

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



if __name__ == "__main__":
    df = load_data()
    info = find_iqr(df)
    # print(len(info))
    # print(info[:4])
    # print(find_zscore(df, threshold=2))
    print(find_moving_average(df))