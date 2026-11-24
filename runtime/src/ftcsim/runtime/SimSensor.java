package ftcsim.runtime;

import com.qualcomm.robotcore.hardware.HardwareDevice;

/** Base for virtual sensors: readings arrive from the simulator and are looked up by name. */
public abstract class SimSensor implements HardwareDevice {
    protected final String name;
    private final String kind;
    private final String label;

    protected SimSensor(String name, String kind, String label) {
        this.name = name;
        this.kind = kind;
        this.label = label;
    }

    public String simKind() { return kind; }

    /** i-th reading, or the fallback until the simulator has sent one. */
    protected double value(int i, double fallback) {
        double[] v = Bridge.sensor(name);
        return v != null && v.length > i ? v[i] : fallback;
    }

    @Override public Manufacturer getManufacturer() { return Manufacturer.Simulated; }

    @Override public String getDeviceName() { return label; }

    @Override public String getConnectionInfo() { return "ftc-sim; name " + name; }

    @Override public int getVersion() { return 1; }

    @Override public void resetDeviceConfigurationForOpMode() { }

    @Override public void close() { }
}
