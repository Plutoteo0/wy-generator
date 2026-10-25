"use strict";

const TESTS = {
  iqr: {
    label: "IQR rule",
    help: "Flags a day when output falls below Q1 − k·IQR or above Q3 + k·IQR, where Q1, Q3 and the IQR come from that series’ own daily values.",
    params: [{ key: "k", label: "k (fence multiplier)", min: 0, step: 0.1 }],
    summary: (p) => `k = ${p.k}`,
  },
  zscore: {
    label: "Z-score",
    help: "Flags a day when it lies more than the threshold number of standard deviations from the mean of its series.",
    params: [{ key: "threshold", label: "Threshold (σ)", min: 0.5, step: 0.1 }],
    summary: (p) => `threshold = ${p.threshold} σ`,
  },
  moving_average: {
    label: "Moving average deviation",
    help: "Compares each day with the average of the previous days in the window and flags it when the difference is larger than the chosen percentage.",
    params: [
      { key: "window", label: "Window (days)", min: 2, step: 1 },
      { key: "percent", label: "Deviation (%)", min: 1, step: 1 },
    ],
    summary: (p) => `window = ${p.window} days, deviation > ${p.percent}%`,
  },
  grubbs: {
    label: "Grubbs test",
    help: "Tests whether the most extreme value of a series is a statistical outlier at the chosen significance level, then repeats on the remaining values.",
    params: [
      {
        key: "alpha",
        label: "Significance α",
        min: 0.001,
        max: 0.5,
        step: 0.01,
      },
    ],
    summary: (p) => `α = ${p.alpha}`,
  },
};

const state = {
  test: "iqr",
  params: { k: 1.5, threshold: 3, window: 7, percent: 25, alpha: 0.05 },
  chart: "line",
  degree: 0,
  view: "chart",
  showTotal: false,
  hidden: new Set(),
  data: null,
  stats: null,
  anomalies: [],
  trendCache: new Map(),
};

let chart = null;
let anomalyToken = 0;

const $ = (selector, root = document) => root.querySelector(selector);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === false || value == null) continue;
    if (name === "class") node.className = value;
    else if (name === "text") node.textContent = value;
    else if (name === "vars")
      for (const [k, v] of Object.entries(value)) node.style.setProperty(k, v);
    else if (name.startsWith("on")) node.addEventListener(name.slice(2), value);
    else node.setAttribute(name, value === true ? "" : value);
  }
  for (const child of children.flat()) if (child != null) node.append(child);
  return node;
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const asDate = (iso) => new Date(`${iso}T00:00:00`);
const fmtLong = (iso) =>
  asDate(iso).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const fmtDay = (iso) =>
  asDate(iso).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
