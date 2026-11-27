# FoodLink

**Offline community food-rescue and perishable pantry allocation workbench.** Plan a rescue run in a browser tab: watch shelf life decay in real time, route a volunteer van inside cold-chain limits, and pack balanced household boxes that respect allergies and dietary needs. No accounts, no servers, no network. One HTML file, plain ES modules, zero dependencies.

Live demo: `https://aariv.xyz/foodlink/`

## Why it exists

Food rescue teams juggle three clocks at once: produce wilting at ambient temperature, the FDA 4-hour danger-zone budget for cold food, and pantry closing times. FoodLink turns that juggling act into a visible, hands-on planning surface so volunteers, student organizers and pantry staff can rehearse a run before anyone turns a key.

## What it does

- **Cold-chain triage.** Every lot gets a live remaining-life countdown from a Q10 / Arrhenius thermal decay model anchored on the FDA Food Code (41 F / 5 C cold holding, 135 F / 57 C hot holding, cumulative 4-hour danger-zone rule for TCS foods). Warm the ambient slider and watch urgency tiers flip. Each lot shows life left in hours at 5 C and a "spoils in" window: the real time it has left if it keeps sitting at the current ambient temperature, capped by the 4-hour danger-zone clock for TCS foods.
- **Dispatch routing.** An exact solver (subset-aware exhaustive search up to 8 stops) and a nearest-neighbor + feasibility-aware 2-opt optimizer beyond it. Respects vehicle capacity in kg, donor and pantry time windows, service minutes, and a per-lot cold-chain transit budget. Reports route km, route minutes, rescued kg, servings delivered (summed from lot labels), spoiled kg, the tightest cold-chain margin (budget minus pantry-arrival-minus-pickup minutes for every delivered TCS lot), and landfill emissions avoided at the EPA WARM v15 food-donation low-end factor (0.54 MTCO2E per short ton, about 0.595 kg CO2e per kg delivered; avoided landfilling only, no upstream production credit).
- **Volunteer board.** The planned route splits into short runs that each end at a pantry, so the van can change hands there. Neighbors claim a run by first name, ask for a hand-off, or take one over. A relay strip shows which runs still need a driver, and the board counts food with a driver, households that get a box and the people in them. Claims ride in the share link (sanitized on the way in), stay put when a replan keeps the same stops, and are reported, not silently dropped, when a replan changes them. A plain-text neighborhood brief copies to a group chat, downloads as JSON, or prints on its own.
- **How it works drawer.** One button opens a drawer that explains the three engines, the FDA and EPA numbers behind them, what building it taught, and how AI assistance was used.
- **Household box allocation.** A greedy balanced allocator fills pantry boxes against per-person food-group targets (produce, protein, grain, dairy) while enforcing gluten-free, nut-free, dairy-free, halal, vegetarian and diabetic (low sugar, lower sodium) constraints. Every box shows its group balance and nutrient totals.
- **Four civic scenarios.** Saturday Farmers Market Rescue, School Cafeteria Surplus Share, Storm Power-Outage Cold-Chain Triage, and Thanksgiving Pantry Surge. All places are fictional. A lot editor plus JSON/CSV import and a URL-hash share format make any custom scenario portable.
- **Bilingual.** English / Espanol toggle for the whole interface, plus a printable dispatch manifest and a donation safety checklist grounded in the Bill Emerson Good Samaritan Food Donation Act.
- **Self-verifying.** The "Run self-tests" button executes the real engines in your browser and reports pass/fail on 31 invariants.

## Quick start

```bash
# any static server works; the bundled one is zero-dependency
node scripts/serve.mjs          # http://127.0.0.1:8080/
```

Or deploy the folder as-is to any static host. There is no build step.

## Tests

```bash
npm test        # node --test tests/    (no dependencies installed)
```

The suite covers Q10 monotonicity across every product class, FDA 41 F danger-zone boundaries, the 4-hour TCS discard rule, route feasibility, capacity and cold-chain compliance on all four scenarios, the 2-opt never-worse guarantee, exact-vs-heuristic agreement on small instances, allergen/constraint enforcement for every household, EPA WARM CO2e math, the spoils-in window agreeing with the engine's own spoil point, servings and cold-chain margins re-derived from every built-in plan, CSV and JSON round-trips, malformed hash recovery, and EN/ES key parity.

A headless-browser audit (`scripts/browser-check.mjs`, needs a Playwright install pointed at it via `PLAYWRIGHT_MJS`) drives real Chrome at 1440x900, 768x1024 and 390x844: every tab, scenario and control is exercised, including arrow-key tab navigation; console errors, page errors, external requests and horizontal overflow are asserted to zero.

## Layout

```
index.html  styles.css  app.mjs     workbench UI (pure ES modules + inline SVG)
src/spoilage.mjs    Q10 / Arrhenius shelf-life + FDA danger-zone engine
src/nutrition.mjs   food-group box allocator + dietary constraints
src/routing.mjs     exact + NN/2-opt dispatch planner + EPA WARM CO2e
src/impact.mjs      spoils-in window, servings delivered, cold-chain margins
src/shifts.mjs      volunteer runs, claims and hand-offs, neighborhood brief
src/scenarios.mjs   4 scenarios + validators + CSV/JSON/hash codecs
src/i18n.mjs        EN/ES strings, manifest text, safety checklist
src/selftest.mjs    shared invariant suite (browser + Node)
tests/              node:test unit, property and invariant suites
scripts/serve.mjs   zero-dependency static server
scripts/browser-check.mjs
```

## Honest scope

FoodLink is a planning and teaching tool. Temperatures, times, distances and constraint rules are transparent models, not medical, legal or regulatory advice. Scenarios are fictional; verify real donations against your local food code and the receiving organization's policies.

## Attribution

Built by Aariv Patel with AI coding assistants inside T3 Code: Devin (SWE-2) and Claude helped with implementation, tests and documentation under his direction. The same disclosure appears in the app's How it works drawer. Reference factors: FDA Food Code cold/hot holding and the 4-hour TCS rule; EPA WARM v15 "Modeling Food Donation Benefits in WARM" (2019), Table 1 low-end estimate; USDA MyPlate-style food groups.
