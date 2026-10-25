import os
from dotenv import load_dotenv
import httpx
import pandas as pd
from datetime import datetime

load_dotenv()

SHEETS_KEY = os.getenv("SHEETS_KEY")
SHEET_ID = os.getenv("SHEET_ID")
params = {
    "key": SHEETS_KEY,
    "valueRenderOption": "UNFORMATTED_VALUE",
    "dateTimeRenderOption": "SERIAL_NUMBER",
}

data_range = "Data!A1:N400"
url = f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}/values/{data_range}"

cache = {"df": None, "loaded_at": None}
def get_data(refresh=False):
    if refresh==True or cache["df"] is None:
        df = load_data()
        cache["df"] = df
        cache["loaded_at"] = datetime.now().isoformat(timespec="seconds")
    return cache["df"]

def load_data():
    response = httpx.get(url, params=params)
    response.raise_for_status()
    data = response.json()
    df = pd.DataFrame(data["values"][1:], columns=data["values"][0])
    columns_to_drop = ["Weekday factor", "Trend", ""]
    df = df.drop(columns=columns_to_drop)
    df["Date"] = pd.to_datetime(df["Date"], unit="D", origin="1899-12-30")
    return df

if __name__ == "__main__":
    print(get_data())