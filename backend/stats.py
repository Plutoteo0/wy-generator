from sheets import load_data
import pandas as pd

def get_stats(df):
    mine_columns = df.columns.drop("Date")
    mean_mines = df[mine_columns].mean()
    std_mines = df[mine_columns].std()
    median_mines = df[mine_columns].median()
    iqr_mines = df[mine_columns].quantile(0.75) - df[mine_columns].quantile(0.25)
    row = df[mine_columns].sum(axis=1)
    total_mean = row.mean()
    total_std = row.std()
    total_median = row.median()
    total_iqr = row.quantile(0.75) - row.quantile(0.25)
    statistic = pd.DataFrame({"mean": mean_mines, "std": std_mines, "median": median_mines, "iqr": iqr_mines})
    statistic.loc["Total"] = [total_mean, total_std, total_median, total_iqr]
    return statistic
