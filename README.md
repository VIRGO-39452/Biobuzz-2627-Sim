# FTC BIOBUZZ StarterBot simulator — proof of concept

Runs a team's real FTC Java OpModes on a desktop JVM against simulated hardware.

## Run

```bash
npm run app      # desktop app (Electron): builds the Java runtime and dashboard, then opens the window
npm run build    # build the Java runtime and the dashboard only
npm start        # no Electron: serve the dashboard at http://localhost:5317 (after npm run build)
npm test         # rebuild the Java runtime and run the automated suite
npm run typecheck
```

Requires Node 20+ and a JDK 17 in `./jdk` (or `FTCSIM_JAVA_HOME`). Everything runs on this machine; the
server listens on 127.0.0.1 only.

## Installer (macOS, Apple Silicon)

```bash
npm run dist
```

This writes `dist/FTC BIOBUZZ Simulator-<version>-arm64.dmg` (and a `.zip`). The app is self-contained: it
carries its own trimmed Java runtime (`javac` and `java`, built by `npm run jre`), the converted robot and
field models, the physics data and goBILDA's example code, so a teammate needs nothing else installed.
Their projects are stored in `~/Library/Application Support/FTC BIOBUZZ Simulator`.

The app is ad-hoc signed, not notarized by Apple. On another Mac, the first launch needs right-click >
Open (or System Settings > Privacy & Security > Open Anyway). Proper signing needs an Apple Developer ID.

`"<app>/Contents/MacOS/FTC BIOBUZZ Simulator" --smoke-run` starts the app hidden, loads the example,
compiles it, runs an OpMode, prints a report and quits. Windows and Linux installers are not set up.

## The app

- **Projects.** Each upload (ZIP, drag and drop, or a folder picked in the desktop app) is saved as its own
  project and reopened on the next start. Switch or remove projects from the top bar. The desktop app keeps
  them in its user-data folder; `npm start` keeps them in `./workspaces`.
- **Explorer.** File tree plus search across files, classes, methods and hardware names. The Dependencies
  tab shows each OpMode and the project classes it reaches.
- **Editor.** Monaco with Java highlighting. Save & recompile (Ctrl/Cmd+S) writes into the saved project and
  shows `javac` errors as markers and under Problems.
- **Hardware mapping.** A name the robot model does not know can be assigned to one of its devices from
  the Hardware panel; the mapping is stored with the project and applies at the next INIT.
- **Gamepads.** Two virtual gamepads. Keys are remappable under Controls (saved on this computer); the
  first two standard-layout USB or Bluetooth controllers drive gamepad 1 and 2.

Source: `ui/` (React, TypeScript, Vite, Monaco, Three.js), `electron/` (desktop shell), `server/` (simulator).

## Controllers

Plug in one or two USB or Bluetooth controllers and press a button on each. A setup dialog opens: press a
button on the controller for gamepad 1, then on the one for gamepad 2 (or skip), then check sticks and
buttons on the test screen. The choice is remembered per controller model on this computer. Start + A and
Start + B reassign a controller at any time, as on a real Driver Station. The Controllers button in the
Gamepads panel reopens the dialog; Keys edits the keyboard mapping, which keeps working alongside.
Controllers the browser reports with a standard layout (Xbox, PlayStation, Logitech F310 in X mode) map
directly; others are used as-is and flagged, and their buttons may not line up.

## Official CAD

```bash
npm run cad      # STEP -> GLB (about 90 s) and regenerate robots/biobuzz-assembly.json
```

Needs the Python environment in `.venv-cad` (`python3 -m venv .venv-cad && .venv-cad/bin/pip install cadquery-ocp`)
and the official STEP file at `research/cad/3200-2627-0003.step`. The GLB keeps all 167 top-level parts
by goBILDA SKU. `robots/biobuzz-assembly.json` assigns parts to moving components (pivot, axis, hardware,
ratio, collision shape) and is plain JSON you can edit; note that `npm run cad` regenerates it.

## Physics

`server/sim.mjs` runs a Rapier rigid body for the chassis at 1 kHz. Each of the six wheels is a ray
from its CAD axle position to the floor with a spring-damper tire; traction is limited by the load on
that wheel, Hogback wheels grip sideways and the front omni wheels do not. Walls and floor are solid
colliders; the chassis collides as two boxes taken from the CAD bounding boxes.

