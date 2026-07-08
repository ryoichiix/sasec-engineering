/**
 * IndustrialScene — reusable blueprint line-art illustrations.
 *
 * Monochrome stroke-only SVG in the SASEC "elevation drawing" style.
 * Inherits color via currentColor — the caller sets tone + opacity, e.g.:
 *
 *   // dark page (login):
 *   <IndustrialScene variant="construction" className="fixed inset-0 h-full text-[#8FA3BF]" />
 *   // light app pages (corner decoration):
 *   <IndustrialScene variant="dashboard" className="absolute bottom-0 right-0 w-[360px] text-slate-400 opacity-20" />
 *
 * Variants:
 *   construction — full steel-plant erection panorama (login background)
 *   dashboard    — compact site overview (crane + skeleton)
 *   attendance   — site gate with clock, barrier and workers clocking in
 *   workfeed     — supervisor with clipboard reporting from an active bay
 *
 * Pure SVG + CSS animation, no libraries. All motion honors
 * prefers-reduced-motion.
 */

const INK = { strokeLinecap: 'round', strokeLinejoin: 'round' }
const MONO = "'IBM Plex Mono', ui-monospace, monospace"

/* ─────────────────────────── shared animation CSS ─────────────────────── */

function SceneStyle() {
  return (
    <style>{`
      /* structure erects itself — subpaths draw sequentially */
      .is-draw {
        stroke-dasharray: 1;
        stroke-dashoffset: 1;
        animation: isDrawIn 2.2s cubic-bezier(0.3, 0, 0.2, 1) forwards;
      }
      .is-d1 { animation-delay: 0.2s; }
      .is-d2 { animation-delay: 1.1s; }
      .is-d3 { animation-delay: 2.0s; }
      .is-d4 { animation-delay: 2.8s; }
      .is-d5 { animation-delay: 3.5s; }
      .is-d6 { animation-delay: 4.3s; animation-duration: 1.6s; }
      @keyframes isDrawIn { to { stroke-dashoffset: 0; } }

      /* crane slews */
      .is-slew-a { animation: isSlewA 20s ease-in-out infinite; }
      @keyframes isSlewA { 0%,100% { transform: rotate(-1.1deg); } 50% { transform: rotate(1.3deg); } }
      .is-slew-b { animation: isSlewB 29s ease-in-out infinite; }
      @keyframes isSlewB { 0%,100% { transform: rotate(0.8deg); } 50% { transform: rotate(-0.7deg); } }

      /* hanging hook sway */
      .is-hook { animation: isHook 6s ease-in-out infinite; }
      @keyframes isHook { 0%,100% { transform: rotate(-2.2deg); } 50% { transform: rotate(2.2deg); } }

      /* hoist cycle — cable pays in, load rises, beam installs, hook returns */
      .is-hoist-cable { animation: isHoistCable 14s ease-in-out infinite; }
      @keyframes isHoistCable {
        0%, 10%  { transform: scaleY(1); }
        48%, 66% { transform: scaleY(0.55); }
        90%, 100%{ transform: scaleY(1); }
      }
      .is-hoist-load { animation: isHoistLoad 14s ease-in-out infinite; }
      @keyframes isHoistLoad {
        0%, 10%  { transform: translateY(0); }
        48%, 66% { transform: translateY(-252px); }
        90%, 100%{ transform: translateY(0); }
      }
      .is-hoist-beam { animation: isHoistBeam 14s linear infinite; }
      @keyframes isHoistBeam {
        0%, 62%  { opacity: 1; }
        66%, 94% { opacity: 0; }
        98%,100% { opacity: 1; }
      }
      /* weld flash exactly when the beam lands */
      .is-spark-install { opacity: 0; animation: isSparkInstall 14s linear infinite; }
      @keyframes isSparkInstall {
        0%, 60% { opacity: 0; }
        63%     { opacity: 1; }
        65%     { opacity: 0; }
        67%     { opacity: 0.9; }
        69%,100%{ opacity: 0; }
      }

      /* welder's arc — irregular flicker, two alternating bursts */
      .is-spark-a { opacity: 0; animation: isSparkFlick 1.15s linear infinite; }
      .is-spark-b { opacity: 0; animation: isSparkFlick 1.15s linear 0.55s infinite; }
      @keyframes isSparkFlick {
        0%, 30%, 100% { opacity: 0; }
        34%, 42%      { opacity: 1; }
        46%, 58%      { opacity: 0; }
        62%, 66%      { opacity: 0.85; }
        70%           { opacity: 0; }
      }

      /* aviation beacon */
      .is-beacon { animation: isBeacon 2.6s ease-in-out infinite; }
      @keyframes isBeacon { 0%,100% { opacity: 0.15; } 50% { opacity: 0.8; } }

      /* walking figure — legs + arms swing, whole group crosses the yard */
      .is-walker { transform: translate(800px, 818px); animation: isWalk 12s linear infinite; }
      @keyframes isWalk {
        0%   { transform: translate(724px, 818px); opacity: 0; }
        4%   { opacity: 0.95; }
        88%  { transform: translate(902px, 818px); opacity: 0.95; }
        93%  { opacity: 0; }
        100% { transform: translate(902px, 818px); opacity: 0; }
      }
      .is-leg-a { animation: isSwingLeg 0.58s ease-in-out infinite alternate; }
      .is-leg-b { animation: isSwingLeg 0.58s ease-in-out infinite alternate-reverse; }
      @keyframes isSwingLeg { from { transform: rotate(-17deg); } to { transform: rotate(17deg); } }
      .is-arm-a { animation: isSwingArm 0.58s ease-in-out infinite alternate-reverse; }
      .is-arm-b { animation: isSwingArm 0.58s ease-in-out infinite alternate; }
      @keyframes isSwingArm { from { transform: rotate(-11deg); } to { transform: rotate(11deg); } }
      .is-bob { animation: isBob 0.58s ease-in-out infinite alternate; }
      @keyframes isBob { from { transform: translateY(0); } to { transform: translateY(-1.4px); } }

      /* dimension lines re-draw in a slow surveying loop */
      .is-dim { stroke-dasharray: 480; animation: isDimDraw 16s linear infinite; }
      .is-dim-2 { animation-delay: -8s; }
      @keyframes isDimDraw {
        0%   { stroke-dashoffset: 480; opacity: 1; }
        22%  { stroke-dashoffset: 0; }
        78%  { stroke-dashoffset: 0; opacity: 1; }
        88%  { stroke-dashoffset: 0; opacity: 0; }
        89%  { stroke-dashoffset: 480; opacity: 0; }
        100% { stroke-dashoffset: 480; opacity: 1; }
      }

      /* attendance gate: barrier lifts as the worker walks through */
      .is-gate-arm { transform-origin: 110px 150px; animation: isGateArm 12s ease-in-out infinite; }
      @keyframes isGateArm {
        0%, 28%  { transform: rotate(0deg); }
        36%, 54% { transform: rotate(-38deg); }
        64%,100% { transform: rotate(0deg); }
      }
      .is-walker-gate { transform: translate(40px, 236px); animation: isWalkGate 12s linear infinite; }
      @keyframes isWalkGate {
        0%   { transform: translate(28px, 236px); opacity: 0; }
        6%   { opacity: 0.95; }
        86%  { transform: translate(216px, 236px); opacity: 0.95; }
        93%  { opacity: 0; }
        100% { transform: translate(216px, 236px); opacity: 0; }
      }
      .is-clock-min { transform-origin: 110px 58px; animation: isClockMin 60s linear infinite; }
      @keyframes isClockMin { to { transform: rotate(360deg); } }

      /* workfeed: report lines tick in, radio pings broadcast */
      .is-checks { stroke-dasharray: 60; animation: isChecks 7s ease-in-out infinite; }
      @keyframes isChecks {
        0%   { stroke-dashoffset: 60; }
        35%  { stroke-dashoffset: 0; }
        80%  { stroke-dashoffset: 0; opacity: 1; }
        90%  { opacity: 0; }
        91%  { stroke-dashoffset: 60; opacity: 0; }
        100% { stroke-dashoffset: 60; opacity: 1; }
      }
      .is-ping-a { opacity: 0; animation: isPing 3.2s ease-out infinite; }
      .is-ping-b { opacity: 0; animation: isPing 3.2s ease-out 0.5s infinite; }
      @keyframes isPing {
        0%      { opacity: 0; }
        12%     { opacity: 0.9; }
        45%,100%{ opacity: 0; }
      }

      @media (prefers-reduced-motion: reduce) {
        .is-draw, .is-slew-a, .is-slew-b, .is-hook, .is-hoist-cable, .is-hoist-load,
        .is-hoist-beam, .is-spark-install, .is-spark-a, .is-spark-b, .is-beacon,
        .is-walker, .is-leg-a, .is-leg-b, .is-arm-a, .is-arm-b, .is-bob, .is-dim,
        .is-gate-arm, .is-walker-gate, .is-clock-min, .is-checks, .is-ping-a, .is-ping-b {
          animation: none !important;
        }
        .is-draw { stroke-dashoffset: 0; }
        .is-dim, .is-checks { stroke-dashoffset: 0; }
        .is-spark-a, .is-spark-install, .is-ping-a { opacity: 0.6; }
        .is-beacon { opacity: 0.4; }
      }
    `}</style>
  )
}

