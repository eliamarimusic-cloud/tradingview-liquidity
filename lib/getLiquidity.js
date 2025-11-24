// lib/getLiquidity.js
// lib/getLiquidity.js
// Core liquidity engine used by /api/liquidity-levels

// ---------- Time helpers (NY session) ----------
function getNYDateString(date) {
  const ny = new Date(
    date.toLocaleString("en-US", { timeZone: "America/New_York" })
  );
  return ny.toISOString().split("T")[0]; // YYYY-MM-DD
}

function getYesterdayNY() {
  const now = new Date();
  const ny = new Date(
    now.toLocaleString("en-US", { timeZone: "America/New_York" })
  );

  // Treat "anchor" as the most recently completed session.
  const marketCloseHour = 16;
  const marketCloseMinute = 15;

  // If we’re before ~4:15pm NY, “yesterday” is still the last fully closed session.
  if (
    ny.getHours() < marketCloseHour ||
    (ny.getHours() === marketCloseHour &&
      ny.getMinutes() < marketCloseMinute)
  ) {
    ny.setDate(ny.getDate() - 1);
  }

  return getNYDateString(ny);
}

// ---------- Yahoo helpers ----------
async function fetchYahoo(symbolTicker, interval = "1d", range = "2mo") {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbolTicker
  )}?interval=${interval}&range=${range}`;

  const r = await fetch(url);
  if (!r.ok) {
    throw new Error(`Yahoo fetch failed: ${r.status}`);
  }
  return r.json();
}

function buildBarsFromYahoo(result, interval) {
  const quote = result.indicators?.quote?.[0];
  const ts = result.timestamp;
  if (!quote || !ts) return [];

  return quote.high.map((h, i) => ({
    timestamp: ts[i] * 1000,
    nyDate: getNYDateString(new Date(ts[i] * 1000)),
    high: quote.high[i],
    low: quote.low[i],
    open: quote.open[i],
    close: quote.close[i],
    interval,
  }));
}

function highLowEq(bars) {
  if (!bars.length) return { high: 0, low: 0, eq: 0 };
  const high = Math.max(...bars.map((b) => b.high));
  const low = Math.min(...bars.map((b) => b.low));
  return { high, low, eq: (high + low) / 2 };
}

// ---------- Weekly / Monthly ranges ----------
function getPrevWeekRange(dateStr) {
  const date = new Date(dateStr + "T00:00:00");
  const day = date.getUTCDay(); // 0–6
  const isoDay = day === 0 ? 7 : day;

  // Monday of this week
  const monday = new Date(date);
  monday.setDate(monday.getDate() - (isoDay - 1));

  // Previous week Mon–Fri
  const prevWeekStart = new Date(monday);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);

  const prevWeekEnd = new Date(prevWeekStart);
  prevWeekEnd.setDate(prevWeekStart.getDate() + 4);

  return {
    start: getNYDateString(prevWeekStart),
    end: getNYDateString(prevWeekEnd),
  };
}

function getPrevMonthRange(dateStr) {
  const date = new Date(dateStr + "T00:00:00");
  const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);

  // last day of previous month
  const lastOfPrev = new Date(firstOfMonth);
  lastOfPrev.setDate(firstOfMonth.getDate() - 1);

  const firstOfPrev = new Date(lastOfPrev.getFullYear(), lastOfPrev.getMonth(), 1);

  return {
    start: getNYDateString(firstOfPrev),
    end: getNYDateString(lastOfPrev),
  };
}

function filterBarsByRange(bars, start, end) {
  return bars.filter((b) => b.nyDate >= start && b.nyDate <= end);
}

// ---------- SYMBOL MAP ----------
const YAHOO_SYMBOL_MAP = {
  ES: "ES=F",
  NQ: "NQ=F",
  MNQ: "MNQ=F",
  CL: "CL=F",
  GC: "GC=F",
  MGC: "MGC=F",
};

// ---------- MAIN EXPORT ----------
export default async function getLiquidity(symbol) {
  const upperSymbol = String(symbol || "").toUpperCase();
  const yfSymbol = YAHOO_SYMBOL_MAP[upperSymbol];
  const anchorDateStr = getYesterdayNY();

  if (!yfSymbol) {
    return {
      symbol: upperSymbol,
      anchor: anchorDateStr,
      PDH: 0,
      PDL: 0,
      DailyEQ: 0,
      PWH: 0,
      PWL: 0,
      WeeklyEQ: 0,
      PMH: 0,
      PML: 0,
      MonthlyEQ: 0,
      stop_run_zones: [],
      data_unavailable: true,
      data_state: "unsupported_symbol",
      notes: `Symbol ${upperSymbol} is not mapped to a Yahoo ticker.`,
    };
  }

  try {
    // ---- 1) Fetch daily history (2 months) ----
    const dailyResp = await fetchYahoo(yfSymbol, "1d", "2mo");
    const dailyResult = dailyResp?.chart?.result?.[0];
    const dailyBars = buildBarsFromYahoo(dailyResult, "1d");

    // Anchor = last completed NY session
    const dailyBar = dailyBars.find((b) => b.nyDate === anchorDateStr);

    let data_state;
    let notes;
    let daily;

    // ---- 2) Daily range (PDH/PDL/EQ) with fallback to intraday ----
    if (dailyBar && dailyBar.close != null) {
      data_state = "using_daily_close";
      notes = "Daily close available (Yahoo 1d data).";

      daily = {
        high: dailyBar.high,
        low: dailyBar.low,
        eq: (dailyBar.high + dailyBar.low) / 2,
      };
    } else {
      // Fallback: intraday bars for the anchor date
      const intradayResp = await fetchYahoo(yfSymbol, "5m", "2d");
      const intradayResult = intradayResp?.chart?.result?.[0];
      const intradayBars = buildBarsFromYahoo(intradayResult, "5m");
      const intradayForAnchor = intradayBars.filter(
        (b) => b.nyDate === anchorDateStr
      );

      if (intradayForAnchor.length) {
        const hi = Math.max(...intradayForAnchor.map((b) => b.high));
        const lo = Math.min(...intradayForAnchor.map((b) => b.low));

        daily = { high: hi, low: lo, eq: (hi + lo) / 2 };
        data_state = "using_intraday_fallback";
        notes =
          "Daily close not yet published — using 5m intraday range as fallback.";
      } else {
        daily = { high: 0, low: 0, eq: 0 };
        data_state = "waiting_for_daily_close";
        notes =
          "No daily or intraday bars found for anchor date — likely pre-session.";
      }
    }

    // ---- 3) Weekly & Monthly from daily bars ----
    const weekRange = getPrevWeekRange(anchorDateStr);
    const weekly = highLowEq(
      filterBarsByRange(dailyBars, weekRange.start, weekRange.end)
    );

    const monthRange = getPrevMonthRange(anchorDateStr);
    const monthly = highLowEq(
      filterBarsByRange(dailyBars, monthRange.start, monthRange.end)
    );

    // ---- 4) Stop-run zones (simple buffer bands) ----
    // For now: 1% buffers around daily & weekly extremes.
    const bufferPct = 0.01;

    const stopRunZones = [
      {
        kind: "DAILY_HIGH_STOP",
        level: +(daily.high * (1 + bufferPct)).toFixed(8),
      },
      {
        kind: "DAILY_LOW_STOP",
        level: +(daily.low * (1 - bufferPct)).toFixed(8),
      },
      {
        kind: "WEEKLY_HIGH_STOP",
        level: +(weekly.high * (1 + bufferPct)).toFixed(8),
      },
      {
        kind: "WEEKLY_LOW_STOP",
        level: +(weekly.low * (1 - bufferPct)).toFixed(8),
      },
    ].filter((z) => Number.isFinite(z.level));

    // ---- 5) Final payload for the dashboard ----
    return {
      symbol: upperSymbol,
      anchor: anchorDateStr,

      PDH: daily.high,
      PDL: daily.low,
      DailyEQ: daily.eq,

      PWH: weekly.high,
      PWL: weekly.low,
      WeeklyEQ: weekly.eq,

      PMH: monthly.high,
      PML: monthly.low,
      MonthlyEQ: monthly.eq,

      stop_run_zones: stopRunZones,
      data_unavailable: false,
      data_state,
      notes,
    };
  } catch (err) {
    console.error("getLiquidity ERROR:", err?.message || err);

    return {
      symbol: upperSymbol,
      anchor: anchorDateStr,
      PDH: 0,
      PDL: 0,
      DailyEQ: 0,
      PWH: 0,
      PWL: 0,
      WeeklyEQ: 0,
      PMH: 0,
      PML: 0,
      MonthlyEQ: 0,
      stop_run_zones: [],
      data_unavailable: true,
      data_state: "error",
      notes: String(err?.message || err),
    };
  }
}
