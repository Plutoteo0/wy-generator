import numpy as np

def fit_trend(values, degree):
    x = np.arange(len(values))
    coffs = np.polyfit(x, values, degree)
    line = np.polyval(coffs, x)
    return line.tolist()