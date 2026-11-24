package ftcsim.runtime;

import com.qualcomm.robotcore.hardware.TouchSensor;

public class SimTouchSensor extends SimSensor implements TouchSensor {
    public SimTouchSensor(String name) {
        super(name, "touch", "Simulated Touch Sensor");
    }

    @Override public double getValue() { return isPressed() ? 1.0 : 0.0; }

    @Override public boolean isPressed() { return value(0, 0) > 0.5; }
}
