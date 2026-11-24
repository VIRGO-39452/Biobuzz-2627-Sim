package ftcsim.runtime;

import com.qualcomm.robotcore.hardware.ColorRangeSensor;
import com.qualcomm.robotcore.hardware.DistanceSensor;
import com.qualcomm.robotcore.hardware.NormalizedRGBA;
import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;

/** Readings: red, green, blue, alpha as 0..1, then distance in metres (negative = nothing in range). */
public class SimColorSensor extends SimSensor implements ColorRangeSensor {
    private float gain = 1f;

    public SimColorSensor(String name) {
        super(name, "color", "Simulated Color Sensor");
    }

    private int scaled(int i) { return (int) Math.round(Math.max(0, Math.min(1, value(i, 0) * gain)) * 255); }

    @Override public int red() { return scaled(0); }

    @Override public int green() { return scaled(1); }

    @Override public int blue() { return scaled(2); }

    @Override public int alpha() { return scaled(3); }

    @Override public int argb() { return (alpha() << 24) | (red() << 16) | (green() << 8) | blue(); }

    @Override public void enableLed(boolean enable) { }

    @Override
    public NormalizedRGBA getNormalizedColors() {
        NormalizedRGBA c = new NormalizedRGBA();
        c.red = (float) Math.min(1, value(0, 0) * gain);
        c.green = (float) Math.min(1, value(1, 0) * gain);
        c.blue = (float) Math.min(1, value(2, 0) * gain);
        c.alpha = (float) Math.min(1, value(3, 0) * gain);
        return c;
    }

    @Override public float getGain() { return gain; }

    @Override public void setGain(float newGain) { gain = newGain; }

    @Override
    public double getDistance(DistanceUnit unit) {
        double m = value(4, -1);
        return m < 0 ? DistanceSensor.distanceOutOfRange : unit.fromMeters(m);
    }
}