## Gear trains

Every rotating group of parts is its own simulated shaft (`server/shafts.mjs`, described under
`drivetrain` in `robots/biobuzz-assembly.json`): 17 shafts, each with its own angle, speed and inertia.

- Each drive side: motor rotor -> 19.2:1 gearbox -> output shaft with 30T pinion -> 30T gear on the rear
  axle -> chain on two 10T sprockets -> middle axle. The CAD has no sprocket or chain to the front axle,
  so the front omni wheels roll freely and are turned only by the floor.
- Intake: motor rotor -> 50.9:1 gearbox -> 100T gear -> 20T gear on the Gecko shaft (seven wheels, one body).
- Launcher: flywheel clamped to the 1:1 motor shaft, one body.
- Windmill and the two corner wheels: each on its servo's output spline. Servos have a stall torque,
  so a jammed windmill slows or stops instead of forcing a ball through.

A mesh is a stiff spring across its play (tooth backlash, gearbox lash, chain slack): inside the play
the shafts turn independently, at either end the teeth bear on each other. The trains are advanced
with an implicit solve each 1 ms step, so they are stable at any stiffness. Motors act on their rotor
and the encoder counts rotor turns, so the wheels can lag the encoder by the play, as on a real robot.
Each wheel's grip reacts on its own axle.

Tooth counts and shaft positions are from the CAD (centre distances are checked against MOD 0.8 teeth).
Inertias are integrated from the CAD solids with assumed densities. Backlash, chain slack, mesh
stiffness, efficiency, bearing friction, rotor inertia and servo stall torque are estimates. The gears
inside the gearboxes and servos are not in the CAD; each is simulated as a single stage. The chain
loops are drawn static. `node scripts/drive-probe.mjs` prints the shaft speeds through a few manoeuvres;
`node scripts/bench.mjs` reports simulation speed.

`npm run cad:mass` re-estimates mass, centre of mass and inertia from CAD part volumes and assumed
densities (about 2 minutes). `node scripts/sim-probe.mjs` prints a few standard manoeuvres.

## Field and game elements

`fields/biobuzz.json` holds the season: field size, POLLEN and NECTAR specifications, zones, staging and
the structures that are not simulated yet. Every value names its source (competition manual TU10 section,
or "estimate"/"inferred"). Elements are Rapier rigid bodies; the dashboard can stage the official match
setup, place or remove elements by clicking the field, and reset them. Another season is another file
in `fields/`.

## HIVE, FLOWERS and the official field

`npm run cad:field` converts FIRST's official field CAD (`research/field/field-cad-step.step`, from the
Playing Field Resources page) and writes `assets/field/field-collision.json`: the HIVE frame and four
FLOWERS as static surfaces, both HIVES as hinged bodies (pivot from the CAD, mass and balance estimated
from part volumes), perimeter dimensions, and the staged position of all 40 POLLEN and 16 NECTAR.
The 3D view shows the same CAD. `node scripts/field-probe.mjs tip|flower|shoot|wallshot` exercises it.

Each HIVE is top-heavy on its pivot, so it rests on one of two stops and tips when enough weight lands
in the raised CELL. FLOWERS hold a stack of four POLLEN that drops as the bottom one is taken.

## Launcher behaviour and calibration

Nothing about the launcher is tuned to an outcome. The values that set shot speed and direction are either
CAD-derived (ramp surface, flywheel position and radius, flywheel inertia from `cadtools/flywheel-inertia.mjs`)
or labelled estimates (flywheel grip, ball squash stiffness and damping, edge rounding, no bounce inside the robot).

- `node scripts/shot-spread.mjs [ticks/s] [shots]` reports shot-to-shot spread of exit speed, angle and landing distance.
- `node scripts/shot-map.mjs [ticks/s]` maps which robot positions land a shot in the red HIVE's raised CELL.
- `node scripts/calibrate-launcher.mjs [grip values]` sweeps flywheel grip against exit speed and scoring.

At the example code's 1250 ticks/s the simulated ball leaves at about 5.3 m/s. Roughly half the shots from
4 to 12 cm off the audience wall land in the CELL; single shots near the CELL lip are sensitive to millimetres.
To calibrate against the real robot, measure where shots land on open floor at 1250 ticks/s, compare with
`shot-spread`, and adjust the launcher's `friction` and `stiffnessNPerM` under `mechanisms` in the assembly generator.

