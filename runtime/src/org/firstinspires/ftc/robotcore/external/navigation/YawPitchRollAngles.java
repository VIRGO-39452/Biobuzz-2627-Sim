package org.firstinspires.ftc.robotcore.external.navigation;

public class YawPitchRollAngles {
    private final AngleUnit angleUnit;
    private final double yaw, pitch, roll;
    private final long acquisitionTime;

    public YawPitchRollAngles(AngleUnit angleUnit, double yaw, double pitch, double roll, long acquisitionTime) {
        this.angleUnit = angleUnit;
        this.yaw = yaw;
        this.pitch = pitch;
        this.roll = roll;
        this.acquisitionTime = acquisitionTime;
    }

    public double getYaw() { return getYaw(AngleUnit.DEGREES); }

    public double getPitch() { return getPitch(AngleUnit.DEGREES); }

    public double getRoll() { return getRoll(AngleUnit.DEGREES); }

    public double getYaw(AngleUnit unit) { return unit.fromUnit(angleUnit, yaw); }

    public double getPitch(AngleUnit unit) { return unit.fromUnit(angleUnit, pitch); }

    public double getRoll(AngleUnit unit) { return unit.fromUnit(angleUnit, roll); }

    public long getAcquisitionTime() { return acquisitionTime; }

    @Override
    public String toString() {
        return String.format("{yaw=%.3f, pitch=%.3f, roll=%.3f}", getYaw(), getPitch(), getRoll());
    }
}
