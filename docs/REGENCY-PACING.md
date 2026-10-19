# Regency and unwoken pacing — 18 October 2026

Current baseline for #1814, after the shared ladder calibration (#1802) and late Long Line account (#1807). Measurement source: `ce86d24ba760bf7866b3bd65892506f1e63fd24e`. There are 104 played policy/campaign histories: seeds 901–902 and 5100–5123, chronicler and ascendant, actual Short (300-year) and Long (500-year) campaigns. Early endings stop the denominator. The two seed pools remain separate below; neither the old G1 numbers nor a truncated Long Line stand in for a current Short Line. No new density threshold is set.

Measured source trees: core `8b96f84abed3c3b90b9a8a9035e5d930c7605802`, content `fac6cbc030e1df05e471203f0efbe1fd07bd38ef`. These identify the measured code and content through later rebases.

## Concrete pacing bottlenecks

The G1 Long sample has meaningful family decisions during both categories, but few current routes through the exact ladder blocker. Regency has a route in 189/2,033 chronicler years and 111/1,460 ascendant years; unwoken stretches have one in 61/679 and 58/649. Almost every unwoken year is waiting on awakening (678/679 chronicler; 637/649 ascendant); the recorded routes in those stretches are offered Matches, which act on the next generation. Book searches can be deliberate spine beats without moving that particular awakening predicate. This is a wait for an appropriate route, not proof that the bot has tried every available Table action.

- Long/chronicler seed 5105, Fritha the second, 1164–1208: a 45-year Regency entirely behind no-expresser, four actionable years and a 13-year quiet gap. It still contains ten meaningful choices, four Matches and one meaningful Record.
- Long/ascendant seed 5106, Rhian the fourth, 1501–1542: a 42-year Regency with a 13-year quiet gap, seven actionable years, and 23 no-expresser / 14 awakening / five books years.
- Long/ascendant seed 5112, Merrick the sixth, 1356–1375: 20 unwoken years, all blocked on awakening, no current route, no Match or deliberate order, three meaningful choices, and a seven-year quiet gap.
- Short/ascendant seed 5116, Amice, 1158–1231: a 74-year Regency, 51 no-expresser / 23 power years, one actionable Match year, and the sample's longest quiet gap: 14 years.

The longest Regency itself is 85 years for Long/chronicler, 82 for Long/ascendant, 77 for Short/chronicler and 74 for Short/ascendant. Exact maintenance is zero under the strict house-wide identity test, while routine presentations remain nonzero; the former does not erase the latter. No policy sends a deliberate bid/lot-bid order, so auction-decision counts are zero rather than an availability judgment. The full interval tables and ending mixes below retain early failures and the less quiet stretches as well as these worst cases.

## Reading the instrument

Regency means a woman actually holding the seal. Unwoken means a seated male Head and no witnessed living expresser in the house. A vacancy is neither. Succession splits an interval even if its category stays the same; this differs from G1’s longer frozen stretches, which could cross several Heads. Intervals are sampled after the year turns, before its docket is answered.

Meaningful choice uses the existing interruption guard, excluding the existing predetermined-choice classification. An honest Record may be routine under that guard; omission and embellishment retain their moral choice. Match includes a successfully taken or declined hand. Auctions are the bid/lot-bid subset of successful deliberate Table orders, not every automatic sale. Naming forms never enter these counts.

Automatic resolutions are separately counted outcome/Record/Match log entries without a separately answered docket. An implicit Record after a choice is a separate automatic resolution. Ordinary births and mortality are not decisions. Routine is the guard/shape classification; exact maintenance additionally requires the same template, verb, targets and answer in an unchanged conservative house-wide material situation. It excludes clock/prose/frequency/counter/cache changes, but includes resources, roles, lives, marriages, acquired traits, learned workings, rites, property and remembered facts. A zero maintenance count is a strict lower-bound reading, not evidence that recurring routine scenes feel different.

Quiet is the longest consecutive run of years without a spine beat inside the interval, including leading/trailing gaps. Spine includes meaningful choice/Record, Match, a successful deliberate order, Age boundary, and changed seal, witnessed awakening/rite bearers, clauses, highest rung, Regalia or durable land state. Annual harvest/yield-factor rolls do not reset this clock; ownership, title, control, contest and permanent improvements/damage do.

Actionable means a currently offered verb can move the foremost man’s exact first unmet predicate, read before answers through the existing blocker reader. It does not mean the policy takes that verb. Chronicler sends no deliberate Table orders. Ascendant uses the existing book-search/rite/clause-search orders and its existing direct Scion/heir and auction configuration; these setup writes are not invented Table orders. Orders retain their actual date, including preparation before the next year turns.

The shared `playStallRun` loop retains the original ending-batch and ladder-decide salts and decisions. Full on/off saved-state fingerprints, including lazy genomes and the decision log, match on seeds 901–902 for both policies and campaigns (eight paired replays). Additional completed replay pairs also match. The existing first-choice/always-Record density player is a different policy: all its legacy result fields and ordered choice visits match its same-runtime 901–902 controls at both terms. Its default is preserved.

## Reproduce

```bash
npm run gate:density -- --policies=chronicler,ascendant --seeds=901,902 500 300 --output=regency-901-902.json
npm run gate:density -- --policies=chronicler,ascendant --seeds=5100,5101,5102,5103,5104,5105,5106,5107,5108,5109,5110,5111,5112,5113,5114,5115,5116,5117,5118,5119,5120,5121,5122,5123 500 300 --output=regency-G1.json
```

Counts below are totals; parenthesised rates divide by the actual years in that category. Auction counts overlap orders. A blocked year is a year without a current route for the specific ladder predicate, not a year without any meaningful decision.

## Short / chronicler / 901–902

2 histories; 486 actual played years. Endings: broken_line 1, forgotten 1.

| Category | Intervals | Years (share of played) | Mean/max length | Quiet max | Choice | Match | Record | Auction | Orders | Routine | Automatic | Maintenance | Route / no route years |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| regency | 1 | 8 (1.6%) | 8.0/8 | 3 | 2 (0.25/y) | 0 (0.00/y) | 2 (0.25/y) | 0 (0.00/y) | 0 (0.00/y) | 0 (0.00/y) | 1 (0.12/y) | 0 (0.00/y) | 0 / 8 |
| unwoken | 3 | 62 (12.8%) | 20.7/49 | 5 | 17 (0.27/y) | 5 (0.08/y) | 0 (0.00/y) | 0 (0.00/y) | 0 (0.00/y) | 2 (0.03/y) | 2 (0.03/y) | 0 (0.00/y) | 5 / 57 |

Every interval follows. Blocker counts are years with that first unmet predicate.

| Seed | Head (id) | Category | From–to | Years | Quiet | Choice | Match | Record | Auction | Orders | Routine | Automatic | Maintenance | Route / no route | Blocker years |
|---:|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 901 | Daveed Gearithy (`p_1`) | unwoken | 1043–1047 | 5 | 3 | 1 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 1 / 4 | awakening:5 |
| 902 | Daveed Gearithy (`p_1`) | unwoken | 1043–1091 | 49 | 5 | 15 | 4 | 0 | 0 | 0 | 2 | 1 | 0 | 4 / 45 | awakening:49 |
| 902 | Merrick (`p_3`) | unwoken | 1092–1099 | 8 | 4 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 8 | awakening:8 |
| 902 | Jehane the second (`p_z`) | regency | 1150–1157 | 8 | 3 | 2 | 0 | 2 | 0 | 0 | 0 | 1 | 0 | 0 / 8 | awakening:5, no-expresser:3 |

## Short / chronicler / G1 5100–5123

24 histories; 6800 actual played years. Endings: broken_line 2, devoured 8, forgotten 9, settled 5.

| Category | Intervals | Years (share of played) | Mean/max length | Quiet max | Choice | Match | Record | Auction | Orders | Routine | Automatic | Maintenance | Route / no route years |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| regency | 39 | 1106 (16.3%) | 28.4/77 | 12 | 312 (0.28/y) | 46 (0.04/y) | 40 (0.04/y) | 0 (0.00/y) | 0 (0.00/y) | 53 (0.05/y) | 91 (0.08/y) | 0 (0.00/y) | 74 / 1032 |
| unwoken | 33 | 563 (8.3%) | 17.1/47 | 6 | 138 (0.25/y) | 52 (0.09/y) | 4 (0.01/y) | 0 (0.00/y) | 0 (0.00/y) | 31 (0.06/y) | 29 (0.05/y) | 0 (0.00/y) | 52 / 511 |

Every interval follows. Blocker counts are years with that first unmet predicate.

