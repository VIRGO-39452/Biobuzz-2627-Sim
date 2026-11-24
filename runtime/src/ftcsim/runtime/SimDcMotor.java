package ftcsim.runtime;

import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.PIDCoefficients;
import com.qualcomm.robotcore.hardware.PIDFCoefficients;
import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;
import org.firstinspires.ftc.robotcore.external.navigation.CurrentUnit;

/**
 * Virtual DC motor. Commands are forwarded to the simulator, which runs the motor model and the
 * hub-style closed loops (RUN_USING_ENCODER / RUN_TO_POSITION). Readings come back from physics.
 * Direction is applied here, so the simulator only sees "raw" (un-reversed) values.
 */
public class SimDcMotor implements DcMotorEx {
    private final String name;
    private Direction direction = Direction.FORWARD;
    private RunMode mode = RunMode.RUN_WITHOUT_ENCODER;
    private ZeroPowerBehavior zpb = ZeroPowerBehavior.BRAKE;
    private double power = 0;
    private Double velocityTicks = null; // user-frame ticks/s when setVelocity() is the active command
    private int targetPosition = 0;
    private boolean targetSet = false;
    private int tolerance = 5;
    private double encoderOffsetRaw = 0;
    private boolean enabled = true;
    private final double ticksPerRev;
    private PIDFCoefficients velPidf;
    private double posP = 5;

    public SimDcMotor(String name) {
        this.name = name;
        double[] spec = Bridge.motorSpec(name);
        this.ticksPerRev = spec[0];
        // Default velocity gains follow the FTC docs rule of thumb for a motor's max speed
        // (F = 32767 / maxTicksPerSecond, P = 0.1 F, I = 0.1 P) with position P = 5.
        // A real hub uses the gains of the configured motor type, which may differ.
        double f = 32767.0 / spec[1];
        this.velPidf = new PIDFCoefficients(0.1 * f, 0.01 * f, 0, f);
        publish();
    }

    private int sign() {
        return direction == Direction.REVERSE ? -1 : 1;
    }

    private synchronized void publish() {
        StringBuilder sb = new StringBuilder(256);
        sb.append("{\"t\":\"motor\",\"name\":").append(Bridge.q(name));
        sb.append(",\"mode\":\"").append(mode.name()).append('"');
        sb.append(",\"power\":").append(Bridge.num(enabled ? sign() * power : 0));
        sb.append(",\"velTicks\":").append(velocityTicks == null ? "null" : Bridge.num(sign() * velocityTicks));
        sb.append(",\"targetPos\":").append(Bridge.num(sign() * targetPosition + encoderOffsetRaw));
        sb.append(",\"zpb\":\"").append(zpb.name()).append('"');
        sb.append(",\"dir\":\"").append(direction.name()).append('"');
        sb.append(",\"pidf\":[").append(Bridge.num(velPidf.p)).append(',').append(Bridge.num(velPidf.i)).append(',')
                .append(Bridge.num(velPidf.d)).append(',').append(Bridge.num(velPidf.f)).append(']');
        sb.append(",\"posP\":").append(Bridge.num(posP));
        sb.append(",\"userTarget\":").append(targetPosition);
        sb.append('}');
        Bridge.send(sb.toString());
    }

    // ---- DcMotorSimple
    @Override
    public synchronized void setDirection(Direction direction) {
        if (direction != this.direction) {
            // Like the SDK, reversing a motor also flips the sign of its reported position.
            this.direction = direction;
            publish();
        }
    }

    @Override
    public synchronized Direction getDirection() {
        return direction;
    }

    @Override
    public synchronized void setPower(double power) {
        double p = Math.max(-1.0, Math.min(1.0, power));
        if (mode == RunMode.RUN_TO_POSITION) p = Math.abs(p);
        if (p != this.power || velocityTicks != null) {
            this.power = p;
            this.velocityTicks = null;
            publish();
        }
    }

    @Override
    public synchronized double getPower() {
        return power;
    }

    // ---- DcMotor
    @Override
    public int getPortNumber() {
        return 0;
    }

    @Override
    public synchronized void setZeroPowerBehavior(ZeroPowerBehavior zeroPowerBehavior) {
        if (zeroPowerBehavior == ZeroPowerBehavior.UNKNOWN) {
            throw new IllegalArgumentException("zeroPowerBehavior may not be UNKNOWN");
        }
        if (zeroPowerBehavior != zpb) {
            zpb = zeroPowerBehavior;
            publish();
        }
    }

    @Override
    public synchronized ZeroPowerBehavior getZeroPowerBehavior() {
        return zpb;
    }

    @Override
    public synchronized void setPowerFloat() {
        setZeroPowerBehavior(ZeroPowerBehavior.FLOAT);
        setPower(0);
    }

    @Override
    public synchronized boolean getPowerFloat() {
        return zpb == ZeroPowerBehavior.FLOAT && power == 0;
    }

    @Override
    public synchronized void setTargetPosition(int position) {
        if (!targetSet || position != targetPosition) {
            targetPosition = position;
            targetSet = true;
            publish();
        }
    }

    @Override
    public synchronized int getTargetPosition() {
        return targetPosition;
    }