const fmtShort = (iso) =>
  asDate(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const fmtFull = (iso) =>
  asDate(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const signed = (v, digits = 2) =>
  `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(digits)}`;
const compact = (v) =>
  Math.abs(v) >= 1000 ? `${+(v / 1000).toFixed(1)}K` : `${v}`;

const cssVar = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function seriesColor(name) {
  if (name === "Total") return cssVar("--ink");
  const index = Object.keys(state.data.mines).indexOf(name);
  return index >= 0 && index < 8
    ? cssVar(`--s${index + 1}`)
    : cssVar("--s-other");
}

async function getJSON(path) {
  const response = await fetch(path, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json();
      detail = typeof body.detail === "string" ? `: ${body.detail}` : "";
    } catch (_) {
      /* body was not JSON */
    }
    throw new Error(
      `${path.split("?")[0]} answered ${response.status}${detail}`,
    );
  }
  return response.json();
}

function anomalyQuery() {
  const query = new URLSearchParams({ test: state.test });
  for (const p of TESTS[state.test].params)
    query.set(p.key, state.params[p.key]);
  return query;
}

function setBusy(on) {
  $("#main").classList.toggle("is-busy", on);
}

function showError(error, retry) {
  const box = $("#error");
  box.replaceChildren(
    el(
      "div",
      {},
      el("strong", { text: "Could not load the dashboard data." }),
      el("span", {
        text: `${error.message}. Check that the backend is running and the sheet is shared by link.`,
      }),
    ),
    retry
      ? el("button", {
          class: "btn",
          type: "button",
          text: "Try again",
          onclick: retry,
        })
      : null,
  );
  box.hidden = false;
}

const hideError = () => {
  $("#error").hidden = true;
};

async function loadAll({ refresh = false } = {}) {
  setBusy(true);
  try {
    state.data = await getJSON(`/data?refresh=${refresh}`);
    state.trendCache.clear();
    const [stats, anomalies] = await Promise.all([
      getJSON("/stats"),
      getJSON(`/anomalies?${anomalyQuery()}`),
      ensureTrend(),
    ]);
    state.stats = stats;
    state.anomalies = anomalies;
    hideError();
    $("#loaded-at").textContent = state.data.loaded_at
      ? `Data loaded ${state.data.loaded_at.slice(11, 19)}`
      : "";
    renderAll();
  } catch (error) {
    showError(error, () => loadAll({ refresh }));
  } finally {
    setBusy(false);
  }
}

async function refreshAnomalies() {
  const token = ++anomalyToken;
  setBusy(true);
  try {
    const list = await getJSON(`/anomalies?${anomalyQuery()}`);
    if (token !== anomalyToken) return;
    state.anomalies = list;
    hideError();
    renderHero();
    renderView();
    renderAnomalies();
  } catch (error) {
    if (token === anomalyToken) showError(error, refreshAnomalies);
  } finally {
    if (token === anomalyToken) setBusy(false);
  }
}

async function ensureTrend() {
  if (!state.degree || state.trendCache.has(state.degree)) return;
  state.trendCache.set(
    state.degree,
    await getJSON(`/trend?degree=${state.degree}`),
  );
}

function renderAll() {
  renderParams();
  renderHero();
  renderLegend();
  renderView();
  renderStats();
  renderAnomalies();
}

function renderParams() {
  const box = $("#params");
  box.replaceChildren();
  for (const p of TESTS[state.test].params) {
    const id = `param-${p.key}`;
    const input = el("input", {
      id,
      type: "number",
      min: p.min,
      max: p.max,
      step: p.step,
      value: state.params[p.key],
      inputmode: "decimal",
    });
    input.addEventListener("input", () => onParamInput(p, input));
    box.append(
      el(
        "div",
        { class: "field" },
        el("label", { for: id, text: p.label }),
        input,
      ),
    );
  }
  $("#test-help").textContent = TESTS[state.test].help;
}

const onParamInput = debounce((param, input) => {
  const value = Number(input.value);
  const valid =
    input.value !== "" &&
    Number.isFinite(value) &&
    (param.min == null || value >= param.min) &&
    (param.max == null || value <= param.max);
  if (!valid) {
    input.setAttribute("aria-invalid", "true");
    return;
  }
  input.removeAttribute("aria-invalid");
  state.params[param.key] = value;
  refreshAnomalies();
}, 350);

function seriesCount() {
  return Object.keys(state.data.mines).length + 1;
}

function renderHero() {
  const { dates } = state.data;
  const count = state.anomalies.length;
  const test = TESTS[state.test];

  $("#hero-count").textContent = nf0.format(count);
  $("#hero-title").textContent =
    count === 1 ? "anomaly flagged" : "anomalies flagged";
  $("#hero-desc").textContent =
    `${test.label}, ${test.summary(state.params)}. ${seriesCount()} series (mines and total) over ${dates.length} days, ${fmtFull(dates[0])} to ${fmtFull(dates[dates.length - 1])}.`;

  const perDay = new Map();
  for (const a of state.anomalies) {
    if (!perDay.has(a.date)) perDay.set(a.date, []);
    perDay.get(a.date).push(a.name);
  }
  const maxHits = Math.max(
    1,
    ...[...perDay.values()].map((names) => names.length),
  );

  const strip = $("#strip");
  strip.replaceChildren(
    ...dates.map((date) => {
      const names = perDay.get(date) || [];
      const bar = el("div", {
        class: names.length ? "strip-bar has-hits" : "strip-bar",
        "data-date": date,
      });
      bar.style.height = names.length
        ? `${10 + (names.length / maxHits) * 50}px`
        : "2px";
      return bar;
    }),
  );
  strip.setAttribute(
    "aria-label",
    `Anomalies per day: ${count} flagged on ${perDay.size} of ${dates.length} days`,
  );
  strip._perDay = perDay;
  $("#strip-start").textContent = fmtShort(dates[0]);
  $("#strip-end").textContent = fmtShort(dates[dates.length - 1]);
}

function renderLegend() {
  const box = $("#legend");
  const keyClass = state.chart === "line" ? "key key-line" : "key key-box";
  box.replaceChildren();

  for (const name of Object.keys(state.data.mines)) {
    const off = state.hidden.has(name);
    box.append(
      el(
        "button",
        {
          class: "legend-item",
          type: "button",
          "aria-pressed": String(!off),
          onclick: () => {
            if (state.hidden.has(name)) state.hidden.delete(name);
            else state.hidden.add(name);
            renderLegend();
            renderView();
          },
        },
        el("span", { class: keyClass, vars: { "--c": seriesColor(name) } }),
        name,
      ),
    );
  }

  const stacked = state.chart === "stacked";
  box.append(
    el(
      "button",
      {
        class: "legend-item",
        type: "button",
        "aria-pressed": String(state.showTotal && !stacked),
        "aria-disabled": stacked ? "true" : null,
        title: stacked
          ? "In the stacked view the total is the top of the stack"
          : null,
        onclick: () => {
          if (stacked) return;
          state.showTotal = !state.showTotal;
          renderLegend();
          renderView();
        },
      },
      el("span", { class: keyClass, vars: { "--c": seriesColor("Total") } }),
      "Total",
    ),
  );

  box.append(
    el(
      "span",
      { class: "legend-static" },
      el("span", { class: "key key-dot" }),
      "Anomaly",
    ),
  );
  if (state.degree) {
    box.append(
      el(
        "span",
        { class: "legend-static" },
        el("span", { class: "key key-dash" }),
        `Trendline, degree ${state.degree}`,
      ),
    );
  }
}

function makeDataset(name, data, stacked) {
  const color = seriesColor(name);
  if (state.chart === "line") {
    return {
      type: "line",
      label: name,
      data,
      order: 2,
      borderColor: color,
      backgroundColor: color,
      borderWidth: 2,
      tension: 0,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointHoverBackgroundColor: color,
      pointHoverBorderColor: cssVar("--surface"),
      pointHoverBorderWidth: 2,
    };
  }
  return {
    type: "bar",
    label: name,
    data,
    order: 2,
    backgroundColor: color,
    borderColor: cssVar("--surface"),
    borderWidth: stacked ? 1 : 0.5,
    borderRadius: stacked ? 2 : { topLeft: 2, topRight: 2 },
    borderSkipped: false,
    maxBarThickness: 24,
    categoryPercentage: stacked ? 0.8 : 0.88,
    barPercentage: 1,
  };
}

function buildDatasets() {
  const { mines, total } = state.data;
  const stacked = state.chart === "stacked";
  const visible = Object.keys(mines).filter((name) => !state.hidden.has(name));
  const sets = visible.map((name) => makeDataset(name, mines[name], stacked));
  const withTotal = state.showTotal && !stacked;
  if (withTotal) sets.push(makeDataset("Total", total, false));

  const trend = state.trendCache.get(state.degree);
  if (state.degree && trend) {
    const names = withTotal ? [...visible, "Total"] : visible;
    for (const name of names) {
      sets.push({
        type: "line",
        label: `${name} trend`,
        isTrend: true,
        order: 1,
        data: name === "Total" ? trend.total : trend.mines[name],
        borderColor: seriesColor(name),
        backgroundColor: seriesColor(name),
        borderWidth: 2,
        borderDash: [6, 4],
        tension: 0,
        pointRadius: 0,
        pointHoverRadius: 0,
      });
    }
  }
  return sets;
}

const crosshairPlugin = {
  id: "crosshair",
  beforeDatasetsDraw(chartInstance, _args, options) {
    const active =
      chartInstance.tooltip && chartInstance.tooltip.getActiveElements();
    if (!active || !active.length) return;
    const { ctx, chartArea } = chartInstance;
    const x = active[0].element.x;
    ctx.save();
    if (options.mode === "band") {
      const width = chartArea.width / chartInstance.data.labels.length;
      ctx.fillStyle = options.color;
      ctx.fillRect(
        x - width / 2,
        chartArea.top,
        width,
        chartArea.bottom - chartArea.top,
      );
    } else {
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.lineWidth = 1;
      ctx.strokeStyle = options.color;
      ctx.stroke();
    }
    ctx.restore();
  },
};

const anomalyPlugin = {
  id: "anomalyMarks",
  afterDatasetsDraw(chartInstance, _args, options) {
    const { ctx } = chartInstance;
    chartInstance.data.datasets.forEach((dataset, datasetIndex) => {
      if (dataset.isTrend || !chartInstance.isDatasetVisible(datasetIndex))
        return;
      const hits = options.byName.get(dataset.label);
      if (!hits) return;
      const meta = chartInstance.getDatasetMeta(datasetIndex);
      for (const index of hits) {
        const element = meta.data[index];
        if (!element) continue;
        const { x, y, base } = element.getProps(["x", "y", "base"], true);
        const centerY = options.stacked && base != null ? (y + base) / 2 : y;
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, centerY, 6.5, 0, Math.PI * 2);
        ctx.fillStyle = options.ring;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, centerY, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = options.color;
        ctx.fill();
        ctx.restore();
      }
    });
  },
};