| Seed | Head (id) | Category | From–to | Years | Quiet | Choice | Match | Record | Auction | Orders | Routine | Automatic | Maintenance | Route / no route | Blocker years |
|---:|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 5100 | Daveed Gearithy (`p_1`) | unwoken | 1043–1089 | 47 | 4 | 12 | 4 | 0 | 0 | 0 | 1 | 3 | 0 | 4 / 43 | awakening:47 |
| 5100 | Vessa (`p_29`) | regency | 1164–1195 | 32 | 6 | 10 | 1 | 2 | 0 | 0 | 2 | 2 | 0 | 5 / 27 | awakening:14, no-expresser:13, books:4, power:1 |
| 5101 | Daveed Gearithy (`p_1`) | unwoken | 1043–1058 | 16 | 2 | 5 | 2 | 0 | 0 | 0 | 2 | 1 | 0 | 2 / 14 | awakening:16 |
| 5101 | Linnet (`p_1g`) | regency | 1141–1174 | 34 | 7 | 10 | 0 | 1 | 0 | 0 | 4 | 3 | 0 | 0 / 34 | no-expresser:34 |
| 5101 | Yfenna the second (`p_32`) | regency | 1175–1226 | 52 | 10 | 9 | 4 | 1 | 0 | 0 | 0 | 5 | 0 | 4 / 48 | no-expresser:52 |
| 5101 | Jehane (`p_41`) | regency | 1227–1230 | 4 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 4 | no-expresser:4 |
| 5101 | Honor the third (`p_4i`) | regency | 1231–1246 | 16 | 3 | 8 | 0 | 1 | 0 | 0 | 1 | 1 | 0 | 0 / 16 | no-expresser:16 |
| 5101 | Bethen the third (`p_5h`) | regency | 1259–1271 | 13 | 2 | 5 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 / 12 | no-expresser:13 |
| 5101 | Bryde the second (`p_6o`) | regency | 1287–1333 | 47 | 7 | 6 | 3 | 1 | 0 | 0 | 1 | 2 | 0 | 3 / 44 | power:21, awakening:14, no-expresser:12 |
| 5101 | Bryde the third (`p_7a`) | regency | 1334–1342 | 9 | 2 | 4 | 1 | 1 | 0 | 0 | 0 | 1 | 0 | 1 / 8 | power:9 |
| 5102 | Daveed Gearithy (`p_1`) | unwoken | 1043–1050 | 8 | 4 | 1 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 1 / 7 | awakening:8 |
| 5102 | Merrick (`p_3`) | unwoken | 1051–1054 | 4 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 / 3 | awakening:4 |
| 5102 | Merrick (`p_3`) | unwoken | 1065–1066 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 2 | awakening:2 |
| 5103 | Daveed Gearithy (`p_1`) | unwoken | 1043–1056 | 14 | 3 | 3 | 2 | 0 | 0 | 0 | 0 | 2 | 0 | 2 / 12 | awakening:14 |
| 5103 | Merrick (`p_3`) | unwoken | 1057–1077 | 21 | 4 | 3 | 1 | 0 | 0 | 0 | 3 | 1 | 0 | 1 / 20 | awakening:21 |
| 5103 | Katrin (`p_l`) | regency | 1078–1148 | 71 | 11 | 18 | 2 | 1 | 0 | 0 | 2 | 4 | 0 | 19 / 52 | awakening:29, books:19, power:13, no-expresser:10 |
| 5104 | Daveed Gearithy (`p_1`) | unwoken | 1043–1053 | 11 | 4 | 1 | 2 | 0 | 0 | 0 | 2 | 2 | 0 | 2 / 9 | awakening:11 |
| 5104 | Ulla the second (`p_4w`) | regency | 1271–1283 | 13 | 12 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 / 13 | no-expresser:13 |
| 5104 | Bryde the third (`p_6k`) | regency | 1284–1319 | 36 | 4 | 9 | 1 | 1 | 0 | 0 | 1 | 4 | 0 | 1 / 35 | no-expresser:23, awakening:12, power:1 |
| 5105 | Daveed Gearithy (`p_1`) | unwoken | 1043–1044 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 2 | awakening:2 |
| 5105 | Daveed Gearithy (`p_1`) | unwoken | 1054–1065 | 12 | 4 | 2 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 0 / 12 | awakening:12 |
| 5105 | Maura (`p_18`) | regency | 1140–1163 | 24 | 4 | 6 | 0 | 1 | 0 | 0 | 0 | 1 | 0 | 0 / 24 | no-expresser:24 |
| 5105 | Rhoswen the second (`p_1i`) | regency | 1164–1186 | 23 | 7 | 2 | 0 | 2 | 0 | 0 | 2 | 5 | 0 | 0 / 23 | no-expresser:16, awakening:7 |
| 5105 | Orlaith (`p_3q`) | regency | 1195–1271 | 77 | 5 | 16 | 4 | 3 | 0 | 0 | 5 | 5 | 0 | 4 / 73 | no-expresser:77 |
| 5105 | Fenna the fourth (`p_60`) | regency | 1272–1277 | 6 | 4 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 / 5 | no-expresser:6 |
| 5105 | Tamsin the third (`p_48`) | regency | 1278–1280 | 3 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 3 | no-expresser:3 |
| 5105 | Nerys (`p_4o`) | regency | 1281–1283 | 3 | 0 | 3 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 / 3 | no-expresser:3 |
| 5105 | Odila the third (`p_5y`) | regency | 1284–1316 | 33 | 5 | 7 | 3 | 1 | 0 | 0 | 1 | 2 | 0 | 3 / 30 | no-expresser:33 |
| 5105 | Fritha the fourth (`p_6x`) | regency | 1317–1342 | 26 | 9 | 9 | 1 | 2 | 0 | 0 | 4 | 2 | 0 | 1 / 25 | awakening:26 |
| 5106 | Daveed Gearithy (`p_1`) | unwoken | 1043–1052 | 10 | 2 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 / 9 | awakening:10 |
| 5107 | Daveed Gearithy (`p_1`) | unwoken | 1043–1062 | 20 | 3 | 5 | 3 | 1 | 0 | 0 | 1 | 2 | 0 | 3 / 17 | awakening:20 |
| 5108 | Daveed Gearithy (`p_1`) | unwoken | 1043–1072 | 30 | 3 | 9 | 3 | 0 | 0 | 0 | 2 | 1 | 0 | 3 / 27 | awakening:30 |
| 5108 | Merrick (`p_3`) | unwoken | 1073–1088 | 16 | 4 | 4 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 2 / 14 | awakening:16 |
| 5108 | Uthred the second (`p_15`) | unwoken | 1095–1100 | 6 | 2 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 / 5 | awakening:6 |
| 5109 | Daveed Gearithy (`p_1`) | unwoken | 1043–1051 | 9 | 3 | 2 | 1 | 0 | 0 | 0 | 1 | 1 | 0 | 1 / 8 | awakening:9 |
| 5110 | Daveed Gearithy (`p_1`) | unwoken | 1043–1061 | 19 | 4 | 6 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 1 / 18 | awakening:19 |
| 5111 | Daveed Gearithy (`p_1`) | unwoken | 1043–1068 | 26 | 3 | 9 | 2 | 0 | 0 | 0 | 0 | 2 | 0 | 2 / 24 | awakening:26 |
| 5111 | Merrick (`p_3`) | unwoken | 1069–1092 | 24 | 5 | 8 | 2 | 0 | 0 | 0 | 0 | 1 | 0 | 2 / 22 | awakening:24 |
| 5112 | Daveed Gearithy (`p_1`) | unwoken | 1043–1059 | 17 | 4 | 4 | 2 | 0 | 0 | 0 | 1 | 0 | 0 | 2 / 15 | awakening:17 |
| 5113 | Daveed Gearithy (`p_1`) | unwoken | 1043–1056 | 14 | 3 | 4 | 2 | 0 | 0 | 0 | 1 | 0 | 0 | 2 / 12 | awakening:14 |
| 5114 | Daveed Gearithy (`p_1`) | unwoken | 1043–1057 | 15 | 2 | 3 | 2 | 0 | 0 | 0 | 2 | 0 | 0 | 2 / 13 | awakening:15 |
| 5115 | Daveed Gearithy (`p_1`) | unwoken | 1043–1058 | 16 | 3 | 6 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 / 14 | awakening:16 |
| 5116 | Daveed Gearithy (`p_1`) | unwoken | 1043–1071 | 29 | 4 | 9 | 2 | 0 | 0 | 0 | 1 | 1 | 0 | 2 / 27 | awakening:29 |
| 5116 | Merrick (`p_3`) | unwoken | 1072–1089 | 18 | 3 | 4 | 1 | 0 | 0 | 0 | 3 | 2 | 0 | 1 / 17 | awakening:18 |
| 5116 | Damaris (`p_4c`) | regency | 1237–1247 | 11 | 3 | 5 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 / 11 | no-expresser:11 |
| 5116 | Perrine (`p_4g`) | regency | 1248–1274 | 27 | 5 | 7 | 0 | 1 | 0 | 0 | 1 | 6 | 0 | 0 / 27 | no-expresser:27 |
| 5116 | Idony the sixth (`p_60`) | regency | 1275–1310 | 36 | 8 | 11 | 0 | 1 | 0 | 0 | 3 | 5 | 0 | 0 / 36 | no-expresser:36 |
| 5116 | Sable the third (`p_8d`) | regency | 1311–1342 | 32 | 7 | 7 | 1 | 2 | 0 | 0 | 1 | 3 | 0 | 1 / 31 | no-expresser:32 |
| 5117 | Daveed Gearithy (`p_1`) | unwoken | 1043–1045 | 3 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 / 3 | awakening:3 |
| 5117 | Tamsin (`p_b`) | regency | 1113–1126 | 14 | 3 | 4 | 0 | 1 | 0 | 0 | 2 | 2 | 0 | 7 / 7 | books:7, no-expresser:4, awakening:3 |
| 5117 | Corwen (`p_1h`) | regency | 1165–1178 | 14 | 1 | 8 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 / 14 | power:14 |
| 5117 | Bryde (`p_38`) | regency | 1182–1244 | 63 | 6 | 20 | 4 | 4 | 0 | 0 | 3 | 7 | 0 | 4 / 59 | power:63 |
| 5118 | Daveed Gearithy (`p_1`) | unwoken | 1043–1056 | 14 | 4 | 3 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 / 12 | awakening:14 |
| 5119 | Daveed Gearithy (`p_1`) | unwoken | 1043–1058 | 16 | 3 | 1 | 2 | 0 | 0 | 0 | 2 | 2 | 0 | 2 / 14 | awakening:16 |
| 5119 | Rhoswen (`p_a`) | regency | 1090–1099 | 10 | 2 | 4 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 / 10 | awakening:5, no-expresser:5 |
| 5119 | Tamsin (`p_b`) | regency | 1100–1102 | 3 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 3 | awakening:3 |
| 5119 | Gisela (`p_1q`) | regency | 1116–1161 | 46 | 6 | 11 | 3 | 1 | 0 | 0 | 0 | 3 | 0 | 3 / 43 | power:35, no-expresser:8, awakening:3 |
| 5119 | Thomasin the second (`p_2f`) | regency | 1162–1202 | 41 | 3 | 14 | 1 | 1 | 0 | 0 | 2 | 3 | 0 | 1 / 40 | no-expresser:41 |
| 5119 | Ulla (`p_3s`) | regency | 1203–1235 | 33 | 4 | 9 | 3 | 1 | 0 | 0 | 1 | 3 | 0 | 3 / 30 | no-expresser:33 |
| 5119 | Sable the fourth (`p_5i`) | regency | 1236–1294 | 59 | 5 | 20 | 3 | 4 | 0 | 0 | 2 | 3 | 0 | 3 / 56 | no-expresser:59 |
| 5119 | Gwenneth the third (`p_6b`) | regency | 1295–1303 | 9 | 2 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 9 | no-expresser:5, awakening:4 |
| 5119 | Ilsa the fourth (`p_80`) | regency | 1312–1342 | 31 | 5 | 12 | 2 | 1 | 0 | 0 | 2 | 6 | 0 | 2 / 29 | no-expresser:31 |
| 5120 | Daveed Gearithy (`p_1`) | unwoken | 1043–1069 | 27 | 6 | 8 | 2 | 0 | 0 | 0 | 1 | 0 | 0 | 2 / 25 | awakening:27 |
| 5120 | Merrick (`p_3`) | unwoken | 1070–1091 | 22 | 6 | 5 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 0 / 22 | awakening:22 |
| 5120 | Honor (`p_f`) | regency | 1092–1123 | 32 | 6 | 10 | 0 | 0 | 0 | 0 | 3 | 1 | 0 | 0 / 32 | no-expresser:32 |
| 5121 | Daveed Gearithy (`p_1`) | unwoken | 1043–1084 | 42 | 6 | 11 | 3 | 1 | 0 | 0 | 3 | 3 | 0 | 3 / 39 | awakening:42 |
| 5121 | Rhoswen (`p_a`) | regency | 1085–1094 | 10 | 2 | 4 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 1 / 9 | no-expresser:10 |
| 5121 | Damaris (`p_i`) | regency | 1095–1125 | 31 | 4 | 14 | 3 | 0 | 0 | 0 | 2 | 2 | 0 | 3 / 28 | awakening:17, power:14 |
| 5121 | Fritha (`p_5w`) | regency | 1259–1308 | 50 | 7 | 15 | 2 | 2 | 0 | 0 | 5 | 2 | 0 | 2 / 48 | power:27, awakening:19, no-expresser:4 |
| 5122 | Daveed Gearithy (`p_1`) | unwoken | 1043–1058 | 16 | 4 | 3 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 / 14 | awakening:16 |
| 5123 | Daveed Gearithy (`p_1`) | unwoken | 1043–1059 | 17 | 3 | 4 | 1 | 0 | 0 | 0 | 3 | 0 | 0 | 1 / 16 | awakening:17 |
| 5123 | Odila (`p_2s`) | regency | 1160–1191 | 32 | 5 | 8 | 1 | 1 | 0 | 0 | 0 | 3 | 0 | 1 / 31 | awakening:16, power:13, no-expresser:3 |

