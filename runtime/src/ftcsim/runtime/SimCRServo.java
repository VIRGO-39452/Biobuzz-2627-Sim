package ftcsim.runtime;

import com.qualcomm.robotcore.hardware.CRServo;

public class SimCRServo implements CRServo {
    private final String name;
    private Direction direction = Direction.FORWARD;
    private double power = 0;

    public SimCRServo(String name) {
        this.name = name;
        publish();
    }

    private void publish() {
        double raw = (direction == Direction.REVERSE ? -1 : 1) * power;
        Bridge.send("{\"t\":\"crservo\",\"name\":" + Bridge.q(name) + ",\"power\":" + Bridge.num(raw)
                + ",\"dir\":\"" + direction.name() + "\"}");
    }

    @Override
    public synchronized void setDirection(Direction direction) {
        if (direction != this.direction) {
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
        if (p != this.power) {
            this.power = p;
            publish();
        }
    }

    @Override
    public synchronized double getPower() {
        return power;
    }

    @Override
    public int getPortNumber() {
        return 0;
    }

    @Override
    public Manufacturer getManufacturer() {
        return Manufacturer.Simulated;
    }

    @Override
    public String getDeviceName() {
        return "Simulated Continuous Rotation Servo";
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