function renderChart() {
  if (!window.Chart) {
    showError(
      new Error("Chart.js did not load (check the internet connection)"),
    );
    return;
  }
  if (chart) chart.destroy();

  const { dates, total } = state.data;
  const stacked = state.chart === "stacked";
  const isLine = state.chart === "line";
  const indexByDate = new Map(dates.map((d, i) => [d, i]));

  const byName = new Map();
  for (const a of state.anomalies) {
    if (!indexByDate.has(a.date)) continue;
    if (!byName.has(a.name)) byName.set(a.name, []);
    byName.get(a.name).push(indexByDate.get(a.date));
  }

  const surface = cssVar("--surface");
  const muted = cssVar("--muted");
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  chart = new Chart($("#chart"), {
    type: isLine ? "line" : "bar",
    data: { labels: dates, datasets: buildDatasets() },
    plugins: [crosshairPlugin, anomalyPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: reduceMotion ? false : { duration: 200 },
      interaction: { mode: "index", intersect: false },
      layout: { padding: { top: 8, right: 4 } },
      scales: {
        x: {
          stacked,
          grid: { display: false },
          border: { color: cssVar("--axis") },
          ticks: {
            color: muted,
            autoSkip: true,
            maxTicksLimit: 8,
            maxRotation: 0,
            callback(value) {
              return fmtShort(this.getLabelForValue(value));
            },
          },
        },
        y: {
          stacked,
          beginAtZero: !isLine,
          border: { display: false },
          grid: { color: cssVar("--grid"), lineWidth: 1 },
          ticks: {
            color: muted,
            maxTicksLimit: 6,
            callback: (value) => compact(value),
          },
        },
      },
      plugins: {
        legend: { display: false },
        crosshair: {
          mode: isLine ? "line" : "band",
          color: isLine ? cssVar("--axis") : cssVar("--wash"),
        },
        anomalyMarks: {
          byName,
          stacked,
          color: cssVar("--alert"),
          ring: surface,
        },
        tooltip: {
          filter: (item) => !item.dataset.isTrend,
          backgroundColor: surface,
          borderColor: cssVar("--axis"),
          borderWidth: 1,
          titleColor: cssVar("--ink-2"),
          bodyColor: cssVar("--ink"),
          footerColor: cssVar("--ink-2"),
          titleFont: { weight: "500" },
          footerFont: { weight: "400" },
          padding: 10,
          boxPadding: 6,
          boxWidth: isLine ? 14 : 10,
          boxHeight: isLine ? 2 : 10,
          usePointStyle: false,
          callbacks: {
            title: (items) => fmtLong(dates[items[0].dataIndex]),
            label: (item) => `${nf0.format(item.raw)}  ${item.dataset.label}`,
            labelColor: (item) => ({
              borderColor: item.dataset.backgroundColor,
              backgroundColor: item.dataset.backgroundColor,
              borderWidth: 0,
              borderRadius: 1,
            }),
            footer: (items) =>
              stacked ? `Total  ${nf0.format(total[items[0].dataIndex])}` : "",
            afterFooter: (items) => {
              const date = dates[items[0].dataIndex];
              const names = [
                ...new Set(
                  state.anomalies
                    .filter((a) => a.date === date)
                    .map((a) => a.name),
                ),
              ];
              return names.length ? `Flagged: ${names.join(", ")}` : "";
            },
          },
        },
      },
    },
  });

  const flagged = state.anomalies.length;
  $("#chart").setAttribute(
    "aria-label",
    `${isLine ? "Line" : stacked ? "Stacked bar" : "Bar"} chart of daily output, ${flagged} anomalies marked with red dots.`,
  );
  const notes = [];
  if (stacked)
    notes.push(
      "The stacked view shows the mines only; anomalies in the total are listed under “Flagged days”.",
    );
  if (state.degree)
    notes.push(
      `Dashed lines are least-squares polynomial fits of degree ${state.degree}.`,
    );
  $("#chart-note").textContent = notes.join(" ");
}

