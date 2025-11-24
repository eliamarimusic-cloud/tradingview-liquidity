// lib/getLiquidity.js
export default async function getLiquidity(symbol) {
  return {
    symbol,
    anchor: null,
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
    data_state: "placeholder",
    notes: "Implement real liquidity logic."
  };
}
