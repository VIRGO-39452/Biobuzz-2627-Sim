package ftcsim.runtime;

import com.qualcomm.robotcore.hardware.Servo;

public class SimServo implements Servo {
    private final String name;
    private Direction direction = Direction.FORWARD;
    private double position = Double.NaN;
    private double min = 0, max = 1;

    public SimServo(String name) {
        this.name = name;
    }

    @Override
    public int getPortNumber() {
        return 0;
    }

    @Override
    public synchronized void setDirection(Direction direction) {
        this.direction = direction;
    }

    @Override
    public synchronized Direction getDirection() {
        return direction;
    }

    @Override
    public synchronized void setPosition(double position) {
        double p = Math.max(0.0, Math.min(1.0, position));
        if (p == this.position) return;
        this.position = p;
        double scaled = min + p * (max - min);
        double raw = direction == Direction.REVERSE ? 1.0 - scaled : scaled;
        Bridge.send("{\"t\":\"servo\",\"name\":" + Bridge.q(name) + ",\"pos\":" + Bridge.num(raw) + "}");
    }

    @Override
    public synchronized double getPosition() {
        return position;
    }

    @Override
    public synchronized void scaleRange(double min, double max) {
        if (min < 0 || max > 1 || min >= max) throw new IllegalArgumentException("invalid servo range");
        this.min = min;
        this.max = max;
    }

    @Override
    public Manufacturer getManufacturer() {
        return Manufacturer.Simulated;
    }

    @Override
    public String getDeviceName() {
        return "Simulated Servo";
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
    }
}