function renderDataTable() {
  const { dates, mines, total } = state.data;
  const names = Object.keys(mines).filter((n) => !state.hidden.has(n));
  const flagged = new Set(state.anomalies.map((a) => `${a.date}|${a.name}`));

  const cell = (date, name, value) => {
    const hit = flagged.has(`${date}|${name}`);
    return el(
      "td",
      { class: hit ? "num cell-hit" : "num" },
      hit
        ? el("span", { class: "hit-dot", title: "Flagged as an anomaly" })
        : null,
      nf0.format(value),
    );
  };

  const head = el(
    "tr",
    {},
    el("th", { text: "Date" }),
    ...names.map((n) => el("th", { class: "num", text: n })),
    el("th", { class: "num", text: "Total" }),
  );
  const rows = dates.map((date, i) =>
    el(
      "tr",
      {},
      el("td", { text: fmtDay(date) }),
      ...names.map((n) => cell(date, n, mines[n][i])),
      cell(date, "Total", total[i]),
    ),
  );

  $("#table-wrap").replaceChildren(
    el("table", {}, el("thead", {}, head), el("tbody", {}, rows)),
  );
}

function renderView() {
  const asChart = state.view === "chart";
  $("#chart-wrap").hidden = !asChart;
  $("#table-wrap").hidden = asChart;
  if (asChart) {
    renderChart();
  } else {
    if (chart) {
      chart.destroy();
      chart = null;
    }
    renderDataTable();
    $("#chart-note").textContent =
      "Red dots mark days flagged by the selected test.";
  }
}

