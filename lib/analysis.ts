// /api/analysis.ts
// Time-aware reversal analysis backend for the dashboard.
// Uses existing /api/liquidity-levels and /api/futures endpoints.

import { runAnalysis } from "../lib/analysisEngine";

// Minimal local shapes to keep TypeScript happy without extra deps.
type Req = {
  method?: string;
  query: { [key: string]: string | string[] | undefined };
};

type Res = {
  status: (code: number) => Res;
  json: (body: any) => void;
  setHeader: (name: string, value: string) => void;
  end: () => void;
};

function getQuerySymbol(raw: string | string[] | undefined): string {
  if (!raw) return "ES";
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (v || "ES").toUpperCase();
}

export default async function handler(req: Req, res: Res) {
  // ---- CORS preflight ----
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  // ---- Standard CORS headers ----
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  const symbol = getQuerySymbol(req.query.symbol);

  try {
    // Base URL for internal calls (same deployment)
    const baseUrl =
      process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000";

    // 1) Fetch liquidity for this symbol
    const liqResp = await fetch(
      `${baseUrl}/api/liquidity-levels?symbol=${encodeURIComponent(symbol)}`
    );
    if (!liqResp.ok) {
      throw new Error(
        `liquidity-levels failed: ${liqResp.status} ${liqResp.statusText}`
      );
    }
    const liqData: any = await liqResp.json();

    // 2) Fetch all futures, pick current symbol
    const futResp = await fetch(`${baseUrl}/api/futures`);
    if (!futResp.ok) {
      throw new Error(
        `futures failed: ${futResp.status} ${futResp.statusText}`
      );
    }
    const futJson: any = await futResp.json();
    const futuresList: any[] = Array.isArray(futJson?.data) ? futJson.data : [];
    const fut = futuresList.find((f) => f.symbol === symbol) ?? null;

    // ---------- Build minimal MarketData-like object ----------
    const pdh = liqData?.PDH ?? 0;
    const pdl = liqData?.PDL ?? 0;
    const range = Math.abs(pdh - pdl);
    const atr = range > 0 ? range : 10; // simple fallback

    const price =
      fut?.price ??
      liqData?.DailyEQ ??
      (pdh && pdl ? (pdh + pdl) / 2 : 0);

    const marketLike: any = {
      symbol,
      name: symbol,
      price,
      change: 0,
      changePercent: 0,
      volume: 0,
      high: pdh,
      low: pdl,
      open: fut?.open ?? liqData?.DailyEQ ?? price,
      midnightOpen: fut?.open ?? price,
      prevClose: fut?.settlement ?? liqData?.DailyEQ ?? price,

      prevDayHigh: pdh,
      prevDayLow: pdl,

      prevWeekHigh: liqData?.PWH ?? pdh,
      prevWeekLow: liqData?.PWL ?? pdl,

      prevMonthHigh: liqData?.PMH ?? pdh,
      prevMonthLow: liqData?.PML ?? pdl,

      prevQuarterHigh: liqData?.PMH ?? pdh,
      prevQuarterLow: liqData?.PML ?? pdl,

      weeklyHigh: liqData?.PWH ?? pdh,
      monthlyHigh: liqData?.PMH ?? pdh,

      vwapFixPrice: fut?.settlement ?? liqData?.DailyEQ ?? price,
      atr,

      liquidityNotes: liqData?.notes ?? "",
      liquidityAnchor: liqData?.anchor ?? null,
      liquidityDataState: liqData?.data_state ?? "unknown",

      stopRunZones: Array.isArray(liqData?.stop_run_zones)
        ? liqData.stop_run_zones.map((z: any) =>
            typeof z === "number" ? z : z?.level ?? 0
          )
        : [],

      externalKeyLevels: [],

      calibration: {
        price,
        wapvPrice: null,
        midnightOpen: null,
        settlement: fut?.settlement ?? null,
        applied: false,
        timestamp: Date.now(),
      },

      settlement: fut?.settlement ?? null,
      close: fut?.settlement ?? null,

      calibrationDebug: {
        settlementSource: "API",
        value: fut?.settlement ?? 0,
        note: "Synthetic MarketData constructed in /api/analysis",
      },

      po3Context: undefined,
      backendAnalysis: undefined,

      // Simple regime placeholder to keep engine happy
      regimeScore: 50,
      regime: {
        type: "BALANCED",
        volatility: "NORMAL",
        bias: "NEUTRAL",
        continuationFavored: false,
        reversalFavored: true,
        description: "Backend synthetic regime (default)",
        reasons: ["No full regime model attached yet"],
      },
    };

    // ---------- Wrap liquidity in the shape expected by runAnalysis ----------
    const liqWrapper = {
      liquidity: {
        anchor: liqData?.anchor ?? null,
        PDH: pdh,
        PDL: pdl,
        DailyEQ: liqData?.DailyEQ ?? 0,
        PWH: liqData?.PWH ?? 0,
        PWL: liqData?.PWL ?? 0,
        WeeklyEQ: liqData?.WeeklyEQ ?? 0,
        PMH: liqData?.PMH ?? 0,
        PML: liqData?.PML ?? 0,
        MonthlyEQ: liqData?.MonthlyEQ ?? 0,
        stop_run_zones: Array.isArray(liqData?.stop_run_zones)
          ? liqData.stop_run_zones
          : [],
        data_unavailable: !!liqData?.data_unavailable,
        data_state: liqData?.data_state ?? "unknown",
        notes: liqData?.notes ?? "",
      },
      goldbachLevels: [],       // can be extended later
      twinTower: {
        sequence: [],
        notes: "",
      },
      goldbachWindows: [],
    };

    // ---------- Run the analysis engine ----------
    const analysis = runAnalysis(symbol, marketLike, liqWrapper, fut);

    return res.status(200).json(analysis);
  } catch (err: any) {
    console.error("analysis ERROR:", err?.message || err);
    return res.status(500).json({
      error: "analysis_failed",
      message: String(err?.message || err),
      symbol,
    });
  }
}
