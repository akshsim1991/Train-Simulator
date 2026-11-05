// Train dynamics. Pure, deterministic, no DOM. Units: SI (m, s, N, kg).
// Position `s` is the distance of the FRONT of the train along the route.
// Velocity is signed so a train can roll backwards on a gradient.

export const G = 9.81;

export const UNIT = {
  name: 'Class 395-style 8-car EMU',
  cars: 8,
  carLength: 20,
  mass: 330000,             // kg, loaded
  rotationalFactor: 1.06,   // equivalent inertia of wheels/rotors
  driveMassFraction: 0.5,   // fraction of mass on powered axles
  power: 4.2e6,             // W at the rail
  maxTractive: 340000,      // N
  topSpeed: 62,             // m/s mechanical limit (223 km/h)
  brakeService: 1.0,        // m/s^2 at full service (cylinder pressure 1)
  brakeEmergency: 1.35,     // m/s^2
  brakeApplyTime: 2.2,      // s, 0 -> full
  brakeReleaseTime: 3.5,
  brakeEmergencyTime: 0.9,
  davisA: 3200,             // N (rolling, constant)
  davisB: 85,               // N per m/s
  davisC: 12,               // N per (m/s)^2 (aero)
  tunnelDragFactor: 1.9,    // multiplies aero term inside a tunnel
  curveResistance: 650,     // N per kN... see curveForce()
  staticResistance: 5500,   // N needed to break away on level track
  tractionRampTime: 1.4,    // s, notch 0 -> 1 (jerk limit)
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
  const fAdh = adhesion * unit.mass * unit.driveMassFraction * G;
  t.slip = fTrac > fAdh;
  if (t.slip) { fTrac = fAdh * 0.8; t.cumulativeSlip += dt; }
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
