// lib/analysisEngine.ts
// Fully compatible with your saved types.ts interfaces & backend structure.

import {
  AnalysisResponse,
  LiquidityDraw,
  MarketData,
  ReversalLevel,
  GoldbachTime,
  GoldbachTimeBucket,
  TimeContext,
  KillzoneTag,
  SessionTag,
  Po3CycleInfo
} from "./types";

// -------------------------------
// 🔥 FIXED TIME + SESSION ENGINE
// -------------------------------

const NY_TZ = "America/New_York";

/** Get *exact* New York Date() in local timezone */
export function getNYDate(): Date {
  const nowUtc = new Date();
  return new Date(
    nowUtc.toLocaleString("en-US", {
      timeZone: NY_TZ,
    })
  );
}

/** YYYY-MM-DD in NY time — SAFE */
export function getNYDateString(date?: Date): string {
  const d = date ? date : getNYDate();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** NY local time as ISO string */
export function getNYIso(): string {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: NY_TZ })
  ).toISOString();
}

/** NY hour + minute from real NY-local Date */
export function getNYHM() {
  const d = getNYDate();
  return {
    hour: d.getHours(),
    minute: d.getMinutes(),
    minutesTotal: d.getHours() * 60 + d.getMinutes(),
  };
}

/** Returns the correct “yesterday in NY” accounting for RTH close (16:00) */
export function getYesterdayNY(): string {
  const ny = getNYDate();
  const h = ny.getHours();
  const min = ny.getMinutes();

  // If before 16:00 NY, previous session’s date = yesterday
  if (h < 16 || (h === 16 && min < 1)) {
    ny.setDate(ny.getDate() - 1);
  }

  return getNYDateString(ny);
}

/** Build fully accurate time context with sessions + killzones */
export function buildTimeContext(): TimeContext {
  const nowNY = getNYDate();
  const iso = nowNY.toISOString();

  const { hour, minutesTotal } = getNYHM();

  // --- Sessions (NY time)
  let session: MarketSession = "OFF_HOURS";

  if (minutesTotal >= 0 && minutesTotal < 300) {
    session = "ASIA";
  } else if (minutesTotal >= 300 && minutesTotal < 480) {
    session = "LONDON";
  } else if (minutesTotal >= 540 && minutesTotal < 690) {
    session = "NY_PREOPEN";
  } else if (minutesTotal >= 570 && minutesTotal < 720) {
    session = "NY_AM";
  } else if (minutesTotal >= 720 && minutesTotal < 900) {
    session = "NY_LUNCH";
  } else if (minutesTotal >= 900 && minutesTotal < 960) {
    session = "NY_PM";
  } else if (minutesTotal >= 960 && minutesTotal < 1020) {
    session = "CLOSE";
  }

  // --- Killzones (NY minutes)
  const kz = [
    { tag: "ASIA_OPEN", start: 20, end: 120 },
    { tag: "LONDON_OPEN", start: 300, end: 360 },
    { tag: "NY_AM", start: 540, end: 690 },
    { tag: "NY_LUNCH", start: 720, end: 780 },
    { tag: "POWER_HOUR", start: 900, end: 960 },
  ];

  const activeKZ =
    kz.find((z) => minutesTotal >= z.start && minutesTotal <= z.end) || null;

  // --- Time Score
  let timeScore = 20;
  if (activeKZ) timeScore += 30;
  if (hour >= 9 && hour <= 12) timeScore += 25; // AM volatility
  if (hour >= 14 && hour <= 16) timeScore += 20; // PM reversal risk
  if (hour < 6) timeScore -= 10; // overnight chop

  if (timeScore < 0) timeScore = 0;
  if (timeScore > 100) timeScore = 100;

  return {
    nowEST: iso,
    session,
    inReversalWindow: !!activeKZ,
    killzone: activeKZ?.tag ?? "NONE",
    isRTH: minutesTotal >= 570 && minutesTotal <= 960,
    goldbachBucket: "NONE",
    nextKeyTimeISO: null,
    timeScore,
    notes: [`Session: ${session}`, activeKZ ? `Killzone: ${activeKZ.tag}` : "Outside killzones"],
  };
}


/* ---------------------------------------------
   🔥 SESSION ENGINE (RTH, London, Asia, etc.)
---------------------------------------------- */
export function getSessionTag(mins: number): SessionTag {
  // You can tune these windows later (Step F3–F6)
  if (mins >= 0 && mins < 120) return "ASIA";
  if (mins >= 120 && mins < 480) return "LONDON";
  if (mins >= 540 && mins < 600) return "NY_PREOPEN";
  if (mins >= 570 && mins < 690) return "NY_AM";
  if (mins >= 690 && mins < 780) return "NY_LUNCH";
  if (mins >= 780 && mins < 960) return "NY_PM";
  if (mins >= 960 && mins < 1020) return "CLOSE";

  return "OFF_HOURS";
}

