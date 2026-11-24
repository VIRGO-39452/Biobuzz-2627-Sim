// Assumed material densities / fixed masses used to estimate mass from CAD volumes (estimates).
// density in kg/m^3 applied to the measured solid volume, or a fixed mass for bought-in assemblies
export const RULES = [
  { match: /^5203-2402-0019/, massKg: 0.43, cls: 'motors', why: 'Yellow Jacket 19.2:1, approximate catalogue weight' },
  { match: /^5203-2402-0051/, massKg: 0.49, cls: 'motors', why: 'Yellow Jacket 50.9:1, scaled from the 19.2:1 by volume' },
  { match: /^3100-0012-0020/, massKg: 0.57, cls: 'battery', why: '12 V 3000 mAh NiMH pack, approximate' },
  { match: /^2000-0025-/, massKg: 0.06, cls: 'servos', why: 'standard-size servo, approximate' },
  { match: /^(1120|1121|1143|1201|1205|1209|1309|1310|1616|3217|2302|2303|2920|1501|1502|1516|1522|3307)-/, density: 2700, cls: 'aluminium structure and hubs' },
  { match: /^(2106|1611|2807)-|^Hardware/, density: 7850, cls: 'steel shafts, bearings, fasteners' },
  { match: /^1117-/, density: 1200, cls: 'polycarbonate plates' },
  { match: /^(3626|3624|3613)-/, density: 1200, cls: 'wheels (plastic and rubber)' },
  { match: /^3618-/, density: 1100, cls: 'silicone rollers' },
  { match: /^3309-/, density: 1410, cls: 'plastic chain' },
  { match: /^Zip-Ties/, density: 1140, cls: 'zip ties' },
];


export function partMassKg(name, volumeM3) {
  const rule = RULES.find((r) => r.match.test(name));
  if (!rule) return null;
  return { massKg: rule.massKg ?? rule.density * volumeM3, cls: rule.cls };
}
