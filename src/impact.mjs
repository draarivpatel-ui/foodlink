// FoodLink impact read-outs. Pure functions over what the spoilage and routing
// engines already compute; nothing here adds a new model or a new factor.
//
//   ambientWindowHours  real hours a lot has left if it keeps sitting at the
//                       current ambient temperature (Q10 decay plus, for TCS
//                       lots in the danger zone, the FDA 4-hour clock)
//   servingsDelivered   servings on lots the plan delivers inside the budget
//   coldChainMargins    transit minutes and remaining budget for every TCS lot
//                       the plan delivers (pantry arrival minus donor arrival,
//                       the same rule simulateOrder applies)

import {
  classOf, isTCS, q10Rate, dangerAccrualPerMin, DANGER_ZONE_LIMIT_MIN,
} from './spoilage.mjs';

export function ambientWindowHours(lot, assessment, ambientC) {
  if (!assessment || assessment.spoiled) return 0;
  const life = Math.max(0, Number(assessment.lifeLeftHours) || 0);
  const rate = q10Rate(ambientC, classOf(lot).q10);
  let hours = life / rate;
  if (isTCS(lot) && dangerAccrualPerMin(ambientC) > 0) {
    const dangerLeftMin = Math.max(0, DANGER_ZONE_LIMIT_MIN - (Number(assessment.dangerMinutes) || 0));
    hours = Math.min(hours, dangerLeftMin / 60);
  }
  return hours;
}

// Compact label for a duration in hours: "25 min", "3.5 h", "4 d 2 h".
export function formatWindow(hours) {
  if (!Number.isFinite(hours) || hours < 0) return '-';
  if (hours < 1) return `${Math.max(0, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.round(hours * 10) / 10} h`;
  const d = Math.floor(hours / 24);
  const rem = Math.round(hours - d * 24);
  return rem === 24 ? `${d + 1} d 0 h` : `${d} d ${rem} h`;
}

function lotIndex(scenario) {
  const byId = new Map();
  for (const d of scenario?.donors || []) for (const l of d.lots || []) byId.set(l.id, l);
  return byId;
}

export function servingsDelivered(plan, scenario) {
  const byId = lotIndex(scenario);
  let n = 0;
  for (const v of plan?.visits || []) {
    for (const id of v.delivered || []) n += Number(byId.get(id)?.servings) || 0;
  }
  return n;
}

export function coldChainMargins(plan, scenario, budgetMin) {
  const byId = lotIndex(scenario);
  const pickedAt = new Map();
  const rows = [];
  for (const v of plan?.visits || []) {
    for (const id of v.picked || []) pickedAt.set(id, v.arrive);
    for (const id of v.delivered || []) {
      const lot = byId.get(id);
      if (!lot || !isTCS(lot) || !pickedAt.has(id)) continue;
      const transitMin = v.arrive - pickedAt.get(id);
      rows.push({ lotId: id, name: lot.name, transitMin, marginMin: budgetMin - transitMin });
    }
  }
  rows.sort((a, b) => a.marginMin - b.marginMin);
  return { rows, tightest: rows[0] || null };
}