## Short / ascendant / 901–902

2 histories; 600 actual played years. Endings: devoured 1, forgotten 1.

| Category | Intervals | Years (share of played) | Mean/max length | Quiet max | Choice | Match | Record | Auction | Orders | Routine | Automatic | Maintenance | Route / no route years |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| regency | 1 | 42 (7.0%) | 42.0/42 | 6 | 13 (0.31/y) | 2 (0.05/y) | 1 (0.02/y) | 0 (0.00/y) | 1 (0.02/y) | 4 (0.10/y) | 4 (0.10/y) | 0 (0.00/y) | 27 / 15 |
| unwoken | 3 | 61 (10.2%) | 20.3/49 | 4 | 14 (0.23/y) | 5 (0.08/y) | 2 (0.03/y) | 0 (0.00/y) | 8 (0.13/y) | 2 (0.03/y) | 1 (0.02/y) | 0 (0.00/y) | 5 / 56 |

Every interval follows. Blocker counts are years with that first unmet predicate.

| Seed | Head (id) | Category | From–to | Years | Quiet | Choice | Match | Record | Auction | Orders | Routine | Automatic | Maintenance | Route / no route | Blocker years |
|---:|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 901 | Daveed Gearithy (`p_1`) | unwoken | 1043–1047 | 5 | 3 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 / 4 | awakening:5 |
| 902 | Daveed Gearithy (`p_1`) | unwoken | 1043–1091 | 49 | 4 | 12 | 4 | 2 | 0 | 8 | 2 | 1 | 0 | 4 / 45 | awakening:49 |
| 902 | Merrick (`p_3`) | unwoken | 1092–1098 | 7 | 4 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 7 | awakening:7 |
| 902 | Gisela (`p_3r`) | regency | 1244–1285 | 42 | 6 | 13 | 2 | 1 | 0 | 1 | 4 | 4 | 0 | 27 / 15 | books:26, no-expresser:13, awakening:2, power:1 |

## Short / ascendant / G1 5100–5123

24 histories; 6118 actual played years. Endings: broken_line 5, devoured 12, forgotten 6, settled 1.

| Category | Intervals | Years (share of played) | Mean/max length | Quiet max | Choice | Match | Record | Auction | Orders | Routine | Automatic | Maintenance | Route / no route years |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| regency | 25 | 524 (8.6%) | 21.0/74 | 14 | 165 (0.31/y) | 20 (0.04/y) | 14 (0.03/y) | 0 (0.00/y) | 2 (0.00/y) | 33 (0.06/y) | 42 (0.08/y) | 0 (0.00/y) | 76 / 448 |
| unwoken | 40 | 684 (11.2%) | 17.1/63 | 6 | 187 (0.27/y) | 61 (0.09/y) | 16 (0.02/y) | 0 (0.00/y) | 44 (0.06/y) | 42 (0.06/y) | 33 (0.05/y) | 0 (0.00/y) | 61 / 623 |

Every interval follows. Blocker counts are years with that first unmet predicate.

| Seed | Head (id) | Category | From–to | Years | Quiet | Choice | Match | Record | Auction | Orders | Routine | Automatic | Maintenance | Route / no route | Blocker years |
|---:|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 5100 | Daveed Gearithy (`p_1`) | unwoken | 1043–1099 | 57 | 6 | 17 | 5 | 0 | 0 | 9 | 3 | 3 | 0 | 5 / 52 | awakening:57 |
| 5100 | Aveline the second (`p_f`) | regency | 1100–1138 | 39 | 5 | 16 | 1 | 1 | 0 | 1 | 1 | 2 | 0 | 11 / 28 | no-expresser:19, books:10, awakening:7, power:3 |
| 5100 | Bryde (`p_1c`) | regency | 1183–1192 | 10 | 4 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 10 | power:10 |
| 5100 | Lisbeth the second (`p_1o`) | regency | 1193–1195 | 3 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 3 | power:3 |
| 5100 | Selwyn (`p_1r`) | regency | 1196–1209 | 14 | 2 | 5 | 1 | 1 | 0 | 0 | 1 | 1 | 0 | 1 / 13 | power:14 |
| 5101 | Daveed Gearithy (`p_1`) | unwoken | 1043–1058 | 16 | 3 | 5 | 2 | 0 | 0 | 0 | 1 | 2 | 0 | 2 / 14 | awakening:16 |
| 5101 | Honor (`p_s`) | regency | 1126–1131 | 6 | 3 | 2 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 / 6 | awakening:3, no-expresser:3 |
| 5101 | Verrick the second (`p_2m`) | unwoken | 1145–1150 | 6 | 2 | 3 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 1 / 5 | awakening:6 |
| 5101 | Wulfric the third (`p_5j`) | unwoken | 1224–1261 | 38 | 5 | 10 | 2 | 2 | 0 | 0 | 4 | 3 | 0 | 2 / 36 | awakening:38 |
| 5102 | Daveed Gearithy (`p_1`) | unwoken | 1043–1050 | 8 | 4 | 1 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 1 / 7 | awakening:8 |
| 5102 | Merrick (`p_3`) | unwoken | 1051–1054 | 4 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 / 3 | awakening:4 |
| 5103 | Daveed Gearithy (`p_1`) | unwoken | 1043–1056 | 14 | 3 | 3 | 2 | 0 | 0 | 0 | 0 | 2 | 0 | 2 / 12 | awakening:14 |
| 5103 | Merrick (`p_3`) | unwoken | 1057–1077 | 21 | 6 | 5 | 1 | 0 | 0 | 2 | 2 | 0 | 0 | 1 / 20 | awakening:21 |
| 5103 | Idony the second (`p_1r`) | regency | 1145–1162 | 18 | 6 | 3 | 1 | 0 | 0 | 0 | 4 | 2 | 0 | 14 / 4 | books:14, awakening:2, no-expresser:2 |
| 5104 | Daveed Gearithy (`p_1`) | unwoken | 1043–1053 | 11 | 4 | 2 | 2 | 0 | 0 | 0 | 1 | 2 | 0 | 2 / 9 | awakening:11 |
| 5104 | Quilla (`p_w`) | regency | 1126–1126 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 1 | no-expresser:1 |
| 5104 | Aldous the second (`p_1w`) | unwoken | 1127–1129 | 3 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 3 | no-expresser:3 |
| 5104 | Thorne the second (`p_2i`) | unwoken | 1130–1133 | 4 | 1 | 3 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 1 / 3 | no-expresser:4 |
| 5105 | Daveed Gearithy (`p_1`) | unwoken | 1043–1044 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 2 | awakening:2 |
| 5105 | Daveed Gearithy (`p_1`) | unwoken | 1054–1065 | 12 | 4 | 2 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 / 12 | awakening:12 |
| 5106 | Daveed Gearithy (`p_1`) | unwoken | 1043–1052 | 10 | 2 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 / 9 | awakening:10 |
| 5107 | Daveed Gearithy (`p_1`) | unwoken | 1043–1062 | 20 | 3 | 5 | 3 | 1 | 0 | 0 | 1 | 2 | 0 | 3 / 17 | awakening:20 |
| 5108 | Daveed Gearithy (`p_1`) | unwoken | 1043–1072 | 30 | 2 | 9 | 3 | 0 | 0 | 6 | 2 | 1 | 0 | 3 / 27 | awakening:30 |
| 5108 | Merrick (`p_3`) | unwoken | 1073–1088 | 16 | 4 | 4 | 2 | 1 | 0 | 1 | 0 | 1 | 0 | 2 / 14 | awakening:16 |
| 5108 | Uthred the second (`p_15`) | unwoken | 1095–1098 | 4 | 2 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 / 3 | awakening:4 |
| 5108 | Cuthard the second (`p_7g`) | unwoken | 1309–1311 | 3 | 0 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 1 / 2 | awakening:3 |
| 5109 | Daveed Gearithy (`p_1`) | unwoken | 1043–1051 | 9 | 4 | 1 | 1 | 0 | 0 | 0 | 3 | 0 | 0 | 1 / 8 | awakening:9 |
| 5110 | Daveed Gearithy (`p_1`) | unwoken | 1043–1105 | 63 | 4 | 20 | 1 | 2 | 0 | 8 | 1 | 5 | 0 | 1 / 62 | awakening:63 |
| 5111 | Daveed Gearithy (`p_1`) | unwoken | 1043–1068 | 26 | 3 | 10 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 2 / 24 | awakening:26 |
| 5111 | Merrick (`p_3`) | unwoken | 1069–1084 | 16 | 3 | 4 | 1 | 0 | 0 | 0 | 1 | 1 | 0 | 1 / 15 | awakening:16 |
| 5111 | Winefred (`p_1v`) | regency | 1198–1205 | 8 | 3 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 8 | awakening:8 |
| 5111 | Lisbeth (`p_3e`) | regency | 1272–1300 | 29 | 5 | 9 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 / 29 | no-expresser:29 |
| 5111 | Lisbeth the third (`p_47`) | regency | 1301–1308 | 8 | 1 | 5 | 1 | 1 | 0 | 0 | 0 | 1 | 0 | 1 / 7 | no-expresser:8 |
| 5111 | Yardley (`p_51`) | unwoken | 1309–1334 | 26 | 5 | 7 | 1 | 1 | 0 | 0 | 7 | 3 | 0 | 1 / 25 | awakening:14, no-expresser:12 |
| 5112 | Daveed Gearithy (`p_1`) | unwoken | 1043–1067 | 25 | 4 | 8 | 3 | 1 | 0 | 0 | 1 | 0 | 0 | 3 / 22 | awakening:25 |
| 5112 | Honor the second (`p_1z`) | regency | 1134–1169 | 36 | 8 | 11 | 2 | 1 | 0 | 1 | 0 | 3 | 0 | 27 / 9 | books:22, no-expresser:6, awakening:3, madness-floor:2, respect:2, power:1 |
| 5113 | Daveed Gearithy (`p_1`) | unwoken | 1043–1056 | 14 | 3 | 5 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 / 12 | awakening:14 |
| 5114 | Daveed Gearithy (`p_1`) | unwoken | 1043–1056 | 14 | 2 | 3 | 2 | 0 | 0 | 0 | 2 | 0 | 0 | 2 / 12 | awakening:14 |
| 5114 | Petronel the sixth (`p_7f`) | regency | 1231–1255 | 25 | 4 | 8 | 2 | 0 | 0 | 0 | 2 | 2 | 0 | 2 / 23 | no-expresser:13, awakening:12 |
| 5114 | Damaris the fifth (`p_a2`) | regency | 1332–1342 | 11 | 2 | 2 | 1 | 0 | 0 | 0 | 1 | 2 | 0 | 1 / 10 | power:11 |
| 5115 | Daveed Gearithy (`p_1`) | unwoken | 1043–1057 | 15 | 3 | 6 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 2 / 13 | awakening:15 |
| 5115 | Daveed Gearithy (`p_1`) | unwoken | 1062–1078 | 17 | 3 | 5 | 2 | 1 | 0 | 3 | 2 | 2 | 0 | 2 / 15 | awakening:17 |
| 5115 | Petronel (`p_n`) | regency | 1125–1135 | 11 | 2 | 6 | 0 | 1 | 0 | 0 | 0 | 2 | 0 | 0 / 11 | no-expresser:11 |
| 5115 | Ivor (`p_1i`) | unwoken | 1136–1140 | 5 | 3 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 / 5 | no-expresser:3, awakening:2 |
| 5116 | Daveed Gearithy (`p_1`) | unwoken | 1043–1058 | 16 | 4 | 3 | 2 | 0 | 0 | 0 | 0 | 1 | 0 | 2 / 14 | awakening:16 |
| 5116 | Amice (`p_2f`) | regency | 1158–1231 | 74 | 14 | 18 | 1 | 1 | 0 | 0 | 4 | 4 | 0 | 1 / 73 | no-expresser:51, power:23 |
| 5116 | Ysolde (`p_3j`) | regency | 1232–1273 | 42 | 4 | 13 | 3 | 2 | 0 | 0 | 3 | 6 | 0 | 3 / 39 | no-expresser:42 |
| 5116 | Honor the third (`p_42`) | regency | 1274–1313 | 40 | 7 | 14 | 0 | 3 | 0 | 0 | 5 | 3 | 0 | 0 / 40 | no-expresser:40 |
| 5116 | Morwen the third (`p_4p`) | regency | 1314–1336 | 23 | 5 | 5 | 0 | 1 | 0 | 0 | 1 | 3 | 0 | 0 / 23 | no-expresser:23 |
| 5116 | Idony the second (`p_5a`) | regency | 1337–1342 | 6 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 6 | no-expresser:6 |
| 5117 | Daveed Gearithy (`p_1`) | unwoken | 1043–1045 | 3 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 / 3 | awakening:3 |
| 5117 | Winefred (`p_10`) | regency | 1140–1173 | 34 | 4 | 11 | 3 | 2 | 0 | 0 | 3 | 3 | 0 | 11 / 23 | power:10, books:9, awakening:8, no-expresser:7 |
| 5118 | Daveed Gearithy (`p_1`) | unwoken | 1043–1056 | 14 | 4 | 3 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 / 12 | awakening:14 |
| 5119 | Daveed Gearithy (`p_1`) | unwoken | 1043–1058 | 16 | 3 | 2 | 2 | 0 | 0 | 0 | 2 | 2 | 0 | 2 / 14 | awakening:16 |
| 5119 | Rhoswen (`p_a`) | regency | 1090–1099 | 10 | 4 | 2 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 / 10 | no-expresser:10 |
| 5119 | Tamsin (`p_b`) | regency | 1100–1102 | 3 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 3 | no-expresser:3 |
| 5119 | Aldwin the second (`p_12`) | unwoken | 1104–1105 | 2 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 1 / 1 | no-expresser:2 |
| 5120 | Daveed Gearithy (`p_1`) | unwoken | 1043–1069 | 27 | 6 | 9 | 2 | 0 | 0 | 6 | 0 | 0 | 0 | 2 / 25 | awakening:27 |
| 5120 | Merrick (`p_3`) | unwoken | 1070–1091 | 22 | 6 | 7 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 / 22 | awakening:22 |
| 5120 | Honor (`p_f`) | regency | 1092–1123 | 32 | 8 | 9 | 0 | 0 | 0 | 0 | 4 | 1 | 0 | 0 / 32 | no-expresser:32 |
| 5121 | Daveed Gearithy (`p_1`) | unwoken | 1043–1084 | 42 | 4 | 13 | 3 | 0 | 0 | 7 | 4 | 1 | 0 | 3 / 39 | awakening:42 |
| 5121 | Rhoswen (`p_a`) | regency | 1085–1094 | 10 | 2 | 5 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 1 / 9 | no-expresser:10 |
| 5121 | Damaris (`p_i`) | regency | 1095–1125 | 31 | 5 | 12 | 3 | 0 | 0 | 0 | 4 | 1 | 0 | 3 / 28 | awakening:12, power:12, no-expresser:7 |
| 5122 | Daveed Gearithy (`p_1`) | unwoken | 1043–1058 | 16 | 4 | 3 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 / 14 | awakening:16 |
| 5123 | Daveed Gearithy (`p_1`) | unwoken | 1043–1059 | 17 | 3 | 5 | 1 | 0 | 0 | 0 | 2 | 0 | 0 | 1 / 16 | awakening:17 |