function renderStats() {
  const rows = Object.entries(state.stats).map(([name, s]) =>
    el(
      "tr",
      {},
      el(
        "td",
        {},
        el(
          "span",
          { class: "series-cell" },
          el("span", {
            class: "key key-box",
            vars: { "--c": seriesColor(name) },
          }),
          name,
        ),
      ),
      el("td", { class: "num", text: nf1.format(s.mean) }),
      el("td", { class: "num", text: nf1.format(s.std) }),
      el("td", { class: "num", text: nf1.format(s.median) }),
      el("td", { class: "num", text: nf1.format(s.iqr) }),
    ),
  );

  $("#stats").replaceChildren(
    el(
      "table",
      {},
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          el("th", { text: "Series" }),
          ...["Mean", "Std", "Median", "IQR"].map((t) =>
            el("th", { class: "num", text: t }),
          ),
        ),
      ),
      el("tbody", {}, rows),
    ),
  );
}

function detailOf(a) {
  if (typeof a.z === "number") return `z = ${signed(a.z)}`;
  if (typeof a.deviation === "number")
    return `${signed(a.deviation, 1)}% vs previous days`;
  if (typeof a.g === "number") return `G = ${a.g.toFixed(2)}`;
  if (typeof a.lower === "number" && a.value < a.lower) return "Below range";
  if (typeof a.upper === "number" && a.value > a.upper) return "Above range";
  return "";
}

function renderAnomalies() {
  const box = $("#anomalies");
  if (!state.anomalies.length) {
    box.replaceChildren(
      el(
        "div",
        { class: "empty" },
        el("strong", { text: "No days flagged with these settings." }),
        "Lower the threshold or pick another test to see more.",
      ),
    );
    return;
  }

  const order = Object.keys(state.data.mines);
  const rank = (name) =>
    name === "Total" ? order.length : order.indexOf(name);
  const sorted = [...state.anomalies].sort(
    (a, b) => a.date.localeCompare(b.date) || rank(a.name) - rank(b.name),
  );

  const rows = sorted.map((a) => {
    const hasRange = typeof a.lower === "number" && typeof a.upper === "number";
    return el(
      "tr",
      {},
      el("td", { text: fmtDay(a.date) }),
      el(
        "td",
        {},
        el(
          "span",
          { class: "series-cell" },
          el("span", {
            class: "key key-box",
            vars: { "--c": seriesColor(a.name) },
          }),
          a.name,
        ),
      ),
      el("td", { class: "num", text: nf0.format(a.value) }),
      el("td", {
        class: "num",
        text: hasRange
          ? `${nf0.format(a.lower)} to ${nf0.format(a.upper)}`
          : "–",
      }),
      el("td", { text: detailOf(a) }),
    );
  });

  box.replaceChildren(
    el(
      "table",
      {},
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          el("th", { text: "Date" }),
          el("th", { text: "Series" }),
          el("th", { class: "num", text: "Value" }),
          el("th", { class: "num", text: "Expected range" }),
          el("th", { text: "Detail" }),
        ),
      ),
      el("tbody", {}, rows),
    ),
  );
}

