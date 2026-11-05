// Train consists (locomotive + coaches) with specifications taken from published Indian Railways data.
//  WAP-7 : 25 kV AC Co-Co electric, 4,740 kW max / 4,563 kW continuous, 322 kN starting TE, 123 t,
//          20.56 m over buffers, 3.15 m wide (Wikipedia / loco-info).
//  LHB   : 23.54 m over body, ~40 t tare (AC chair car), FIAT bogies.  ICF: 21.77 m, ~47-50 t.
//  WDP-4D: 4,000 hp (2.98 MW) EMD diesel, ~138 t, 160 km/h.
import { G } from './physics.js';

export const LOCOS = {
  wap7: { id: 'wap7', name: 'WAP-7', kind: 'electric', length: 20.56, width: 3.15, mass: 123000, railPower: 4.4e6, startTE: 322000, topKmh: 140, axles: 6 },
  wap7hs: { id: 'wap7hs', name: 'WAP-7HS', kind: 'electric', length: 20.56, width: 3.15, mass: 119000, railPower: 4.4e6, startTE: 300000, topKmh: 160, axles: 6 },
  wdp4: { id: 'wdp4', name: 'WDP-4D', kind: 'diesel', length: 21.3, width: 3.0, mass: 138000, railPower: 2.75e6, startTE: 270000, topKmh: 140, axles: 6 },
};
export const COACHES = {
  lhb: { id: 'lhb', name: 'LHB', length: 23.54, width: 3.24, mass: 54000, brakeFactor: 1.0 },       // loaded (tare ~40 t + passengers/luggage)
  icf: { id: 'icf', name: 'ICF', length: 21.77, width: 3.25, mass: 58000, brakeFactor: 0.85 },
};

export const CONSISTS = {
  shatabdi: { id: 'shatabdi', title: 'Shatabdi-style · WAP-7 + 16 LHB', loco: 'wap7', coach: 'lhb', coaches: 16, blurb: 'Fast AC express. Strong and heavy.' },
  gatimaan: { id: 'gatimaan', title: 'Gatimaan-style · WAP-7HS + 10 LHB', loco: 'wap7hs', coach: 'lhb', coaches: 10, blurb: '160 km/h capable, lighter rake.' },
  mail: { id: 'mail', title: 'Mail/Express · WAP-7 + 20 ICF', loco: 'wap7', coach: 'icf', coaches: 20, blurb: 'Long, heavy ICF rake: plan your braking.' },
  diesel: { id: 'diesel', title: 'Diesel Express · WDP-4D + 14 ICF', loco: 'wdp4', coach: 'icf', coaches: 14, blurb: 'Lower power, long braking distances.' },
};

/** Build the physics "unit" for a consist (same shape physics.js expects). */
export function makeUnit(consistId = 'shatabdi') {
  const c = CONSISTS[consistId] || CONSISTS.shatabdi, L = LOCOS[c.loco], C = COACHES[c.coach];
  const mass = L.mass + C.mass * c.coaches;
  const length = L.length + C.length * c.coaches + 0.6 * c.coaches;
  return {
    id: c.id, name: c.title, loco: L, coach: C, cars: c.coaches, carLength: C.length, length,
    mass, rotationalFactor: 1.06,
    driveMassFraction: L.mass / mass,
    power: L.railPower, maxTractive: L.startTE, topSpeed: L.topKmh / 3.6,
    // Pneumatic brake on a long train: slow to apply and slower to release.
    brakeService: 0.58 * C.brakeFactor + 0.04, brakeEmergency: 0.9 * C.brakeFactor + 0.05,
    brakeApplyTime: 4.5 + c.coaches * 0.12, brakeReleaseTime: 7.5 + c.coaches * 0.25, brakeEmergencyTime: 2.2 + c.coaches * 0.04,
    davisA: 0.0012 * mass * G, davisB: 0.00011 * mass, davisC: 8 + 0.9 * c.coaches,
    tunnelDragFactor: 1.9, curveResistance: 650, staticResistance: 0.0022 * mass * G, tractionRampTime: 2.2,
    consistId: c.id,
  };
}
