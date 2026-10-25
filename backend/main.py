from fastapi import FastAPI, HTTPException
from sheets import load_data
from stats import get_stats

app = FastAPI()

@app.get("/stats")
def get_statistics():
    df = load_data()
    stats = get_stats(df).to_dict(orient="index")
    return stats