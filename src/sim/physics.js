// Train dynamics. Pure, deterministic, no DOM. Units: SI (m, s, N, kg).
// Position `s` is the distance of the FRONT of the train along the route.
// Velocity is signed so a train can roll backwards on a gradient.

export const G = 9.81;

// Default unit (Shatabdi-style: WAP-7 + 16 LHB). See consist.js for the other trains and their sources.
const _M = 123000 + 54000 * 16;
export const UNIT = {
  name: 'Shatabdi-style · WAP-7 + 16 LHB', cars: 16, carLength: 23.54, length: 20.56 + 16 * 23.54 + 0.6 * 16,
  mass: _M, rotationalFactor: 1.06, driveMassFraction: 123000 / _M,
  power: 4.4e6, maxTractive: 322000, topSpeed: 140 / 3.6,
  brakeService: 0.62, brakeEmergency: 0.95, brakeApplyTime: 6.4, brakeReleaseTime: 11.5, brakeEmergencyTime: 2.9,
  davisA: 0.0012 * _M * G, davisB: 0.00011 * _M, davisC: 8 + 0.9 * 16,
  tunnelDragFactor: 1.9, curveResistance: 650, staticResistance: 0.0022 * _M * G, tractionRampTime: 2.2,
};

export function newTrainState(s0 = 0) {
  return {
    s: s0,
    v: 0,
    a: 0,               // last longitudinal acceleration (m/s^2)
    jerk: 0,
    lever: 0,           // master controller, -1 (full brake) .. +1 (full power)
    traction: 0,        // actual traction demand after ramp, 0..1
    brakeCyl: 0,        // brake cylinder pressure 0..1
    emergency: false,
    tractionCut: false, // doors open, protection etc.
    slip: false,
    cumulativeSlip: 0,
  };
}

/** Maximum tractive effort available at speed v (N), before adhesion. */
export function tractiveEnvelope(v, unit = UNIT) {
  const av = Math.abs(v);
  return Math.min(unit.maxTractive, unit.power / Math.max(av, 0.5));
}

/** Davis-style running resistance magnitude (N, always >= 0). */
export function runningResistance(v, env = {}, unit = UNIT) {
  const av = Math.abs(v);
  const aero = unit.davisC * av * av * (env.tunnel ? unit.tunnelDragFactor : 1);
  return unit.davisA + unit.davisB * av + aero;
}

/** Curve resistance (N), grows with 1/R. radius = Infinity for straight. */
export function curveForce(radius, unit = UNIT) {
  if (!isFinite(radius) || radius <= 0) return 0;
  // ~ 6.5/(R-55) kN/kN empirical (Roeckl) -> use 0.65 kN/t * (500/R)
  const perTonne = (unit.curveResistance * Math.min(1, 500 / Math.max(radius, 150)));
  return perTonne * (unit.mass / 1000) * 0.15;
}

/**
 * Advance the train by dt seconds.
 * env: { grade (rise/run, + = uphill in the direction of travel), radius, tunnel, adhesion (0..1) }
 */
export function stepTrain(t, dt, env = {}, unit = UNIT) {
  const grade = env.grade || 0;
  const adhesion = env.adhesion == null ? 0.28 : env.adhesion; // dry ~0.28, wet ~0.16, leaves/ice ~0.08
  const m = unit.mass * unit.rotationalFactor;

  // --- controller -> demands -------------------------------------------------
  const lever = Math.max(-1, Math.min(1, t.lever));
  let wantTraction = lever > 0 ? lever : 0;
  let wantBrake = lever < 0 ? -lever : 0;
  if (t.emergency) { wantTraction = 0; wantBrake = 1; }
  if (t.tractionCut || wantBrake > 0.02) wantTraction = 0;

  // traction ramps (jerk limit), but drops instantly when cut
  if (wantTraction < t.traction) t.traction = wantTraction;
  else t.traction = Math.min(wantTraction, t.traction + dt / unit.tractionRampTime);

  // brake cylinder pressure lag
  const target = wantBrake;
  const rate = t.emergency ? 1 / unit.brakeEmergencyTime
    : target > t.brakeCyl ? 1 / unit.brakeApplyTime : 1 / unit.brakeReleaseTime;
  if (target > t.brakeCyl) t.brakeCyl = Math.min(target, t.brakeCyl + rate * dt);
  else t.brakeCyl = Math.max(target, t.brakeCyl - rate * dt);

  // --- forces ----------------------------------------------------------------
  const theta = Math.atan(grade);
  const fGrade = -unit.mass * G * Math.sin(theta);           // gravity along track
  let fTrac = t.traction * tractiveEnvelope(t.v, unit);
  if (Math.abs(t.v) >= unit.topSpeed) fTrac = 0;
  // Adhesion limit on the driven axles. When the wheels start to slip the sanders drop sand automatically
  // (+0.07 effective adhesion), as on Indian locomotives; beyond that the wheels slip and tractive effort drops.
  const fAdh0 = adhesion * unit.mass * unit.driveMassFraction * G;
  const sanding = fTrac > fAdh0;
  const fAdh = sanding ? (adhesion + 0.07) * unit.mass * unit.driveMassFraction * G : fAdh0;
  t.sanding = sanding;
  t.slip = fTrac > fAdh;
  if (t.slip) { fTrac = fAdh * 0.9; t.cumulativeSlip += dt; }
  const decelMax = t.emergency ? unit.brakeEmergency : unit.brakeService;
  // braking is limited by adhesion on all axles too
  let fBrake = Math.min(t.brakeCyl * decelMax * unit.mass, adhesion * unit.mass * G * 1.05);
  const fRes = runningResistance(t.v, env, unit) + curveForce(env.radius, unit);
  const fApplied = fTrac + fGrade;

  // --- integrate -------------------------------------------------------------
  const v0 = t.v;
  let v1;
  if (v0 === 0) {
    // Standing: break-away needs applied force to beat static resistance + brake.
    const holding = fBrake + unit.staticResistance;
    if (Math.abs(fApplied) <= holding) v1 = 0;
    else {
      const dir = Math.sign(fApplied);
      v1 = dir * ((Math.abs(fApplied) - holding) / m) * dt;
    }
  } else {
    const dir = Math.sign(v0);
    const net = fApplied - dir * (fRes + fBrake);
    v1 = v0 + (net / m) * dt;
    if (v1 * v0 < 0) v1 = 0; // friction/brake cannot reverse the train: stick
  }
  v1 = Math.max(-unit.topSpeed, Math.min(unit.topSpeed, v1));

  const aNew = (v1 - v0) / dt;
  t.jerk = (aNew - t.a) / dt;
  t.a = aNew;
  t.s += 0.5 * (v0 + v1) * dt;
  t.v = v1;
  return t;
}

/** Distance needed to stop from speed v at constant decel a (m/s^2). */
export function brakingDistance(v, a = 0.7) {
  return (v * v) / (2 * a);
}
