package ftcsim.runtime;

import com.qualcomm.robotcore.hardware.VoltageSensor;

public class SimVoltageSensor extends SimSensor implements VoltageSensor {
    public SimVoltageSensor(String name) {
        super(name, "voltage", "Simulated Voltage Sensor");
    }

    @Override
    public double getVoltage() {
        return Bridge.batteryVolts();
    }
}