/* ─────────────────────────── small figure parts ───────────────────────── */

/** Walking figure drawn around local origin (feet at y=0). */
function WalkerFigure() {
  return (
    <g strokeWidth="1.4" {...INK}>
      <g className="is-bob">
        <path d="M-5 -29Q0 -33 5 -29" />
        <circle cx="0" cy="-25" r="3.5" />
        <path d="M0 -21V-10" />
        <g className="is-arm-a" style={{ transformOrigin: '0px -19px' }}>
          <path d="M0 -19L-6 -11" />
        </g>
        <g className="is-arm-b" style={{ transformOrigin: '0px -19px' }}>
          <path d="M0 -19L6 -12" />
          <path d="M4 -12H12V-7H4Z" strokeWidth="1.1" />
        </g>
      </g>
      <g className="is-leg-a" style={{ transformOrigin: '0px -10px' }}>
        <path d="M0 -10L-4 0" />
      </g>
      <g className="is-leg-b" style={{ transformOrigin: '0px -10px' }}>
        <path d="M0 -10L4 0" />
      </g>
    </g>
  )
}

/** Amber arc-welding sparks at a point. */
function Sparks({ x, y }) {
  return (
    <g stroke="#FBBF24" strokeWidth="1" {...INK}>
      <g className="is-spark-a">
        <path d={`M${x} ${y}l6 -4M${x} ${y}l5 4M${x} ${y}l-1 6`} />
        <circle cx={x} cy={y} r="1.2" />
      </g>
      <g className="is-spark-b">
        <path d={`M${x} ${y}l7 0M${x} ${y}l3 -6M${x} ${y}l2 6`} />
      </g>
    </g>
  )
}

