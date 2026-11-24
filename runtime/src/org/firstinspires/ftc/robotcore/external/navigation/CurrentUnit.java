package org.firstinspires.ftc.robotcore.external.navigation;

public enum CurrentUnit {
    AMPS, MILLIAMPS;

    public double convert(double value, CurrentUnit from) {
        if (from == this) return value;
        return this == AMPS ? value / 1000.0 : value * 1000.0;
    }

    public double toAmps(double value) { return AMPS.convert(value, this); }

    public double toMilliAmps(double value) { return MILLIAMPS.convert(value, this); }
}