    @Override
    public synchronized boolean isBusy() {
        return mode == RunMode.RUN_TO_POSITION && Math.abs(targetPosition - getCurrentPosition()) > tolerance;
    }

    @Override
    public synchronized int getCurrentPosition() {
        return (int) Math.round(sign() * (Bridge.motor(name)[0] - encoderOffsetRaw));
    }

    @Override
    public synchronized void setMode(RunMode newMode) {
        newMode = newMode.migrate();
        if (newMode == RunMode.RUN_TO_POSITION && !targetSet) {
            throw new IllegalStateException(
                    "Failed to enable motor. You must set a target position before switching to RUN_TO_POSITION mode");
        }
        if (newMode == RunMode.STOP_AND_RESET_ENCODER) {
            encoderOffsetRaw = Bridge.motor(name)[0];
            power = 0;
            velocityTicks = null;
        }
        if (newMode != mode || newMode == RunMode.STOP_AND_RESET_ENCODER) {
            mode = newMode;
            publish();
        }
    }

    @Override
    public synchronized RunMode getMode() {
        return mode;
    }

    // ---- DcMotorEx
    @Override
    public synchronized void setMotorEnable() {
        if (!enabled) {
            enabled = true;
            publish();
        }
    }

    @Override
    public synchronized void setMotorDisable() {
        if (enabled) {
            enabled = false;
            publish();
        }
    }

    @Override
    public synchronized boolean isMotorEnabled() {
        return enabled;
    }

    @Override
    public synchronized void setVelocity(double angularRate) {
        boolean changed = false;
        if (!mode.isPIDMode()) {
            mode = RunMode.RUN_USING_ENCODER;
            changed = true;
        }
        if (velocityTicks == null || velocityTicks != angularRate) {
            velocityTicks = angularRate;
            changed = true;
        }
        if (changed) publish();
    }

    @Override
    public void setVelocity(double angularRate, AngleUnit unit) {
        requireTicksPerRev();
        setVelocity(unit.toDegrees(angularRate) / 360.0 * ticksPerRev);
    }

    @Override
    public double getVelocity() {
        return sign() * Bridge.motor(name)[1];
    }

    @Override
    public double getVelocity(AngleUnit unit) {
        requireTicksPerRev();
        double degPerSec = getVelocity() / ticksPerRev * 360.0;
        return unit == AngleUnit.RADIANS ? Math.toRadians(degPerSec) : degPerSec;
    }

    private void requireTicksPerRev() {
        if (ticksPerRev <= 0) {
            throw new UnsupportedOperationException(
                    "ftc-sim: AngleUnit velocity for motor \"" + name + "\" is not simulated yet; use ticks per second");
        }
    }

    @Override
    public void setPIDCoefficients(RunMode mode, PIDCoefficients c) {
        setPIDFCoefficients(mode, new PIDFCoefficients(c));
    }

    @Override
    public synchronized void setPIDFCoefficients(RunMode mode, PIDFCoefficients c) {
        mode = mode.migrate();
        if (mode == RunMode.RUN_TO_POSITION) {
            posP = c.p;
        } else {
            velPidf = new PIDFCoefficients(c);
        }
        publish();
    }

    @Override
    public synchronized void setVelocityPIDFCoefficients(double p, double i, double d, double f) {
        velPidf = new PIDFCoefficients(p, i, d, f);
        publish();
    }

    @Override
    public synchronized void setPositionPIDFCoefficients(double p) {
        posP = p;
        publish();
    }

    @Override
    public synchronized PIDCoefficients getPIDCoefficients(RunMode mode) {
        PIDFCoefficients c = getPIDFCoefficients(mode);
        return new PIDCoefficients(c.p, c.i, c.d);
    }

    @Override
    public synchronized PIDFCoefficients getPIDFCoefficients(RunMode mode) {
        if (mode.migrate() == RunMode.RUN_TO_POSITION) return new PIDFCoefficients(posP, 0, 0, 0);
        return new PIDFCoefficients(velPidf);
    }

    @Override
    public synchronized void setTargetPositionTolerance(int tolerance) {
        this.tolerance = tolerance;
    }

    @Override
    public synchronized int getTargetPositionTolerance() {
        return tolerance;
    }

    @Override
    public double getCurrent(CurrentUnit unit) {
        return unit.convert(Bridge.motor(name)[2], CurrentUnit.AMPS);
    }

    private double currentAlertAmps = 9.2;

    @Override
    public double getCurrentAlert(CurrentUnit unit) {
        return unit.convert(currentAlertAmps, CurrentUnit.AMPS);
    }

    @Override
    public void setCurrentAlert(double current, CurrentUnit unit) {
        currentAlertAmps = unit.toAmps(current);
    }

    @Override
    public boolean isOverCurrent() {
        return Bridge.motor(name)[2] > currentAlertAmps;
    }

    // ---- HardwareDevice
    @Override
    public Manufacturer getManufacturer() {
        return Manufacturer.Simulated;
    }

    @Override
    public String getDeviceName() {
        return "Simulated DC Motor";
    }

    @Override
    public String getConnectionInfo() {
        return "ftc-sim; name " + name;
    }

    @Override
    public int getVersion() {
        return 1;
    }

    @Override
    public void resetDeviceConfigurationForOpMode() {
    }

    @Override
    public void close() {
        setPower(0);
    }
}
