// pages/api/analysis.ts
import type { NextApiRequest, NextApiResponse } from 'next';

type FuturesSymbol = 'ES' | 'NQ' | 'MNQ' | 'CL' | 'GC' | 'MGC';

interface FuturesQuote {
  symbol: FuturesSymbol;
  price: number | null;
  settlement: number | null;
  open: number | null;
  currHigh: number | null;
  currLow: number | null;
  debug: {
    source: string;
    foundSettlement: boolean;
    settlementSourceText: string;
    errors: string[];
    timestamp: string;
  };
  fallback: {
    used: boolean;
    reason: string;
    value: number | null;
  };
}

interface StopRunZone {
  kind: string;
  level: number;
}

interface LiquidityPayload {
  symbol: string;
  anchor: string | null;
  PDH: number;
  PDL: number;
  DailyEQ: number;
  PWH: number;
  PWL: number;
  WeeklyEQ: number;
  PMH: number;
  PML: number;
  MonthlyEQ: number;
  stop_run_zones: StopRunZone[];
  data_unavailable: boolean;
  data_state: string;
  notes: string;
}

type Bias = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
type VolatilityRegime = 'LOW' | 'NORMAL' | 'HIGH';

interface ODRSummary {
  label: 'INNER_RANGE' | 'OUTER_RANGE' | 'EXTENDED';
  score: number; // 0–100
  reasoning: string;
}

type PO3Phase = 'ACCUMULATION' | 'EXPANSION' | 'DISTRIBUTION' | 'EXHAUSTION';

interface PO3Summary {
  phase: PO3Phase;
  confidence: number; // 0–100
  notes: string;
}

interface GoldbachSummary {
  levels: number[];
  notes: string;
}

interface TwinTowerSummary {
  sequence: number[];
  notes: string;
}

interface AnalysisResponse {
  symbol: FuturesSymbol;
  price: number | null;
  settlement: number | null;
  bias: Bias;
  volatilityRegime: VolatilityRegime;

  liquidity: {
    anchor: string | null;
    PDH: number;
    PDL: number;
    DailyEQ: number;
    PWH: number;
    PWL: number;
    WeeklyEQ: number;
    PMH: number;
    PML: number;
    MonthlyEQ: number;
    stop_run_zones: StopRunZone[];
    data_unavailable: boolean;
    data_state: string;
    notes: string;
  };

  odr: ODRSummary;
  po3: PO3Summary;
  goldbach: GoldbachSummary;
  twin_tower: TwinTowerSummary;

  score: number; // 0–100 overall “setup quality”
  generated_at: string;
}

// 🔗 hard-coded to your deployed proxy (matches what the dashboard uses)
const BASE_URL = 'https://tradingview-liquidity-proxy-izh9.vercel.app';

// --- tiny helpers ---
function computeBias(price: number | null, settlement: number | null): Bias {
  if (price == null || settlement == null) return 'NEUTRAL';
  if (price > settlement) return 'BULLISH';
  if (price < settlement) return 'BEARISH';
  return 'NEUTRAL';
}

function computeVolatilityRegime(pdh: number, pdl: number, settlement: number | null): VolatilityRegime {
  if (settlement == null) return 'NORMAL';
  const range = pdh - pdl;
  const pct = range / settlement;
  if (pct < 0.005) return 'LOW';      // < 0.5%
  if (pct > 0.015) return 'HIGH';     // > 1.5%
  return 'NORMAL';
}

function computeODR(price: number | null, liq: LiquidityPayload): ODRSummary {
  if (price == null) {
    return {
      label: 'EXTENDED',
      score: 30,
      reasoning: 'Price unavailable – default neutral ODR.',
    };
  }

  const mid = (liq.PDH + liq.PDL) / 2;
  const dailyRange = liq.PDH - liq.PDL || 1;
  const distFromMid = Math.abs(price - mid);
  const distFromOuter = Math.min(Math.abs(price - liq.PDH), Math.abs(price - liq.PDL));

  if (distFromMid < dailyRange * 0.25) {
    return {
      label: 'INNER_RANGE',
      score: 70,
      reasoning: 'Price is trading near the mid of the daily range (ODR inner band).',
    };
  }

  if (distFromOuter < dailyRange * 0.25) {
    return {
      label: 'OUTER_RANGE',
      score: 80,
      reasoning: 'Price is trading near the extremes of the daily range (ODR outer band).',
    };
  }

  return {
    label: 'EXTENDED',
    score: 55,
    reasoning: 'Price is extended beyond classic ODR concentration zones.',
  };
}