/* ──────────────────────── construction panorama ───────────────────────── */

function ConstructionScene() {
  return (
    <svg
      viewBox="0 0 1600 900"
      fill="none"
      preserveAspectRatio="xMidYMax slice"
      className="h-full w-full"
      aria-hidden="true"
    >
      {/* ══ FAR LAYER — distant plant silhouette ══ */}
      <g stroke="currentColor" strokeWidth="0.8" opacity="0.07" {...INK}>
        {/* flare / lattice tower */}
        <path d="M40 820L64 320L88 820M40 820H88M52 700H76M56 600H72M58 500H70M64 320V298" />
        {/* gable sheds + annex */}
        <path d="M696 820V748L756 708L816 748V820M756 708V698M816 764H934V820" />
        {/* pipe rack */}
        <path d="M700 786H948M700 794H948M712 794V820M760 794V820M808 794V820M856 794V820M904 794V820M944 794V820" />
        {/* chimneys with band lines */}
        <path d="M1288 820V468H1306V820M1282 468H1312M1288 540H1306M1288 610H1306M1336 820V524H1350V820M1330 524H1356" />
      </g>

      {/* ══ MID LAYER — structures erect themselves ══ */}
      <g stroke="currentColor" strokeWidth="1" opacity="0.13" {...INK}>
        {/* Building A — skeleton under erection (partial top storey) */}
        <path
          pathLength="1"
          className="is-draw is-d1"
          d="M260 820V420M355 820V420M450 820V420M545 820V520M640 820V520M250 820H270M345 820H365M440 820H460M535 820H555M630 820H650"
        />
        <path
          pathLength="1"
          className="is-draw is-d2"
          d="M260 720H640M260 620H640M260 520H640M260 420H450"
        />
        <path
          pathLength="1"
          className="is-draw is-d3"
          d="M260 820L355 720M355 820L260 720M450 720L545 620M545 720L450 620M355 620L450 520"
        />
        {/* Scaffolding tower + ladder + platforms */}
        <path
          pathLength="1"
          className="is-draw is-d4"
          d="M664 820V480M700 820V480M664 820L700 764M700 820L664 764M664 764L700 708M700 764L664 708M664 708L700 652M700 708L664 652M664 652L700 596M700 652L664 596M664 596L700 540M700 596L664 540M664 540L700 484M700 540L664 484M656 596H708M656 708H708M680 820V760M688 820V760M680 812H688M680 800H688M680 788H688M680 776H688"
        />
        {/* Building B — completed frame */}
        <path
          pathLength="1"
          className="is-draw is-d5"
          d="M950 820V590M1050 820V590M1150 820V590M1250 820V590M950 700H1250M950 590H1250M950 820L1050 700M1050 820L950 700M1150 820L1250 700M1250 820L1150 700"
        />
        {/* roof truss */}
        <path
          pathLength="1"
          className="is-draw is-d6"
          d="M950 560H1250M950 590V560M1250 590V560M950 590L975 560L1000 590L1025 560L1050 590L1075 560L1100 590L1125 560L1150 590L1175 560L1200 590L1225 560L1250 590"
        />
      </g>

      {/* ══ NEAR LAYER ══ */}
      <g stroke="currentColor" strokeWidth="1.2" opacity="0.19" {...INK}>
        {/* ground + hatching */}
        <path d="M40 820H1560" />
        <path
          strokeWidth="0.9"
          d="M70 836l12 -12M170 836l12 -12M270 836l12 -12M370 836l12 -12M470 836l12 -12M570 836l12 -12M670 836l12 -12M770 836l12 -12M870 836l12 -12M970 836l12 -12M1070 836l12 -12M1170 836l12 -12M1270 836l12 -12M1370 836l12 -12M1470 836l12 -12"
        />

        {/* ── Left tower crane ── */}
        <path d="M104 820V240M144 820V240M76 820H172M84 820L104 780M164 820L144 780" />
        <path
          strokeWidth="0.9"
          d="M104 820L144 762M144 820L104 762M104 762L144 704M144 762L104 704M104 704L144 646M144 704L104 646M104 646L144 588M144 646L104 588M104 588L144 530M144 588L104 530M104 530L144 472M144 530L104 472M104 472L144 414M144 472L104 414M104 414L144 356M144 414L104 356M104 356L144 298M144 356L104 298M104 298L144 240M144 298L104 240M104 762H144M104 704H144M104 646H144M104 588H144M104 530H144M104 472H144M104 414H144M104 356H144M104 298H144"
        />
        <g className="is-slew-a" style={{ transformOrigin: '124px 228px' }}>
          <path d="M96 240H152V228H96ZM144 228V204H176V228M112 228L124 168L136 228" />
          <path d="M136 222H520M136 210L520 218" />
          <path
            strokeWidth="0.9"
            d="M136 222L152 211L168 222L184 212L200 222L216 212L232 222L248 213L264 222L280 213L296 222L312 214L328 222L344 214L360 222L376 215L392 222L408 215L424 222L440 216L456 222L472 216L488 222L504 217L520 218"
          />
          <path strokeWidth="0.9" d="M124 172L420 214M124 172L60 218" />
          <path d="M112 222H36M112 215L36 219M36 222V254H68V222" />
          <path strokeWidth="0.8" d="M40 228L64 250M40 240L54 253" />
          <path d="M372 222V230H388V222" />
          <g className="is-hook" style={{ transformOrigin: '380px 226px' }}>
            <path strokeWidth="0.9" d="M380 230V560" />
            <circle cx="380" cy="566" r="5" />
            <path d="M380 571C380 579 371 580 371 587C371 593 378 595 382 590" />
          </g>
        </g>

        {/* ── Right tower crane (slower) with live hoist cycle ── */}
        <path d="M1456 820V200M1496 820V200M1428 820H1524M1436 820L1456 782M1516 820L1496 782" />
        <path
          strokeWidth="0.9"
          d="M1456 820L1496 758M1496 820L1456 758M1456 758L1496 696M1496 758L1456 696M1456 696L1496 634M1496 696L1456 634M1456 634L1496 572M1496 634L1456 572M1456 572L1496 510M1496 572L1456 510M1456 510L1496 448M1496 510L1456 448M1456 448L1496 386M1496 448L1456 386M1456 386L1496 324M1496 386L1456 324M1456 324L1496 262M1496 324L1456 262M1456 262L1496 200M1496 262L1456 200M1456 758H1496M1456 696H1496M1456 634H1496M1456 572H1496M1456 510H1496M1456 448H1496M1456 386H1496M1456 324H1496M1456 262H1496"
        />
        <g className="is-slew-b" style={{ transformOrigin: '1476px 190px' }}>
          <path d="M1448 200H1504V188H1448ZM1448 188V164H1420V188M1464 188L1476 130L1488 188" />
          <path d="M1464 182H1060M1464 170L1060 178" />
          <path
            strokeWidth="0.9"
            d="M1464 182L1448 171L1432 182L1416 172L1400 182L1384 172L1368 182L1352 173L1336 182L1320 173L1304 182L1288 174L1272 182L1256 174L1240 182L1224 175L1208 182L1192 175L1176 182L1160 176L1144 182L1128 176L1112 182L1096 177L1080 182L1060 178"
          />
          <path strokeWidth="0.9" d="M1476 134L1150 174M1476 134L1540 178" />
          <path d="M1488 182H1556M1524 182V214H1552V182" />
          <path strokeWidth="0.8" d="M1528 188L1548 208" />
          <path d="M1092 182V190H1108V182" />
          {/* hoist: cable pays in, hook + slung beam rise to the truss */}
          <path
            className="is-hoist-cable"
            style={{ transformOrigin: '1100px 190px' }}
            strokeWidth="0.9"
            d="M1100 190V750"
          />
          <g className="is-hoist-load">
            <circle cx="1100" cy="756" r="5" />
            <g className="is-hoist-beam">
              <path strokeWidth="0.9" d="M1100 761L1070 794M1100 761L1130 794" />
              <path d="M1064 796H1136M1064 803H1136M1064 796V803M1136 796V803" />
            </g>
          </g>
        </g>
        {/* weld flash where each beam lands on the truss */}
        <g className="is-spark-install" stroke="#FBBF24" strokeWidth="1">
          <path d="M1100 556l7 -4M1100 556l6 5M1100 556l-2 7M1100 556l-7 -3" />
          <circle cx="1100" cy="556" r="1.4" />
        </g>

        {/* ── flatbed trailer with beam stock ── */}
        <path d="M1282 800H1414M1282 800V808M1290 792H1406M1290 786H1406M1414 800V782H1438L1450 800" />
        <circle cx="1306" cy="810" r="8" />
        <circle cx="1326" cy="810" r="8" />
        <circle cx="1392" cy="810" r="8" />

        {/* ── welder at beam on the ground ── */}
        <g strokeWidth="1.1">
          <path d="M586 816H642M586 810H642M586 810V816M642 810V816" />
          <path d="M556 782Q564 776 572 782" />
          <circle cx="564" cy="786" r="4" />
          <path d="M560 790C555 797 553 804 555 812M555 812L566 810M566 810V820M566 820H572M559 795L580 803M580 803L590 807" />
        </g>
        <Sparks x={592} y={808} />

        {/* aviation beacons */}
        <circle className="is-beacon" cx="124" cy="164" r="2.5" fill="#C0272D" stroke="none" />
        <circle className="is-beacon" cx="1476" cy="126" r="2.5" fill="#C0272D" stroke="none" style={{ animationDelay: '1.3s' }} />
      </g>

      {/* ── walking worker crossing the yard ── */}
      <g stroke="currentColor" opacity="0.24" fill="none">
        <g className="is-walker">
          <WalkerFigure />
        </g>
      </g>

      {/* ══ ANNOTATIONS — dimensions, detail box, leader ══ */}
      <g stroke="currentColor" strokeWidth="0.9" opacity="0.17" {...INK}>
        <g className="is-dim">
          <path d="M260 826V858M1250 826V858M260 852H1250M260 852L270 848M260 852L270 856M1250 852L1240 848M1250 852L1240 856" />
        </g>
        <g className="is-dim is-dim-2">
          <path d="M1256 590H1296M1256 820H1296M1290 590V820M1290 590L1286 600M1290 590L1294 600M1290 820L1286 810M1290 820L1294 810" />
        </g>
        {/* leader note on the unfinished bay */}
        <path strokeDasharray="4 4" d="M450 420L410 390" />
        {/* pinned detail drawing, top-left */}
        <rect x="212" y="84" width="180" height="190" strokeDasharray="6 5" />
        <path d="M262 124H342V136H310V212H342V224H262V212H294V136H262Z" />
        <path strokeDasharray="8 4 2 4" strokeWidth="0.7" d="M302 114V234" />
        <path d="M348 124H366M348 224H366M362 124V224M362 124L359 132M362 124L365 132M362 224L359 216M362 224L365 216" />
        {/* hard hat, top-right */}
        <g transform="rotate(-8 1244 120)" strokeWidth="1.1">
          <path d="M1198 142C1198 106 1224 90 1244 90C1264 90 1290 106 1290 142" />
          <path d="M1186 144Q1244 132 1302 144Q1244 156 1186 144Z" />
          <path d="M1236 92V110M1252 92V110M1236 110H1252" />
          <path strokeWidth="0.9" d="M1214 116V126M1274 116V126" />
        </g>
      </g>
      <g fill="currentColor" stroke="none" opacity="0.2" fontFamily={MONO}>
        <text x="755" y="846" fontSize="11" textAnchor="middle" letterSpacing="2">84.000 M — MAIN ERECTION BAY</text>
        <text x="1304" y="705" fontSize="10" letterSpacing="2" transform="rotate(90 1304 705)">EL. +14.500</text>
        <text x="300" y="384" fontSize="9" letterSpacing="2">ERECTION IN PROGRESS</text>
        <text x="224" y="252" fontSize="10" letterSpacing="1.5">DETAIL A — ISMB 400</text>
        <text x="224" y="266" fontSize="8" letterSpacing="1.5">SCALE 1:20</text>
      </g>
    </svg>
  )
}

