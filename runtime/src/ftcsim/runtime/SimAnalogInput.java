package ftcsim.runtime;

import com.qualcomm.robotcore.hardware.AnalogInput;

public class SimAnalogInput extends SimSensor implements AnalogInput {
    public SimAnalogInput(String name) {
        super(name, "analog", "Simulated Analog Input");
    }

    @Override public double getVoltage() { return value(0, 0); }

    @Override public double getMaxVoltage() { return 3.3; }
}