function computePO3(price: number | null, settlement: number | null, liq: LiquidityPayload): PO3Summary {
  if (price == null || settlement == null) {
    return {
      phase: 'ACCUMULATION',
      confidence: 40,
      notes: 'Missing reference anchor; using low-confidence accumulation default.',
    };
  }

  const rel = (price - settlement) / settlement;

  if (Math.abs(rel) < 0.003) {
    return {
      phase: 'ACCUMULATION',
      confidence: 70,
      notes: 'Price hovering near settlement, suggesting accumulation / dealing range.',
    };
  }

  const aboveWeeklyEQ = price > liq.WeeklyEQ;
  const belowWeeklyEQ = price < liq.WeeklyEQ;

  if (rel > 0.01 && aboveWeeklyEQ) {
    return {
      phase: 'EXPANSION',
      confidence: 80,
      notes: 'Price expanding away from settlement above weekly EQ – expansion leg.',
    };
  }

  if (rel < -0.01 && belowWeeklyEQ) {
    return {
      phase: 'EXPANSION',
      confidence: 80,
      notes: 'Price expanding lower from settlement below weekly EQ – expansion leg down.',
    };
  }

  // simple distribution / exhaustion heuristics
  if (rel > 0.02 && price > liq.PWH) {
    return {
      phase: 'EXHAUSTION',
      confidence: 75,
      notes: 'Price extended well above settlement and prev week high – exhaustion risk.',
    };
  }

  if (rel < -0.02 && price < liq.PWL) {
    return {
      phase: 'EXHAUSTION',
      confidence: 75,
      notes: 'Price extended well below settlement and prev week low – exhaustion risk.',
    };
  }

  return {
    phase: 'DISTRIBUTION',
    confidence: 65,
    notes: 'Price oscillating between daily/weekly references – likely distribution.',
  };
}

function computeGoldbach(liq: LiquidityPayload): GoldbachSummary {
  // For now: use your stop_run_zones as the Goldbach cluster backbone.
  const levels = (liq.stop_run_zones || []).map(z => z.level);
  return {
    levels,
    notes: 'Goldbach cluster proxy using stop-run zones. Can be refined with full Goldbach engine later.',
  };
}

function computeTwinTower(): TwinTowerSummary {
  const sequence = [7, 6, 7, 10, 7, 6, 7];
  return {
    sequence,
    notes: 'ICT Twin Tower 7-6-7-10-7-6-7 template applied as structural timing scaffold.',
  };
}

function computeScore(
  bias: Bias,
  vol: VolatilityRegime,
  odr: ODRSummary,
  po3: PO3Summary,
): number {
  let score = 50;

  if (bias !== 'NEUTRAL') score += 5;
  if (vol === 'HIGH') score += 5;
  if (vol === 'LOW') score -= 5;

  score += (odr.score - 50) * 0.3;
  score += (po3.confidence - 50) * 0.3;

  return Math.max(0, Math.min(100, Math.round(score)));
}

// --- CORS helper ---
function applyCors(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AnalysisResponse | { error: string; message: string }>
) {
  if (req.method === 'OPTIONS') {
    applyCors(req, res);
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    applyCors(req, res);
    return res.status(405).json({ error: 'method_not_allowed', message: 'Use GET or OPTIONS.' });
  }

  applyCors(req, res);

  try {
    const symbolParam = String(req.query.symbol || 'ES').toUpperCase() as FuturesSymbol;

    // 1) Fetch futures snapshot from your existing /api/futures
    const futResp = await fetch(`${BASE_URL}/api/futures`);
    if (!futResp.ok) {
      throw new Error(`Futures API returned ${futResp.status} ${futResp.statusText}`);
    }
    const futJson = (await futResp.json()) as { timestamp: number; data: FuturesQuote[] };

    const quote = futJson.data.find(q => q.symbol === symbolParam) || null;

    // 2) Fetch liquidity from your existing /api/liquidity-levels
    const liqResp = await fetch(`${BASE_URL}/api/liquidity-levels?symbol=${symbolParam}`);
    if (!liqResp.ok) {
      throw new Error(`Liquidity API returned ${liqResp.status} ${liqResp.statusText}`);
    }
    const liqJson = (await liqResp.json()) as LiquidityPayload;

    const price = quote?.price ?? null;
    const settlement = quote?.settlement ?? null;

    const bias = computeBias(price, settlement);
    const volatilityRegime = computeVolatilityRegime(liqJson.PDH, liqJson.PDL, settlement);

    const odr = computeODR(price, liqJson);
    const po3 = computePO3(price, settlement, liqJson);
    const goldbach = computeGoldbach(liqJson);
    const twin_tower = computeTwinTower();

    const score = computeScore(bias, volatilityRegime, odr, po3);

    const response: AnalysisResponse = {
      symbol: symbolParam,
      price,
      settlement,
      bias,
      volatilityRegime,

      liquidity: {
        anchor: liqJson.anchor,
        PDH: liqJson.PDH,
        PDL: liqJson.PDL,
        DailyEQ: liqJson.DailyEQ,
        PWH: liqJson.PWH,
        PWL: liqJson.PWL,
        WeeklyEQ: liqJson.WeeklyEQ,
        PMH: liqJson.PMH,
        PML: liqJson.PML,
        MonthlyEQ: liqJson.MonthlyEQ,
        stop_run_zones: liqJson.stop_run_zones || [],
        data_unavailable: liqJson.data_unavailable,
        data_state: liqJson.data_state,
        notes: liqJson.notes,
      },

      odr,
      po3,
      goldbach,
      twin_tower,

      score,
      generated_at: new Date().toISOString(),
    };

    return res.status(200).json(response);
  } catch (err: any) {
    console.error('analysis ERROR:', err?.message || err);
    return res.status(500).json({
      error: 'analysis_failed',
      message: String(err?.message || err),
    });
  }
}