/* ─────────────────────────── compact variants ─────────────────────────── */

function DashboardScene() {
  return (
    <svg viewBox="0 0 440 260" fill="none" className="h-full w-full" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.1" {...INK}>
        <path d="M16 238H424" />
        <path strokeWidth="0.8" d="M40 250l10 -10M130 250l10 -10M220 250l10 -10M310 250l10 -10M400 250l10 -10" />
        {/* mini crane */}
        <path d="M60 238V70M84 238V70M48 238H96" />
        <path strokeWidth="0.8" d="M60 238L84 196M84 238L60 196M60 196L84 154M84 196L60 154M60 154L84 112M84 154L60 112M60 112L84 70M84 112L60 70M60 196H84M60 154H84M60 112H84" />
        <g className="is-slew-a" style={{ transformOrigin: '72px 62px' }}>
          <path d="M52 70H92V60H52ZM60 60L72 24L84 60" />
          <path d="M84 66H320M84 56L320 62" />
          <path strokeWidth="0.8" d="M84 66L100 57L116 66L132 58L148 66L164 58L180 66L196 59L212 66L228 60L244 66L260 60L276 66L292 61L308 66L320 62" />
          <path strokeWidth="0.8" d="M72 28L260 58M72 28L36 62" />
          <path d="M52 66H24M24 66V88H44V66" />
          <path d="M232 66V72H246V66" />
          <g className="is-hook" style={{ transformOrigin: '239px 70px' }}>
            <path strokeWidth="0.8" d="M239 72V150" />
            <circle cx="239" cy="154" r="3.5" />
            <path d="M239 158C239 163 233 164 233 168C233 172 238 173 240 170" />
          </g>
        </g>
        <circle className="is-beacon" cx="72" cy="20" r="2" fill="#C0272D" stroke="none" />
        {/* building skeleton */}
        <path pathLength="1" className="is-draw is-d1" d="M180 238V140M250 238V140M320 238V140M390 238V170" />
        <path pathLength="1" className="is-draw is-d2" d="M180 190H390M180 140H320M180 238L250 190M250 238L180 190" />
        <path pathLength="1" className="is-draw is-d3" d="M180 128H320M180 140V128M320 140V128M180 140L197 128L215 140L232 128L250 140L267 128L285 140L302 128L320 140" />
      </g>
      <g fill="currentColor" stroke="none" opacity="0.9" fontFamily={MONO}>
        <text x="230" y="256" fontSize="8" letterSpacing="2">PLANT ELEVATION — 01</text>
      </g>
    </svg>
  )
}