## Long / chronicler / 901–902

2 histories; 689 actual played years. Endings: broken_line 1, forgotten 1.

| Category | Intervals | Years (share of played) | Mean/max length | Quiet max | Choice | Match | Record | Auction | Orders | Routine | Automatic | Maintenance | Route / no route years |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| regency | 3 | 52 (7.5%) | 17.3/42 | 6 | 14 (0.27/y) | 2 (0.04/y) | 5 (0.10/y) | 0 (0.00/y) | 0 (0.00/y) | 2 (0.04/y) | 3 (0.06/y) | 0 (0.00/y) | 2 / 50 |
| unwoken | 6 | 93 (13.5%) | 15.5/49 | 5 | 28 (0.30/y) | 7 (0.08/y) | 1 (0.01/y) | 0 (0.00/y) | 0 (0.00/y) | 3 (0.03/y) | 3 (0.03/y) | 0 (0.00/y) | 7 / 86 |

Every interval follows. Blocker counts are years with that first unmet predicate.

| Seed | Head (id) | Category | From–to | Years | Quiet | Choice | Match | Record | Auction | Orders | Routine | Automatic | Maintenance | Route / no route | Blocker years |
|---:|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 901 | Daveed Gearithy (`p_1`) | unwoken | 1043–1047 | 5 | 3 | 1 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 1 / 4 | awakening:5 |
| 901 | Aldous the second (`p_3g`) | unwoken | 1196–1217 | 22 | 3 | 9 | 1 | 1 | 0 | 0 | 1 | 0 | 0 | 1 / 21 | awakening:22 |
| 901 | Gethin the sixth (`p_br`) | unwoken | 1381–1388 | 8 | 4 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 / 7 | awakening:8 |
| 901 | Ordric the fifth (`p_e6`) | unwoken | 1488–1488 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 / 1 | awakening:1 |
| 901 | Alys the fourth (`p_ck`) | regency | 1489–1490 | 2 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 2 | no-expresser:2 |
| 901 | Ilsa (`p_g4`) | regency | 1501–1542 | 42 | 6 | 11 | 2 | 3 | 0 | 0 | 2 | 2 | 0 | 2 / 40 | no-expresser:42 |
| 902 | Daveed Gearithy (`p_1`) | unwoken | 1043–1091 | 49 | 5 | 15 | 4 | 0 | 0 | 0 | 2 | 1 | 0 | 4 / 45 | awakening:49 |
| 902 | Merrick (`p_3`) | unwoken | 1092–1099 | 8 | 4 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 8 | awakening:8 |
| 902 | Jehane the second (`p_z`) | regency | 1150–1157 | 8 | 3 | 2 | 0 | 2 | 0 | 0 | 0 | 1 | 0 | 0 / 8 | awakening:5, no-expresser:3 |

## Long / chronicler / G1 5100–5123

24 histories; 11138 actual played years. Endings: broken_line 3, devoured 7, forgotten 14.

| Category | Intervals | Years (share of played) | Mean/max length | Quiet max | Choice | Match | Record | Auction | Orders | Routine | Automatic | Maintenance | Route / no route years |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| regency | 68 | 2033 (18.3%) | 29.9/85 | 13 | 557 (0.27/y) | 76 (0.04/y) | 81 (0.04/y) | 0 (0.00/y) | 0 (0.00/y) | 129 (0.06/y) | 186 (0.09/y) | 0 (0.00/y) | 189 / 1844 |
| unwoken | 48 | 679 (6.1%) | 14.1/47 | 8 | 175 (0.26/y) | 61 (0.09/y) | 10 (0.01/y) | 0 (0.00/y) | 0 (0.00/y) | 35 (0.05/y) | 34 (0.05/y) | 0 (0.00/y) | 61 / 618 |

Every interval follows. Blocker counts are years with that first unmet predicate.

