package ftcsim.runtime;

import com.qualcomm.robotcore.hardware.DigitalChannel;

public class SimDigitalChannel extends SimSensor implements DigitalChannel {
    private Mode mode = Mode.INPUT;
    private boolean output = false;

    public SimDigitalChannel(String name) {
        super(name, "digital", "Simulated Digital Channel");
    }

    @Override public Mode getMode() { return mode; }

    @Override public void setMode(Mode mode) { this.mode = mode; }

    @Override public boolean getState() { return mode == Mode.OUTPUT ? output : value(0, 1) > 0.5; }

    @Override
    public void setState(boolean state) {
        output = state;
        Bridge.send("{\"t\":\"digital\",\"name\":" + Bridge.q(name) + ",\"state\":" + state + "}");
    }
}