function AttendanceScene() {
  return (
    <svg viewBox="0 0 440 260" fill="none" className="h-full w-full" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.1" {...INK}>
        <path d="M16 238H424" />
        <path strokeWidth="0.8" d="M50 250l10 -10M160 250l10 -10M270 250l10 -10M380 250l10 -10" />
        {/* clock post + canopy */}
        <path d="M110 238V84M110 96H214M214 96V110" />
        <circle cx="110" cy="58" r="26" />
        <path strokeWidth="0.9" d="M110 36V42M132 58H126M110 80V74M88 58H94" />
        <path d="M110 58L100 48" />
        <g className="is-clock-min">
          <path d="M110 58V38" />
        </g>
        {/* barrier arm — lifts when a worker passes */}
        <g className="is-gate-arm">
          <path d="M110 150H196" />
          <path strokeWidth="0.8" d="M122 150l8 -6M142 150l8 -6M162 150l8 -6M182 150l8 -6" />
        </g>
        <circle cx="110" cy="150" r="4" />
        {/* IN / OUT board */}
        <path d="M236 238V180M226 180H290V152H226Z" />
      </g>
      <g fill="currentColor" stroke="none" fontFamily={MONO}>
        <text x="238" y="170" fontSize="9" letterSpacing="3">IN·OUT</text>
        <text x="110" y="126" fontSize="8" letterSpacing="2" textAnchor="middle">SHIFT 07:30</text>
      </g>
      {/* worker walking through the gate */}
      <g stroke="currentColor" fill="none">
        <g className="is-walker-gate">
          <WalkerFigure />
        </g>
        {/* worker queued behind, idling */}
        <g transform="translate(56, 236)" strokeWidth="1.4" {...INK}>
          <g className="is-bob">
            <path d="M-5 -29Q0 -33 5 -29" />
            <circle cx="0" cy="-25" r="3.5" />
            <path d="M0 -21V-10M0 -19L-6 -12M0 -19L6 -13" />
          </g>
          <path d="M0 -10L-4 0M0 -10L4 0" />
        </g>
      </g>
    </svg>
  )
}