| Seed | Head (id) | Category | From–to | Years | Quiet | Choice | Match | Record | Auction | Orders | Routine | Automatic | Maintenance | Route / no route | Blocker years |
|---:|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 5100 | Daveed Gearithy (`p_1`) | unwoken | 1043–1089 | 47 | 4 | 12 | 4 | 0 | 0 | 0 | 1 | 3 | 0 | 4 / 43 | awakening:47 |
| 5100 | Vessa (`p_29`) | regency | 1164–1195 | 32 | 6 | 8 | 1 | 2 | 0 | 0 | 3 | 3 | 0 | 1 / 31 | no-expresser:20, awakening:12 |
| 5100 | Varen (`p_46`) | unwoken | 1200–1200 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 1 | awakening:1 |
| 5100 | Hesper the third (`p_5k`) | regency | 1289–1307 | 19 | 3 | 7 | 0 | 0 | 0 | 0 | 2 | 3 | 0 | 0 / 19 | no-expresser:19 |
| 5100 | Jorunn the third (`p_85`) | regency | 1310–1318 | 9 | 4 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 / 8 | no-expresser:9 |
| 5100 | Idony the third (`p_8g`) | regency | 1321–1370 | 50 | 5 | 13 | 2 | 2 | 0 | 0 | 3 | 6 | 0 | 2 / 48 | no-expresser:30, awakening:20 |
| 5101 | Daveed Gearithy (`p_1`) | unwoken | 1043–1058 | 16 | 2 | 5 | 2 | 0 | 0 | 0 | 2 | 1 | 0 | 2 / 14 | awakening:16 |
| 5101 | Honor (`p_s`) | regency | 1132–1137 | 6 | 2 | 2 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 / 6 | no-expresser:6 |
| 5101 | Thomasin (`p_27`) | regency | 1144–1159 | 16 | 2 | 6 | 1 | 0 | 0 | 0 | 0 | 2 | 0 | 1 / 15 | no-expresser:16 |
| 5101 | Yfenna the second (`p_1z`) | regency | 1160–1186 | 27 | 8 | 9 | 2 | 1 | 0 | 0 | 1 | 2 | 0 | 2 / 25 | no-expresser:27 |
| 5101 | Aveline the second (`p_2g`) | regency | 1187–1216 | 30 | 9 | 4 | 1 | 0 | 0 | 0 | 2 | 4 | 0 | 1 / 29 | no-expresser:16, awakening:14 |
| 5101 | Eilwen the second (`p_39`) | regency | 1217–1255 | 39 | 5 | 12 | 1 | 1 | 0 | 0 | 3 | 4 | 0 | 1 / 38 | awakening:39 |
| 5101 | Orlaith the second (`p_4u`) | regency | 1264–1301 | 38 | 9 | 11 | 0 | 1 | 0 | 0 | 2 | 5 | 0 | 0 / 38 | no-expresser:20, awakening:18 |
| 5101 | Pellam the second (`p_7g`) | unwoken | 1306–1316 | 11 | 6 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 / 10 | awakening:11 |
| 5101 | Ulla the second (`p_85`) | regency | 1325–1384 | 60 | 10 | 13 | 2 | 3 | 0 | 0 | 5 | 6 | 0 | 7 / 53 | awakening:39, power:14, books:5, no-expresser:2 |
| 5101 | Jorunn the second (`p_e6`) | regency | 1491–1539 | 49 | 4 | 14 | 2 | 1 | 0 | 0 | 2 | 3 | 0 | 7 / 42 | power:22, awakening:13, no-expresser:9, books:5 |
| 5102 | Daveed Gearithy (`p_1`) | unwoken | 1043–1050 | 8 | 4 | 1 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 1 / 7 | awakening:8 |
| 5102 | Merrick (`p_3`) | unwoken | 1051–1054 | 4 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 / 3 | awakening:4 |
| 5102 | Merrick (`p_3`) | unwoken | 1065–1066 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 2 | awakening:2 |
| 5102 | Jehane the second (`p_7a`) | regency | 1273–1341 | 69 | 6 | 15 | 1 | 1 | 0 | 0 | 3 | 5 | 0 | 8 / 61 | awakening:34, power:28, books:7 |
| 5102 | Jarret the sixth (`p_dh`) | unwoken | 1432–1432 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 / 1 | awakening:1 |
| 5102 | Maura the sixth (`p_ep`) | regency | 1452–1536 | 85 | 5 | 32 | 3 | 5 | 0 | 0 | 7 | 10 | 0 | 3 / 82 | no-expresser:85 |
| 5102 | Fenna the fourth (`p_fv`) | regency | 1537–1542 | 6 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 / 6 | no-expresser:6 |
| 5103 | Daveed Gearithy (`p_1`) | unwoken | 1043–1056 | 14 | 3 | 3 | 2 | 0 | 0 | 0 | 0 | 2 | 0 | 2 / 12 | awakening:14 |
| 5103 | Merrick (`p_3`) | unwoken | 1057–1077 | 21 | 4 | 3 | 1 | 0 | 0 | 0 | 3 | 1 | 0 | 1 / 20 | awakening:21 |
| 5103 | Katrin (`p_l`) | regency | 1078–1148 | 71 | 11 | 18 | 2 | 1 | 0 | 0 | 2 | 4 | 0 | 19 / 52 | awakening:29, books:19, power:13, no-expresser:10 |
| 5103 | Verity the fourth (`p_9r`) | regency | 1362–1377 | 16 | 4 | 4 | 1 | 1 | 0 | 0 | 3 | 0 | 0 | 1 / 15 | no-expresser:16 |
| 5103 | Ysolde the second (`p_b3`) | regency | 1384–1439 | 56 | 5 | 18 | 3 | 3 | 0 | 0 | 4 | 7 | 0 | 3 / 53 | no-expresser:43, awakening:13 |
| 5103 | Verrick the fourth (`p_cw`) | unwoken | 1443–1454 | 12 | 2 | 4 | 1 | 1 | 0 | 0 | 0 | 1 | 0 | 1 / 11 | awakening:12 |
| 5103 | Wystan the second (`p_el`) | unwoken | 1534–1538 | 5 | 1 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 5 | awakening:5 |
| 5103 | Fenna the fourth (`p_f8`) | regency | 1539–1542 | 4 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 / 4 | no-expresser:4 |
| 5104 | Daveed Gearithy (`p_1`) | unwoken | 1043–1053 | 11 | 4 | 1 | 2 | 0 | 0 | 0 | 2 | 2 | 0 | 2 / 9 | awakening:11 |
| 5104 | Rhoswen the fourth (`p_6a`) | regency | 1301–1307 | 7 | 3 | 2 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 / 7 | awakening:7 |
| 5104 | Verity the second (`p_8e`) | regency | 1342–1376 | 35 | 5 | 6 | 3 | 1 | 0 | 0 | 4 | 2 | 0 | 12 / 23 | awakening:10, books:10, power:8, no-expresser:7 |
| 5104 | Aveline the third (`p_9a`) | regency | 1417–1427 | 11 | 5 | 0 | 0 | 1 | 0 | 0 | 0 | 2 | 0 | 0 / 11 | no-expresser:7, awakening:4 |
| 5104 | Tamsin the sixth (`p_bw`) | regency | 1440–1493 | 54 | 5 | 22 | 3 | 3 | 0 | 0 | 4 | 5 | 0 | 3 / 51 | no-expresser:54 |
| 5104 | Verity the third (`p_ci`) | regency | 1494–1521 | 28 | 6 | 7 | 3 | 2 | 0 | 0 | 2 | 3 | 0 | 3 / 25 | power:14, awakening:10, no-expresser:4 |
| 5105 | Daveed Gearithy (`p_1`) | unwoken | 1043–1044 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 2 | awakening:2 |
| 5105 | Daveed Gearithy (`p_1`) | unwoken | 1054–1065 | 12 | 4 | 3 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 / 12 | awakening:12 |
| 5105 | Cecily (`p_1j`) | regency | 1140–1163 | 24 | 4 | 5 | 1 | 1 | 0 | 0 | 2 | 1 | 0 | 1 / 23 | awakening:20, no-expresser:4 |
| 5105 | Fritha the second (`p_2r`) | regency | 1164–1208 | 45 | 13 | 10 | 4 | 1 | 0 | 0 | 4 | 4 | 0 | 4 / 41 | no-expresser:45 |
| 5105 | Tamsin the third (`p_3u`) | regency | 1209–1243 | 35 | 6 | 10 | 2 | 2 | 0 | 0 | 4 | 3 | 0 | 2 / 33 | awakening:19, no-expresser:16 |
| 5105 | Wystan the third (`p_6a`) | unwoken | 1244–1248 | 5 | 3 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 / 4 | awakening:5 |
| 5105 | Bethen the fourth (`p_81`) | regency | 1323–1329 | 7 | 3 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 / 6 | no-expresser:7 |
| 5105 | Verity the second (`p_8a`) | regency | 1330–1349 | 20 | 3 | 7 | 1 | 2 | 0 | 0 | 0 | 2 | 0 | 5 / 15 | no-expresser:14, books:4, awakening:2 |
| 5105 | Vessa the seventh (`p_cc`) | regency | 1461–1483 | 23 | 5 | 6 | 0 | 1 | 0 | 0 | 3 | 3 | 0 | 0 / 23 | no-expresser:16, awakening:7 |
| 5105 | Uthred the second (`p_fb`) | unwoken | 1493–1493 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 1 | awakening:1 |
| 5106 | Daveed Gearithy (`p_1`) | unwoken | 1043–1052 | 10 | 2 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 / 9 | awakening:10 |
| 5107 | Daveed Gearithy (`p_1`) | unwoken | 1043–1062 | 20 | 3 | 5 | 3 | 1 | 0 | 0 | 1 | 2 | 0 | 3 / 17 | awakening:20 |
| 5107 | Rhoswen the fourth (`p_9y`) | regency | 1412–1438 | 27 | 4 | 6 | 0 | 1 | 0 | 0 | 4 | 4 | 0 | 14 / 13 | books:14, awakening:6, no-expresser:6, power:1 |
| 5108 | Daveed Gearithy (`p_1`) | unwoken | 1043–1072 | 30 | 3 | 9 | 3 | 0 | 0 | 0 | 2 | 1 | 0 | 3 / 27 | awakening:30 |
| 5108 | Merrick (`p_3`) | unwoken | 1073–1088 | 16 | 4 | 4 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 2 / 14 | awakening:16 |
| 5108 | Uthred the second (`p_15`) | unwoken | 1095–1100 | 6 | 2 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 / 5 | awakening:6 |
| 5109 | Daveed Gearithy (`p_1`) | unwoken | 1043–1051 | 9 | 3 | 2 | 1 | 0 | 0 | 0 | 1 | 1 | 0 | 1 / 8 | awakening:9 |
| 5110 | Daveed Gearithy (`p_1`) | unwoken | 1043–1061 | 19 | 4 | 6 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 1 / 18 | awakening:19 |
| 5111 | Daveed Gearithy (`p_1`) | unwoken | 1043–1068 | 26 | 3 | 9 | 2 | 0 | 0 | 0 | 0 | 2 | 0 | 2 / 24 | awakening:26 |
| 5111 | Merrick (`p_3`) | unwoken | 1069–1092 | 24 | 5 | 8 | 2 | 0 | 0 | 0 | 0 | 1 | 0 | 2 / 22 | awakening:24 |
| 5111 | Ewart the second (`p_74`) | unwoken | 1287–1294 | 8 | 3 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 / 7 | awakening:8 |
| 5111 | Vessa the fourth (`p_8a`) | regency | 1341–1399 | 59 | 8 | 15 | 4 | 2 | 0 | 0 | 3 | 1 | 0 | 4 / 55 | power:38, awakening:14, no-expresser:7 |
| 5112 | Daveed Gearithy (`p_1`) | unwoken | 1043–1059 | 17 | 4 | 4 | 2 | 0 | 0 | 0 | 1 | 0 | 0 | 2 / 15 | awakening:17 |
| 5113 | Daveed Gearithy (`p_1`) | unwoken | 1043–1056 | 14 | 3 | 4 | 2 | 0 | 0 | 0 | 1 | 0 | 0 | 2 / 12 | awakening:14 |
| 5113 | Verity the sixth (`p_fy`) | regency | 1529–1538 | 10 | 5 | 3 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 / 10 | awakening:10 |
| 5113 | Dalia the fourth (`p_g3`) | regency | 1539–1542 | 4 | 3 | 1 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 0 / 4 | awakening:4 |
| 5114 | Daveed Gearithy (`p_1`) | unwoken | 1043–1057 | 15 | 2 | 3 | 2 | 0 | 0 | 0 | 2 | 0 | 0 | 2 / 13 | awakening:15 |
| 5115 | Daveed Gearithy (`p_1`) | unwoken | 1043–1058 | 16 | 3 | 6 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 / 14 | awakening:16 |
| 5115 | Jocelyn the second (`p_c4`) | unwoken | 1478–1478 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 1 | no-expresser:1 |
| 5116 | Daveed Gearithy (`p_1`) | unwoken | 1043–1071 | 29 | 4 | 9 | 2 | 0 | 0 | 0 | 1 | 1 | 0 | 2 / 27 | awakening:29 |
| 5116 | Merrick (`p_3`) | unwoken | 1072–1089 | 18 | 3 | 5 | 1 | 0 | 0 | 0 | 3 | 1 | 0 | 1 / 17 | awakening:18 |
| 5116 | Perrin the second (`p_8v`) | unwoken | 1330–1349 | 20 | 4 | 9 | 1 | 2 | 0 | 0 | 1 | 2 | 0 | 1 / 19 | awakening:20 |
| 5116 | Sable the third (`p_9k`) | regency | 1350–1372 | 23 | 10 | 5 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 1 / 22 | no-expresser:23 |
| 5116 | Kerensa the fourth (`p_ap`) | regency | 1373–1419 | 47 | 5 | 16 | 1 | 5 | 0 | 0 | 2 | 5 | 0 | 1 / 46 | no-expresser:47 |
| 5116 | Gwenneth the second (`p_cb`) | regency | 1420–1463 | 44 | 5 | 8 | 2 | 1 | 0 | 0 | 6 | 9 | 0 | 13 / 31 | awakening:17, power:16, books:11 |
| 5117 | Daveed Gearithy (`p_1`) | unwoken | 1043–1045 | 3 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 / 3 | awakening:3 |
| 5117 | Tamsin (`p_b`) | regency | 1113–1126 | 14 | 3 | 4 | 0 | 1 | 0 | 0 | 2 | 2 | 0 | 7 / 7 | books:7, no-expresser:4, awakening:3 |
| 5118 | Daveed Gearithy (`p_1`) | unwoken | 1043–1056 | 14 | 4 | 3 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 / 12 | awakening:14 |
| 5118 | Hesper the third (`p_9i`) | regency | 1374–1407 | 34 | 7 | 7 | 0 | 3 | 0 | 0 | 3 | 4 | 0 | 0 / 34 | no-expresser:20, awakening:14 |
| 5118 | Norwell the fourth (`p_bp`) | unwoken | 1410–1415 | 6 | 2 | 2 | 1 | 0 | 0 | 0 | 2 | 0 | 0 | 1 / 5 | awakening:6 |
| 5118 | Rhoswen the eighth (`p_fc`) | regency | 1530–1542 | 13 | 5 | 2 | 1 | 0 | 0 | 0 | 1 | 1 | 0 | 1 / 12 | no-expresser:13 |
| 5119 | Daveed Gearithy (`p_1`) | unwoken | 1043–1058 | 16 | 3 | 1 | 2 | 0 | 0 | 0 | 2 | 2 | 0 | 2 / 14 | awakening:16 |
| 5119 | Rhoswen (`p_a`) | regency | 1090–1099 | 10 | 2 | 4 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 / 10 | awakening:5, no-expresser:5 |
| 5119 | Tamsin (`p_b`) | regency | 1100–1102 | 3 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 3 | awakening:3 |
| 5119 | Gisela (`p_1q`) | regency | 1116–1161 | 46 | 6 | 11 | 3 | 1 | 0 | 0 | 1 | 2 | 0 | 3 / 43 | power:35, no-expresser:10, awakening:1 |
| 5119 | Idony (`p_2g`) | regency | 1162–1202 | 41 | 8 | 13 | 1 | 1 | 0 | 0 | 2 | 3 | 0 | 1 / 40 | no-expresser:38, awakening:3 |
| 5119 | Petronel (`p_3c`) | regency | 1203–1221 | 19 | 4 | 4 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 / 19 | awakening:19 |
| 5119 | Bryde (`p_44`) | regency | 1222–1243 | 22 | 5 | 5 | 1 | 1 | 0 | 0 | 1 | 3 | 0 | 1 / 21 | awakening:22 |
| 5119 | Ulric the third (`p_5j`) | unwoken | 1244–1245 | 2 | 0 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 / 1 | awakening:2 |
| 5119 | Cecily (`p_6e`) | regency | 1316–1326 | 11 | 5 | 3 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 / 11 | no-expresser:11 |
| 5119 | Alys (`p_86`) | regency | 1334–1390 | 57 | 10 | 17 | 3 | 3 | 0 | 0 | 2 | 6 | 0 | 3 / 54 | no-expresser:57 |
| 5119 | Petronel the fifth (`p_9h`) | regency | 1391–1423 | 33 | 6 | 6 | 0 | 3 | 0 | 0 | 1 | 2 | 0 | 0 / 33 | no-expresser:28, awakening:5 |
| 5119 | Winefred the third (`p_ad`) | regency | 1424–1459 | 36 | 5 | 14 | 1 | 1 | 0 | 0 | 2 | 3 | 0 | 1 / 35 | awakening:36 |
| 5120 | Daveed Gearithy (`p_1`) | unwoken | 1043–1069 | 27 | 8 | 7 | 2 | 0 | 0 | 0 | 2 | 0 | 0 | 2 / 25 | awakening:27 |
| 5120 | Merrick (`p_3`) | unwoken | 1070–1091 | 22 | 6 | 7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 22 | awakening:22 |
| 5120 | Honor (`p_f`) | regency | 1092–1123 | 32 | 6 | 8 | 0 | 1 | 0 | 0 | 3 | 2 | 0 | 0 / 32 | no-expresser:32 |
| 5121 | Daveed Gearithy (`p_1`) | unwoken | 1043–1084 | 42 | 6 | 11 | 3 | 1 | 0 | 0 | 3 | 3 | 0 | 3 / 39 | awakening:42 |
| 5121 | Rhoswen (`p_a`) | regency | 1085–1094 | 10 | 2 | 4 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 1 / 9 | no-expresser:10 |
| 5121 | Damaris (`p_i`) | regency | 1095–1125 | 31 | 4 | 13 | 2 | 0 | 0 | 0 | 3 | 2 | 0 | 2 / 29 | no-expresser:27, awakening:4 |
| 5121 | Ulric the third (`p_2o`) | unwoken | 1140–1144 | 5 | 1 | 2 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 1 / 4 | awakening:5 |
| 5121 | Hollis the second (`p_67`) | unwoken | 1298–1328 | 31 | 7 | 6 | 0 | 1 | 0 | 0 | 1 | 2 | 0 | 0 / 31 | awakening:31 |
| 5121 | Nerys the sixth (`p_9g`) | regency | 1346–1410 | 65 | 9 | 18 | 1 | 7 | 0 | 0 | 3 | 9 | 0 | 1 / 64 | no-expresser:65 |
| 5121 | Orlaith the fifth (`p_9n`) | regency | 1411–1417 | 7 | 1 | 3 | 0 | 1 | 0 | 0 | 2 | 1 | 0 | 0 / 7 | no-expresser:7 |
| 5121 | Fritha the third (`p_a1`) | regency | 1418–1436 | 19 | 5 | 5 | 0 | 1 | 0 | 0 | 1 | 1 | 0 | 0 / 19 | no-expresser:19 |
| 5121 | Eilwen the seventh (`p_ch`) | regency | 1440–1501 | 62 | 6 | 20 | 2 | 2 | 0 | 0 | 5 | 3 | 0 | 15 / 47 | power:43, books:13, awakening:6 |
| 5122 | Daveed Gearithy (`p_1`) | unwoken | 1043–1058 | 16 | 4 | 3 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 / 14 | awakening:16 |
| 5122 | Yfenna the fourth (`p_3p`) | regency | 1196–1230 | 35 | 5 | 11 | 1 | 1 | 0 | 0 | 2 | 4 | 0 | 1 / 34 | power:35 |
| 5122 | Jorunn the second (`p_48`) | regency | 1231–1249 | 19 | 4 | 5 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 / 19 | no-expresser:12, power:7 |
| 5122 | Thomasin the second (`p_4s`) | regency | 1250–1254 | 5 | 2 | 2 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 / 5 | no-expresser:5 |
| 5122 | Honor the second (`p_54`) | regency | 1255–1258 | 4 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 / 4 | no-expresser:4 |
| 5122 | Katrin the third (`p_6l`) | regency | 1259–1331 | 73 | 7 | 22 | 3 | 2 | 0 | 0 | 5 | 7 | 0 | 12 / 61 | power:36, no-expresser:19, awakening:9, books:9 |
| 5122 | Bertram the fourth (`p_8p`) | unwoken | 1332–1338 | 7 | 2 | 3 | 1 | 0 | 0 | 0 | 0 | 2 | 0 | 1 / 6 | awakening:7 |
| 5123 | Daveed Gearithy (`p_1`) | unwoken | 1043–1059 | 17 | 3 | 4 | 1 | 0 | 0 | 0 | 3 | 0 | 0 | 1 / 16 | awakening:17 |
| 5123 | Quilla the second (`p_3r`) | regency | 1160–1224 | 65 | 6 | 18 | 5 | 1 | 0 | 0 | 1 | 6 | 0 | 17 / 48 | no-expresser:36, books:14, power:9, awakening:6 |
| 5123 | Yfenna the fourth (`p_a5`) | regency | 1399–1401 | 3 | 1 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 / 3 | awakening:3 |
| 5123 | Dalia the second (`p_ac`) | regency | 1402–1403 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 2 | awakening:2 |
| 5123 | Hesper the sixth (`p_ak`) | regency | 1404–1450 | 47 | 10 | 10 | 0 | 1 | 0 | 0 | 1 | 3 | 0 | 0 / 47 | awakening:47 |
| 5123 | Quilla the eighth (`p_g9`) | regency | 1513–1540 | 28 | 7 | 6 | 2 | 1 | 0 | 0 | 2 | 1 | 0 | 2 / 26 | no-expresser:28 |
| 5123 | Quilla the ninth (`p_ha`) | regency | 1541–1542 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 / 2 | no-expresser:2 |