function setPressed(group, value) {
  for (const button of group.querySelectorAll("button")) {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.value === String(value)),
    );
  }
}

function bindControls() {
  $("#test").addEventListener("change", (event) => {
    state.test = event.target.value;
    renderParams();
    refreshAnomalies();
  });

  $("#chart-type").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || state.chart === button.dataset.value) return;
    state.chart = button.dataset.value;
    setPressed($("#chart-type"), state.chart);
    renderLegend();
    renderView();
  });

  $("#trend").addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const degree = Number(button.dataset.value);
    if (degree === state.degree) return;
    setBusy(true);
    try {
      const previous = state.degree;
      state.degree = degree;
      try {
        await ensureTrend();
      } catch (error) {
        state.degree = previous;
        showError(error);
        return;
      }
      hideError();
      setPressed($("#trend"), state.degree);
      renderLegend();
      renderView();
    } finally {
      setBusy(false);
    }
  });

  $("#view").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || state.view === button.dataset.value) return;
    state.view = button.dataset.value;
    setPressed($("#view"), state.view);
    renderView();
  });

  $("#refresh").addEventListener("click", () => loadAll({ refresh: true }));
  $("#pdf").addEventListener("click", downloadPdf);
  bindTheme();
  bindStripTooltip();
}

async function downloadPdf() {
  const button = $("#pdf");
  const status = $("#pdf-status");
  const query = anomalyQuery();
  query.set("chart", state.chart);
  query.set("degree", state.degree);

  button.disabled = true;
  status.textContent = "Building the report…";
  try {
    const response = await fetch(`/report.pdf?${query}`);
    if (!response.ok) throw new Error(`the server answered ${response.status}`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = el("a", { href: url, download: "weyland-yutani-report.pdf" });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    status.textContent = "Report downloaded.";
  } catch (error) {
    status.textContent = `Could not build the report: ${error.message}.`;
  } finally {
    button.disabled = false;
  }
}

function effectiveTheme() {
  const forced = document.documentElement.dataset.theme;
  if (forced) return forced;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function bindTheme() {
  const button = $("#theme");
  try {
    const saved = localStorage.getItem("wy-theme");
    if (saved === "light" || saved === "dark")
      document.documentElement.dataset.theme = saved;
  } catch (_) {}

  const label = () => {
    button.textContent =
      effectiveTheme() === "dark" ? "Light mode" : "Dark mode";
  };
  label();
  button.addEventListener("click", () => {
    const next = effectiveTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("wy-theme", next);
    } catch (_) {}
    label();
    if (state.data) {
      renderLegend();
      renderView();
      renderStats();
      renderAnomalies();
    }
  });
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      label();
      if (state.data) {
        renderLegend();
        renderView();
        renderStats();
        renderAnomalies();
      }
    });
}

function bindStripTooltip() {
  const strip = $("#strip");
  const tip = $("#tip");
  let last = null;

  function nearestBar(clientX) {
    let nearest = null;
    let best = Infinity;
    for (const candidate of strip.children) {
      const rect = candidate.getBoundingClientRect();
      const distance = Math.abs(clientX - (rect.left + rect.width / 2));
      if (distance < best) {
        best = distance;
        nearest = candidate;
      }
    }
    return best <= 24 ? nearest : null;
  }

  strip.addEventListener("pointermove", (event) => {
    const bar = nearestBar(event.clientX);
    if (!bar) {
      tip.hidden = true;
      return;
    }
    if (last && last !== bar) last.classList.remove("is-hover");
    bar.classList.add("is-hover");
    last = bar;

    const date = bar.dataset.date;
    const names = [...new Set(strip._perDay.get(date) || [])];
    tip.replaceChildren(
      el("strong", { text: fmtLong(date) }),
      el("span", {
        text: names.length
          ? `${strip._perDay.get(date).length} flagged: ${names.join(", ")}`
          : "Nothing flagged",
      }),
    );
    tip.hidden = false;
    const box = tip.getBoundingClientRect();
    const left = Math.min(
      event.clientX + 14,
      window.innerWidth - box.width - 8,
    );
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${event.clientY - box.height - 14 < 8 ? event.clientY + 18 : event.clientY - box.height - 14}px`;
  });

  strip.addEventListener("pointerleave", () => {
    tip.hidden = true;
    if (last) last.classList.remove("is-hover");
    last = null;
  });
}

bindControls();
renderParams();
loadAll();
