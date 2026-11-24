package com.qualcomm.robotcore.hardware;

public interface AnalogInput extends HardwareDevice {
    double getVoltage();

    double getMaxVoltage();
}
