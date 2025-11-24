// api/liquidity-levels.js
import getLiquidity from "../lib/getLiquidity.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  try {
    const { symbol } = req.query;
    if (!symbol) return res.status(400).json({ error: "Missing symbol parameter" });

    const result = await getLiquidity(symbol.toUpperCase());
    return res.status(200).json(result);

  } catch (err) {
    return res.status(200).json({
      symbol: req.query.symbol ?? null,
      anchor: null,
      PDH: 0, PDL: 0, DailyEQ: 0,
      PWH: 0, PWL: 0, WeeklyEQ: 0,
      PMH: 0, PML: 0, MonthlyEQ: 0,
      stop_run_zones: [],
      data_unavailable: true,
      data_state: "error",
      notes: String(err?.message || err)
    });
  }
}