## Mechanisms

Game elements touch the robot through shapes built from the CAD (`npm run cad` writes
`assets/biobuzz/collision.json`): boxes for channels, motors and flat plates, and smooth skins resampled
from the bent gridplates. Powered parts are listed under `mechanisms` in `robots/biobuzz-assembly.json`
and act on a ball as compliant contacts: a spring along the contact normal plus friction that drags the
ball toward the part's surface speed, with the reaction loading the motor that drives it.

- Intake: seven Gecko wheels on a floating arm (a passive hinge, per assembly steps 34-36) roll a ball
  against the fixed silicone bar; the spinning ball climbs the bar into the hopper.
- Windmill: four blades sweep balls on the hopper floor rearward onto the curved ramp. The blades only
  reach the right-hand two thirds of the hopper; goBILDA's TeleOp runs the intake while feeding, which
  pushes the remaining balls into reach.
- Launcher: the flywheel squeezes the ball against the ramp and throws it up and out over the back.

Positions and radii are CAD values. Contact stiffness, friction, arm limits and ball properties are
estimates. `node scripts/mech-probe.mjs intake|launch|cycle` traces a ball through each stage, and the
Shapes button in the 3D view overlays what the physics uses.

## Layout

| Path | What it is |
|---|---|
| `runtime/src` | FTC SDK-compatible Java library (real package names) plus the OpMode runner |
| `server/session.mjs` | Project upload, javac compile, sandboxed JVM, INIT/PLAY/STOP |
| `server/sim.mjs` | Physics: DC motor model, hub-style control loops, battery, Rapier chassis with six tire contacts |
| `server/analyzer.mjs` | File catalog and source-level OpMode / hardware detection |
| `robots/biobuzz-starterbot.json` | Editable robot model; every estimated value is labelled |
| `robots/biobuzz-assembly.json` | CAD component hierarchy: which parts move, about what, driven by which device |
| `cadtools/` | STEP to GLB converter and assembly generator |
| `fields/biobuzz.json` | Season field, game element specifications and staging |
| `ui/src` | React dashboard: panels (`App.tsx`), Monaco editor, 3D viewport (`viewer3d.js`), gamepads |
| `electron/` | Desktop shell: starts the server in-process, native folder picker |
| `test/` | End-to-end and physics tests |
| `research/` | Official goBILDA CAD, example code and assembly manual |

## What is real and what is not (PoC)

Real: uploaded `.java` files are compiled unmodified by `javac` and executed as bytecode in a
separate JVM; motor commands, encoder readings, gamepad values and telemetry flow between that JVM
and the physics model.

Not yet: Kotlin, vision (AprilTags, cameras), odometry pods and the goBILDA Pinpoint, the older BNO055IMU class, third-party libraries.

SDK classes implemented so far: OpMode, LinearOpMode, TeleOp, Autonomous, Disabled, HardwareMap,
DcMotor, DcMotorEx, DcMotorSimple, CRServo, Servo, Gamepad, PIDFCoefficients, PIDCoefficients,
Telemetry, ElapsedTime, Range, AngleUnit, DistanceUnit, CurrentUnit; IMU (with RevHubOrientationOnRobot,
YawPitchRollAngles, AngularVelocity, Quaternion), VoltageSensor, DistanceSensor, Rev2mDistanceSensor,
TouchSensor, RevTouchSensor, ColorSensor, NormalizedColorSensor, ColorRangeSensor, RevColorSensorV3,
DigitalChannel, AnalogInput, and LynxModule bulk-caching calls (accepted, no effect). Anything else is a
compile error that names the missing class.

## Sensors

- **IMU and battery voltage** are on the robot model (`imu`, `Control Hub`) and read the simulated chassis and
  battery. The IMU is ideal: no drift, no noise. `resetYaw()` persists across OpModes until the simulator is reset.
  The hub's mounting setting is accepted but not checked, because the hub is not in the CAD.
- **Distance and colour sensors** read the simulated world when given a mount in `robots/biobuzz-starterbot.json`
  (see `sensorMounts_note` there): distance is a ray against walls, field structures and game elements; colour
  reports the nearest game element within range.
- **Any sensor not on the robot model** is flagged in the Hardware panel, reads a fixed default (nothing in range,
  not pressed, digital high, 0 V), and can be set by hand there while an OpMode runs.