function WorkfeedScene() {
  return (
    <svg viewBox="0 0 440 260" fill="none" className="h-full w-full" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.1" {...INK}>
        <path d="M16 238H424" />
        <path strokeWidth="0.8" d="M60 250l10 -10M180 250l10 -10M300 250l10 -10M400 250l10 -10" />
        {/* active bay with hook lowering a beam */}
        <path d="M270 238V120M340 238V120M410 238V150M270 170H410M270 120H340M270 238L340 170M340 238L270 170" />
        <g className="is-hook" style={{ transformOrigin: '330px 0px' }}>
          <path strokeWidth="0.9" d="M330 0V84" />
          <circle cx="330" cy="88" r="3.5" />
          <path strokeWidth="0.9" d="M330 92L312 106M330 92L348 106" />
          <path d="M306 108H354M306 113H354M306 108V113M354 108V113" />
        </g>
        {/* supervisor with clipboard */}
        <path d="M123 172Q130 166 137 172" />
        <circle cx="130" cy="176" r="5" />
        <path d="M130 182V212M130 212L122 238M130 212L138 238M130 190L146 198M130 190L118 202" />
        <path d="M144 192H162V218H144Z" />
        {/* report lines tick themselves in */}
        <path className="is-checks" strokeWidth="0.9" d="M148 199H158M148 205H156M148 211H157" />
        {/* radio pings */}
        <path className="is-ping-a" strokeWidth="0.9" d="M142 166a11 11 0 0 1 4 -12" />
        <path className="is-ping-b" strokeWidth="0.9" d="M148 170a17 17 0 0 1 6 -19" />
      </g>
      <g fill="currentColor" stroke="none" fontFamily={MONO}>
        <text x="108" y="256" fontSize="8" letterSpacing="2">SITE REPORT — LIVE</text>
      </g>
    </svg>
  )
}

/* ────────────────────────────── component ─────────────────────────────── */

const VARIANTS = {
  construction: ConstructionScene,
  dashboard: DashboardScene,
  attendance: AttendanceScene,
  workfeed: WorkfeedScene,
}

export default function IndustrialScene({ variant = 'dashboard', className = '' }) {
  const Scene = VARIANTS[variant] ?? DashboardScene
  return (
    <div className={`pointer-events-none select-none ${className}`} aria-hidden="true">
      <Scene />
      <SceneStyle />
    </div>
  )
}