## Long / ascendant / 901–902

2 histories; 1000 actual played years. Endings: devoured 2.

| Category | Intervals | Years (share of played) | Mean/max length | Quiet max | Choice | Match | Record | Auction | Orders | Routine | Automatic | Maintenance | Route / no route years |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| regency | 13 | 440 (44.0%) | 33.8/103 | 11 | 118 (0.27/y) | 14 (0.03/y) | 22 (0.05/y) | 0 (0.00/y) | 0 (0.00/y) | 22 (0.05/y) | 39 (0.09/y) | 0 (0.00/y) | 14 / 426 |
| unwoken | 3 | 61 (6.1%) | 20.3/49 | 4 | 14 (0.23/y) | 5 (0.08/y) | 2 (0.03/y) | 0 (0.00/y) | 8 (0.13/y) | 2 (0.03/y) | 1 (0.02/y) | 0 (0.00/y) | 5 / 56 |

Every interval follows. Blocker counts are years with that first unmet predicate.

| Seed | Head (id) | Category | From–to | Years | Quiet | Choice | Match | Record | Auction | Orders | Routine | Automatic | Maintenance | Route / no route | Blocker years |
|---:|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 901 | Daveed Gearithy (`p_1`) | unwoken | 1043–1047 | 5 | 3 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 / 4 | awakening:5 |
| 901 | Hesper the second (`p_49`) | regency | 1252–1271 | 20 | 4 | 6 | 0 | 1 | 0 | 0 | 3 | 2 | 0 | 0 / 20 | no-expresser:20 |
| 901 | Ulla (`p_58`) | regency | 1272–1306 | 35 | 6 | 9 | 0 | 0 | 0 | 0 | 2 | 1 | 0 | 0 / 35 | no-expresser:35 |
| 901 | Gisela the second (`p_91`) | regency | 1314–1317 | 4 | 2 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 / 3 | no-expresser:4 |
| 901 | Maura the second (`p_97`) | regency | 1322–1381 | 60 | 7 | 16 | 3 | 4 | 0 | 0 | 1 | 8 | 0 | 3 / 57 | no-expresser:60 |
| 901 | Jorunn the fifth (`p_bg`) | regency | 1387–1489 | 103 | 6 | 22 | 2 | 5 | 0 | 0 | 3 | 12 | 0 | 2 / 101 | no-expresser:103 |
| 901 | Fritha the second (`p_f2`) | regency | 1497–1542 | 46 | 6 | 14 | 2 | 3 | 0 | 0 | 2 | 2 | 0 | 2 / 44 | no-expresser:46 |
| 902 | Daveed Gearithy (`p_1`) | unwoken | 1043–1091 | 49 | 4 | 12 | 4 | 2 | 0 | 8 | 2 | 1 | 0 | 4 / 45 | awakening:49 |
| 902 | Merrick (`p_3`) | unwoken | 1092–1098 | 7 | 4 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 7 | awakening:7 |
| 902 | Gisela the second (`p_2h`) | regency | 1220–1229 | 10 | 8 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 / 10 | no-expresser:10 |
| 902 | Katrin the second (`p_2p`) | regency | 1230–1247 | 18 | 5 | 5 | 1 | 0 | 0 | 0 | 4 | 1 | 0 | 1 / 17 | no-expresser:18 |
| 902 | Katrin the third (`p_36`) | regency | 1248–1286 | 39 | 9 | 12 | 2 | 1 | 0 | 0 | 3 | 2 | 0 | 2 / 37 | no-expresser:39 |
| 902 | Cecily the second (`p_3q`) | regency | 1287–1314 | 28 | 11 | 8 | 1 | 2 | 0 | 0 | 1 | 0 | 0 | 1 / 27 | no-expresser:28 |
| 902 | Nerys (`p_42`) | regency | 1315–1318 | 4 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 4 | awakening:3, no-expresser:1 |
| 902 | Cecily the fourth (`p_c0`) | regency | 1470–1515 | 46 | 6 | 10 | 1 | 4 | 0 | 0 | 2 | 7 | 0 | 1 / 45 | no-expresser:36, awakening:10 |
| 902 | Jorunn the fifth (`p_cu`) | regency | 1516–1542 | 27 | 5 | 11 | 1 | 2 | 0 | 0 | 1 | 3 | 0 | 1 / 26 | no-expresser:27 |