/* ------------------------------------------------
   🔥 GOLDEN CLOCK (29–35–71–77 minutes logic)
------------------------------------------------- */
export function getGoldbachBucket(mins: number): GoldbachTimeBucket {
  const buckets = [
    29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79
  ];

  for (const b of buckets) {
    if (Math.abs(mins - b) <= 2) return "MAJOR";
    if (Math.abs(mins - b) <= 5) return "MINOR";
  }
  return "NONE";
}

/* ---------------------------------------------
   🔥 TIME CONTEXT  (Phase F)
---------------------------------------------- */
export function buildTimeContext(): TimeContext {
  const now = new Date();
  const ny = toNY(now);

  const mins = getNYMinutes(ny);

  const session = getSessionTag(mins);
  const killzone: KillzoneTag =
    mins >= 540 && mins <= 660
      ? "NY_OPEN"
      : mins >= 660 && mins <= 780
      ? "NY_LUNCH"
      : mins >= 900 && mins <= 960
      ? "NY_PM"
      : "NONE";

  const goldbach = getGoldbachBucket(mins);

  const timeScore =
    (goldbach === "MAJOR" ? 90 :
     goldbach === "MINOR" ? 55 : 20) +
    (session === "NY_AM" || session === "NY_PM" ? 20 : 0);

  return {
    nowEST: ny.toISOString(),
    session,
    isKillzone: killzone !== "NONE",
    killzone,
    inReversalWindow: session === "NY_AM" || session === "NY_PM",
    goldbachBucket: goldbach,
    timeScore,
    nextKeyTimeISO: null,
    notes: [
      `Session: ${session}`,
      `NY Minutes: ${mins}`,
      `Goldbach: ${goldbach}`,
      timeScore > 60
        ? "High-probability timing window"
        : "Neutral timing conditions"
    ]
  };
}

/* ---------------------------------------------
   🔥 ODR ENGINE (very simple version)
---------------------------------------------- */
function computeODR(market: MarketData) {
  const range = market.prevDayHigh - market.prevDayLow;
  const low = market.prevDayLow;
  const high = market.prevDayHigh;

  const mid = low + range * 0.5;
  const upper = low + range * 0.75;
  const lower = low + range * 0.25;

  let label: "INNER_RANGE" | "OUTER_RANGE" | "EXTENDED" = "INNER_RANGE";
  if (market.price > upper) label = "EXTENDED";
  else if (market.price < lower) label = "OUTER_RANGE";

  const score = label === "EXTENDED" ? 90 : label === "OUTER_RANGE" ? 70 : 40;

  return {
    label,
    score,
    reasoning: `Price relative to prior-day range → ${label}`
  };
}

/* ---------------------------------------------
   🔥 PO3 ENGINE (simple)
---------------------------------------------- */
function computePO3(market: MarketData) {
  const mid = (market.prevDayHigh + market.prevDayLow) / 2;
  const diff = market.price - mid;

  const phase: "ACCUMULATION" | "EXPANSION" | "DISTRIBUTION" | "EXHAUSTION" =
    diff > market.atr ? "EXPANSION" :
    diff < -market.atr ? "DISTRIBUTION" :
    Math.abs(diff) < market.atr * 0.3 ? "ACCUMULATION" :
    "EXHAUSTION";

  return {
    phase,
    confidence: phase === "EXPANSION" ? 85 : phase === "ACCUMULATION" ? 60 : 40,
    notes: `PO3 phase identified: ${phase}`
  };
}

/* ---------------------------------------------
   🔥 GOLDEN ZONE PRICE CLUSTERS (simple version)
---------------------------------------------- */
function computeGoldbachLevels(market: MarketData): GoldbachTimeBucket {
  const buckets = [29, 35, 71, 77];
  const now = toNY(new Date());
  const mins = getNYMinutes(now);

  for (const b of buckets) {
    if (Math.abs(mins - b) <= 3) return "MAJOR";
  }
  return "NONE";
}

/* ---------------------------------------------
   🔥 COMPUTE EXPECTANCY SCORE (0–100)
---------------------------------------------- */
function computeExpectancyScore(args: {
  liquidityScore: number;
  timeScore: number;
  structureScore: number;
  regimeScore: number;
}): number {
  return Math.round(
    args.liquidityScore * 0.35 +
    args.timeScore * 0.25 +
    args.structureScore * 0.20 +
    args.regimeScore * 0.20
  );
}