## Long / ascendant / G1 5100–5123

24 histories; 9542 actual played years. Endings: broken_line 6, devoured 12, forgotten 5, unmade 1.

| Category | Intervals | Years (share of played) | Mean/max length | Quiet max | Choice | Match | Record | Auction | Orders | Routine | Automatic | Maintenance | Route / no route years |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| regency | 60 | 1460 (15.3%) | 24.3/82 | 13 | 443 (0.30/y) | 57 (0.04/y) | 67 (0.05/y) | 0 (0.00/y) | 10 (0.01/y) | 90 (0.06/y) | 145 (0.10/y) | 0 (0.00/y) | 111 / 1349 |
| unwoken | 42 | 649 (6.8%) | 15.5/63 | 7 | 176 (0.27/y) | 58 (0.09/y) | 13 (0.02/y) | 0 (0.00/y) | 43 (0.07/y) | 27 (0.04/y) | 32 (0.05/y) | 0 (0.00/y) | 58 / 591 |

Every interval follows. Blocker counts are years with that first unmet predicate.

| Seed | Head (id) | Category | From–to | Years | Quiet | Choice | Match | Record | Auction | Orders | Routine | Automatic | Maintenance | Route / no route | Blocker years |
|---:|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 5100 | Daveed Gearithy (`p_1`) | unwoken | 1043–1099 | 57 | 6 | 16 | 5 | 0 | 0 | 10 | 2 | 5 | 0 | 5 / 52 | awakening:57 |
| 5100 | Aveline the second (`p_f`) | regency | 1100–1138 | 39 | 5 | 15 | 2 | 1 | 0 | 2 | 1 | 2 | 0 | 5 / 34 | no-expresser:19, awakening:15, books:3, power:2 |
| 5100 | Katrin the second (`p_2j`) | regency | 1197–1234 | 38 | 5 | 15 | 2 | 3 | 0 | 0 | 5 | 3 | 0 | 2 / 36 | no-expresser:24, awakening:14 |
| 5100 | Rhoswen the third (`p_39`) | regency | 1235–1243 | 9 | 4 | 5 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 / 9 | awakening:9 |
| 5100 | Yardley the second (`p_b6`) | unwoken | 1465–1465 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 1 | awakening:1 |
| 5101 | Daveed Gearithy (`p_1`) | unwoken | 1043–1058 | 16 | 3 | 5 | 2 | 0 | 0 | 0 | 1 | 2 | 0 | 2 / 14 | awakening:16 |
| 5101 | Honor (`p_s`) | regency | 1126–1131 | 6 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 / 6 | no-expresser:6 |
| 5101 | Jorunn (`p_2b`) | regency | 1137–1159 | 23 | 5 | 6 | 1 | 1 | 0 | 0 | 0 | 5 | 0 | 16 / 7 | books:15, no-expresser:6, awakening:2 |
| 5101 | Corwen (`p_3u`) | regency | 1223–1257 | 35 | 4 | 12 | 0 | 1 | 0 | 0 | 4 | 1 | 0 | 0 / 35 | no-expresser:21, awakening:14 |
| 5101 | Ordric the second (`p_69`) | unwoken | 1260–1260 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 1 | awakening:1 |
| 5101 | Kelwin the second (`p_6p`) | unwoken | 1276–1281 | 6 | 2 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 / 5 | awakening:6 |
| 5101 | Ilsa the fourth (`p_cr`) | regency | 1516–1531 | 16 | 5 | 5 | 0 | 1 | 0 | 0 | 0 | 3 | 0 | 0 / 16 | no-expresser:16 |
| 5101 | Thomasin the fourth (`p_e1`) | regency | 1532–1542 | 11 | 3 | 3 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 1 / 10 | no-expresser:7, awakening:3, power:1 |
| 5102 | Daveed Gearithy (`p_1`) | unwoken | 1043–1050 | 8 | 4 | 1 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 1 / 7 | awakening:8 |
| 5102 | Merrick (`p_3`) | unwoken | 1051–1054 | 4 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 / 3 | awakening:4 |
| 5102 | Edric the second (`p_6i`) | unwoken | 1212–1214 | 3 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 3 | awakening:3 |
| 5102 | Rhoswen the seventh (`p_ck`) | regency | 1398–1440 | 43 | 7 | 14 | 3 | 3 | 0 | 0 | 1 | 2 | 0 | 3 / 40 | no-expresser:40, awakening:3 |
| 5102 | Rhoswen the eighth (`p_dt`) | regency | 1441–1444 | 4 | 0 | 4 | 1 | 0 | 0 | 0 | 1 | 1 | 0 | 1 / 3 | no-expresser:4 |
| 5102 | Edlyn the third (`p_f1`) | regency | 1446–1527 | 82 | 5 | 25 | 3 | 4 | 0 | 0 | 9 | 11 | 0 | 3 / 79 | awakening:43, no-expresser:39 |
| 5102 | Cecily the sixth (`p_j7`) | regency | 1541–1542 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 2 | awakening:2 |
| 5103 | Daveed Gearithy (`p_1`) | unwoken | 1043–1056 | 14 | 3 | 3 | 2 | 0 | 0 | 0 | 0 | 2 | 0 | 2 / 12 | awakening:14 |
| 5103 | Merrick (`p_3`) | unwoken | 1057–1077 | 21 | 6 | 3 | 1 | 0 | 0 | 0 | 1 | 2 | 0 | 1 / 20 | awakening:21 |
| 5103 | Alys (`p_35`) | regency | 1158–1163 | 6 | 1 | 4 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 1 / 5 | no-expresser:6 |
| 5103 | Nessa the fourth (`p_3l`) | regency | 1169–1222 | 54 | 5 | 15 | 3 | 2 | 0 | 0 | 5 | 3 | 0 | 3 / 51 | no-expresser:47, awakening:7 |
| 5103 | Odila the fourth (`p_co`) | regency | 1497–1497 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 1 | no-expresser:1 |
| 5103 | Idony the eighth (`p_cs`) | regency | 1498–1513 | 16 | 6 | 3 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 / 16 | no-expresser:16 |
| 5103 | Wilda the third (`p_dd`) | regency | 1514–1516 | 3 | 1 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 / 3 | no-expresser:3 |
| 5103 | Dalia the second (`p_dh`) | regency | 1517–1522 | 6 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 / 6 | no-expresser:6 |
| 5103 | Edlyn the sixth (`p_g0`) | regency | 1537–1542 | 6 | 1 | 2 | 1 | 1 | 0 | 0 | 0 | 2 | 0 | 6 / 0 | books:6 |
| 5104 | Daveed Gearithy (`p_1`) | unwoken | 1043–1053 | 11 | 4 | 2 | 2 | 0 | 0 | 0 | 1 | 2 | 0 | 2 / 9 | awakening:11 |
| 5104 | Quilla (`p_w`) | regency | 1126–1126 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 1 | no-expresser:1 |
| 5104 | Aldous the second (`p_1w`) | unwoken | 1127–1129 | 3 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 3 | no-expresser:3 |
| 5104 | Thorne the second (`p_2i`) | unwoken | 1130–1133 | 4 | 1 | 3 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 1 / 3 | no-expresser:4 |
| 5105 | Daveed Gearithy (`p_1`) | unwoken | 1043–1044 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 2 | awakening:2 |
| 5105 | Daveed Gearithy (`p_1`) | unwoken | 1054–1065 | 12 | 4 | 2 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 / 12 | awakening:12 |
| 5106 | Daveed Gearithy (`p_1`) | unwoken | 1043–1052 | 10 | 2 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 / 9 | awakening:10 |
| 5106 | Ulla the third (`p_6q`) | regency | 1297–1337 | 41 | 6 | 16 | 4 | 1 | 0 | 0 | 2 | 3 | 0 | 4 / 37 | no-expresser:41 |
| 5106 | Ysolde the second (`p_8e`) | regency | 1338–1372 | 35 | 5 | 10 | 2 | 2 | 0 | 0 | 2 | 6 | 0 | 2 / 33 | no-expresser:23, awakening:12 |
| 5106 | Jocelyn the third (`p_az`) | unwoken | 1378–1383 | 6 | 1 | 4 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 1 / 5 | awakening:6 |
| 5106 | Odila the seventh (`p_c5`) | regency | 1498–1500 | 3 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 3 | no-expresser:3 |
| 5106 | Rhian the fourth (`p_ev`) | regency | 1501–1542 | 42 | 13 | 9 | 2 | 1 | 0 | 0 | 3 | 5 | 0 | 7 / 35 | no-expresser:23, awakening:14, books:5 |
| 5107 | Daveed Gearithy (`p_1`) | unwoken | 1043–1062 | 20 | 3 | 5 | 3 | 1 | 0 | 0 | 1 | 2 | 0 | 3 / 17 | awakening:20 |
| 5108 | Daveed Gearithy (`p_1`) | unwoken | 1043–1072 | 30 | 2 | 10 | 3 | 0 | 0 | 6 | 1 | 1 | 0 | 3 / 27 | awakening:30 |
| 5108 | Merrick (`p_3`) | unwoken | 1073–1088 | 16 | 4 | 4 | 2 | 1 | 0 | 1 | 0 | 1 | 0 | 2 / 14 | awakening:16 |
| 5108 | Uthred the second (`p_15`) | unwoken | 1095–1098 | 4 | 2 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 / 3 | awakening:4 |
| 5109 | Daveed Gearithy (`p_1`) | unwoken | 1043–1051 | 9 | 4 | 1 | 1 | 0 | 0 | 0 | 3 | 0 | 0 | 1 / 8 | awakening:9 |
| 5110 | Daveed Gearithy (`p_1`) | unwoken | 1043–1105 | 63 | 4 | 20 | 1 | 2 | 0 | 8 | 1 | 5 | 0 | 1 / 62 | awakening:63 |
| 5111 | Daveed Gearithy (`p_1`) | unwoken | 1043–1068 | 26 | 3 | 10 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 2 / 24 | awakening:26 |
| 5111 | Merrick (`p_3`) | unwoken | 1069–1084 | 16 | 3 | 4 | 1 | 0 | 0 | 0 | 1 | 1 | 0 | 1 / 15 | awakening:16 |
| 5111 | Honor (`p_27`) | regency | 1148–1165 | 18 | 8 | 4 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | 1 / 17 | awakening:13, no-expresser:5 |
| 5112 | Daveed Gearithy (`p_1`) | unwoken | 1043–1067 | 25 | 4 | 8 | 3 | 1 | 0 | 0 | 1 | 0 | 0 | 3 / 22 | awakening:25 |
| 5112 | Honor the second (`p_1z`) | regency | 1134–1167 | 34 | 7 | 8 | 3 | 1 | 0 | 1 | 0 | 4 | 0 | 21 / 13 | books:18, awakening:7, no-expresser:6, madness-floor:2, power:1 |
| 5112 | Merrick the sixth (`p_8d`) | unwoken | 1356–1375 | 20 | 7 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 20 | awakening:20 |
| 5112 | Nessa the second (`p_9z`) | regency | 1376–1431 | 56 | 6 | 17 | 2 | 2 | 0 | 0 | 1 | 5 | 0 | 2 / 54 | no-expresser:35, awakening:16, power:5 |
| 5112 | Fritha the second (`p_c4`) | regency | 1466–1482 | 17 | 4 | 3 | 0 | 0 | 0 | 0 | 2 | 4 | 0 | 0 / 17 | awakening:17 |
| 5112 | Wilda the sixth (`p_d3`) | regency | 1483–1497 | 15 | 3 | 4 | 0 | 1 | 0 | 0 | 1 | 3 | 0 | 0 / 15 | awakening:15 |
| 5112 | Yfenna the third (`p_dy`) | regency | 1498–1521 | 24 | 4 | 8 | 1 | 0 | 0 | 0 | 2 | 0 | 0 | 1 / 23 | no-expresser:19, awakening:5 |
| 5112 | Jehane the fifth (`p_f2`) | regency | 1522–1531 | 10 | 3 | 5 | 1 | 3 | 0 | 0 | 0 | 1 | 0 | 1 / 9 | awakening:6, no-expresser:4 |
| 5113 | Daveed Gearithy (`p_1`) | unwoken | 1043–1056 | 14 | 3 | 5 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 / 12 | awakening:14 |
| 5113 | Petronel the third (`p_b7`) | regency | 1379–1416 | 38 | 6 | 11 | 0 | 1 | 0 | 0 | 3 | 4 | 0 | 0 / 38 | no-expresser:38 |
| 5113 | Lisbeth the third (`p_9v`) | regency | 1417–1417 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 1 | no-expresser:1 |
| 5113 | Odila the sixth (`p_bf`) | regency | 1418–1438 | 21 | 6 | 4 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 / 21 | no-expresser:21 |
| 5113 | Ursel the second (`p_ee`) | regency | 1442–1487 | 46 | 6 | 15 | 3 | 2 | 0 | 0 | 2 | 4 | 0 | 3 / 43 | awakening:39, power:6, no-expresser:1 |
| 5113 | Uthred the third (`p_gb`) | unwoken | 1501–1503 | 3 | 0 | 1 | 1 | 1 | 0 | 0 | 0 | 1 | 0 | 1 / 2 | awakening:3 |
| 5114 | Daveed Gearithy (`p_1`) | unwoken | 1043–1056 | 14 | 2 | 3 | 2 | 0 | 0 | 0 | 2 | 0 | 0 | 2 / 12 | awakening:14 |
| 5114 | Nerys the second (`p_7n`) | regency | 1270–1307 | 38 | 6 | 10 | 1 | 2 | 0 | 0 | 4 | 5 | 0 | 1 / 37 | no-expresser:38 |
| 5114 | Quilla the second (`p_8n`) | regency | 1308–1355 | 48 | 4 | 14 | 1 | 1 | 0 | 0 | 1 | 6 | 0 | 1 / 47 | no-expresser:29, awakening:11, power:8 |
| 5114 | Jorunn the third (`p_af`) | regency | 1356–1373 | 18 | 2 | 11 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 / 18 | no-expresser:18 |
| 5114 | Ilsa the third (`p_b0`) | regency | 1375–1375 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 / 1 | no-expresser:1 |
| 5114 | Ysolde the second (`p_b1`) | regency | 1376–1445 | 70 | 6 | 19 | 2 | 2 | 0 | 0 | 3 | 4 | 0 | 2 / 68 | awakening:30, power:26, no-expresser:14 |
| 5114 | Petronel the fifth (`p_c4`) | regency | 1446–1457 | 12 | 1 | 5 | 0 | 1 | 0 | 0 | 1 | 2 | 0 | 0 / 12 | awakening:12 |
| 5114 | Bethen the third (`p_d5`) | regency | 1458–1516 | 59 | 5 | 15 | 2 | 5 | 0 | 0 | 5 | 7 | 0 | 2 / 57 | awakening:59 |
| 5115 | Daveed Gearithy (`p_1`) | unwoken | 1043–1057 | 15 | 3 | 6 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 2 / 13 | awakening:15 |
| 5115 | Daveed Gearithy (`p_1`) | unwoken | 1062–1078 | 17 | 3 | 5 | 2 | 1 | 0 | 3 | 2 | 2 | 0 | 2 / 15 | awakening:17 |
| 5115 | Petronel (`p_n`) | regency | 1125–1135 | 11 | 2 | 6 | 0 | 1 | 0 | 0 | 0 | 2 | 0 | 0 / 11 | no-expresser:11 |
| 5115 | Ivor (`p_1i`) | unwoken | 1136–1140 | 5 | 3 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 / 5 | no-expresser:5 |
| 5116 | Daveed Gearithy (`p_1`) | unwoken | 1043–1058 | 16 | 4 | 3 | 2 | 0 | 0 | 0 | 0 | 1 | 0 | 2 / 14 | awakening:16 |
| 5116 | Amice (`p_2f`) | regency | 1158–1231 | 74 | 10 | 16 | 1 | 2 | 0 | 0 | 4 | 8 | 0 | 1 / 73 | no-expresser:51, power:23 |
| 5116 | Fenna the second (`p_3v`) | regency | 1232–1288 | 57 | 4 | 18 | 5 | 5 | 0 | 0 | 2 | 8 | 0 | 5 / 52 | no-expresser:57 |
| 5116 | Jorunn (`p_4d`) | regency | 1289–1321 | 33 | 6 | 12 | 0 | 3 | 0 | 0 | 6 | 5 | 0 | 0 / 33 | awakening:11, no-expresser:11, power:11 |
| 5116 | Tamsin the second (`p_42`) | regency | 1322–1335 | 14 | 4 | 1 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 / 14 | power:14 |
| 5116 | Quilla the second (`p_4u`) | regency | 1336–1355 | 20 | 3 | 8 | 0 | 2 | 0 | 0 | 1 | 1 | 0 | 0 / 20 | power:20 |
| 5117 | Daveed Gearithy (`p_1`) | unwoken | 1043–1045 | 3 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 / 3 | awakening:3 |
| 5117 | Winefred (`p_10`) | regency | 1140–1173 | 34 | 4 | 11 | 3 | 2 | 0 | 0 | 2 | 4 | 0 | 11 / 23 | power:10, books:9, awakening:8, no-expresser:7 |
| 5118 | Daveed Gearithy (`p_1`) | unwoken | 1043–1056 | 14 | 4 | 3 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 / 12 | awakening:14 |
| 5119 | Daveed Gearithy (`p_1`) | unwoken | 1043–1058 | 16 | 3 | 2 | 2 | 0 | 0 | 0 | 2 | 2 | 0 | 2 / 14 | awakening:16 |
| 5119 | Rhoswen (`p_a`) | regency | 1090–1099 | 10 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 2 | 0 | 0 / 10 | no-expresser:10 |
| 5119 | Tamsin (`p_b`) | regency | 1100–1102 | 3 | 0 | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 / 3 | no-expresser:3 |
| 5119 | Nerys the second (`p_14`) | regency | 1103–1103 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 / 1 | no-expresser:1 |
| 5120 | Daveed Gearithy (`p_1`) | unwoken | 1043–1069 | 27 | 6 | 9 | 2 | 0 | 0 | 6 | 0 | 0 | 0 | 2 / 25 | awakening:27 |
| 5120 | Merrick (`p_3`) | unwoken | 1070–1091 | 22 | 6 | 7 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 / 22 | awakening:22 |
| 5120 | Honor (`p_f`) | regency | 1092–1123 | 32 | 8 | 9 | 0 | 0 | 0 | 0 | 4 | 1 | 0 | 0 / 32 | no-expresser:32 |
| 5121 | Daveed Gearithy (`p_1`) | unwoken | 1043–1084 | 42 | 4 | 13 | 3 | 0 | 0 | 7 | 4 | 1 | 0 | 3 / 39 | awakening:42 |
| 5121 | Rhoswen (`p_a`) | regency | 1085–1094 | 10 | 2 | 5 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 1 / 9 | no-expresser:10 |
| 5121 | Damaris (`p_i`) | regency | 1095–1125 | 31 | 4 | 12 | 3 | 2 | 0 | 0 | 3 | 1 | 0 | 3 / 28 | awakening:13, no-expresser:9, power:9 |
| 5122 | Daveed Gearithy (`p_1`) | unwoken | 1043–1058 | 16 | 4 | 3 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 / 14 | awakening:16 |
| 5123 | Daveed Gearithy (`p_1`) | unwoken | 1043–1059 | 17 | 3 | 5 | 1 | 0 | 0 | 0 | 2 | 0 | 0 | 1 / 16 | awakening:17 |
| 5123 | Odila the sixth (`p_eq`) | regency | 1455–1484 | 30 | 4 | 8 | 0 | 0 | 0 | 2 | 2 | 0 | 0 | 0 / 30 | awakening:30 |
| 5123 | Vessa the seventh (`p_f1`) | regency | 1485–1488 | 4 | 1 | 2 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 / 4 | awakening:4 |
| 5123 | Verity the fifth (`p_f3`) | regency | 1489–1513 | 25 | 3 | 6 | 0 | 1 | 0 | 1 | 2 | 4 | 0 | 0 / 25 | no-expresser:14, awakening:11 |
| 5123 | Gisela the fourth (`p_h8`) | regency | 1514–1514 | 1 | 0 | 1 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 / 1 | no-expresser:1 |
| 5123 | Nerys the sixth (`p_hq`) | regency | 1521–1542 | 22 | 11 | 3 | 1 | 1 | 0 | 0 | 1 | 4 | 0 | 1 / 21 | no-expresser:22 |