/* ---------------------------------------------
   🔥 COMPUTE SINGLE REVERSAL LEVEL (Phase 5)
---------------------------------------------- */
function computeReversalLevel(
  draw: LiquidityDraw,
  market: MarketData,
  time: TimeContext
): ReversalLevel {
  const priceDiff = Math.abs(draw.price - market.price);

  // Basic "price score"
  const priceScore = Math.max(0, 100 - (priceDiff / market.atr) * 20);

  const confidence = Math.round(
    (priceScore * 0.6) + (time.timeScore * 0.4)
  );

  const side =
    draw.type === "LOW" || draw.type.includes("LOW")
      ? "LONG"
      : draw.type === "HIGH" || draw.type.includes("HIGH")
      ? "SHORT"
      : "NEUTRAL";

  return {
    price: draw.price,
    label: draw.label,
    side,
    grade:
      confidence > 75 ? "A" :
      confidence > 55 ? "B" :
      "C",
    confidence,
    reasons: [
      `Proximity: ${priceDiff.toFixed(2)} pts`,
      `TimeScore: ${time.timeScore}`,
      `Type: ${draw.type}`
    ],
    odrContext: "ODR-Core",
    po3Hit: false,
    po3Level: null,
    goldbachClusterScore: time.goldbachBucket === "MAJOR" ? 90 : 40,
    liquidityConfluence: priceScore,
    killzoneMatch: time.isKillzone ? [time.killzone!] : [],
    po4Exhaustion: "NONE",
    sessionState:
      time.session === "NY_AM" || time.session === "NY_PM"
        ? "trend"
        : "neutral",
    structure: { shift: "none", event: "none" },
    fvg: { hasFVG: false, direction: "none" },
    liquidityValidation: {
      stopBuildUp: false,
      equalHighLow: false,
      sweepSetup: false,
      score: priceScore
    },
    atrExecution: {
      atr: market.atr,
      stopDistance: +(market.atr * 0.5).toFixed(2),
      rrScore: Math.min(priceScore, 100),
      atrOk: true
    },
    executionState: confidence > 70 ? "READY" : confidence > 50 ? "SETUP" : "AVOID"
  };
}

/* ---------------------------------------------
   🔥 MAIN ENGINE — runAnalysis()
---------------------------------------------- */
export function runAnalysis(
  symbol: string,
  market: MarketData,
  liq: any,
  futures: any
): AnalysisResponse {
  const nowIso = new Date().toISOString();

  const time = buildTimeContext();

  const odr = computeODR(market);
  const po3 = computePO3(market);

  const goldbachBucket = computeGoldbachLevels(market);

  const liquidityScore = 70;     // placeholder until step F4/F5
  const structureScore = 50;     // placeholder
  const regimeScore = market.regimeScore ?? 50;

  const expectancy = {
    liquidityScore,
    timeScore: time.timeScore,
    structureScore,
    compositeScore: computeExpectancyScore({
      liquidityScore,
      timeScore: time.timeScore,
      structureScore,
      regimeScore
    })
  };

  const levels: ReversalLevel[] = (liq?.levels ?? []).map((lvl: LiquidityDraw) =>
    computeReversalLevel(lvl, market, time)
  );

  return {
    symbol,
    price: market.price,
    settlement: liq?.liquidity?.settlement ?? market.settlement ?? null,
    bias: market.regime?.bias ?? "NEUTRAL",
    volatilityRegime: market.regime?.volatility ?? "NORMAL",

    liquidity: {
      anchor: liq?.liquidity?.anchor ?? null,
      PDH: liq?.liquidity?.PDH ?? 0,
      PDL: liq?.liquidity?.PDL ?? 0,
      DailyEQ: liq?.liquidity?.DailyEQ ?? 0,
      PWH: liq?.liquidity?.PWH ?? 0,
      PWL: liq?.liquidity?.PWL ?? 0,
      WeeklyEQ: liq?.liquidity?.WeeklyEQ ?? 0,
      PMH: liq?.liquidity?.PMH ?? 0,
      PML: liq?.liquidity?.PML ?? 0,
      MonthlyEQ: liq?.liquidity?.MonthlyEQ ?? 0,
      stop_run_zones: Array.isArray(liq?.liquidity?.stop_run_zones)
        ? liq.liquidity.stop_run_zones
        : [],
      data_unavailable: liq?.liquidity?.data_unavailable ?? false,
      data_state: liq?.liquidity?.data_state ?? "unknown",
      notes: liq?.liquidity?.notes ?? ""
    },

    odr,
    po3,

    goldbach: {
      levels: liq?.goldbachLevels ?? [],
      notes: `Current time bucket: ${goldbachBucket}`
    },

    twin_tower: {
      sequence: liq?.twinTower?.sequence ?? [],
      notes: liq?.twinTower?.notes ?? ""
    },

    score: expectancy.compositeScore,
    generated_at: nowIso,

    time_score: time.timeScore,
    reversal_probability: expectancy.compositeScore,
    session_bias: market.regime?.bias ?? "NEUTRAL",

    time_state: {
      ...time,
      label: time.session
    },

    odrBias: odr.label === "EXTENDED" ? "Premium" :
             odr.label === "OUTER_RANGE" ? "Discount" :
             "Midrange",

    expectancy,
    goldbachWindows: liq?.goldbachWindows ?? [],
    levels,

    // placeholder — real implementation comes in Step F5-F6
    odr: odr,
  };
}
