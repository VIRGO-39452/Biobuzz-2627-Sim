package com.qualcomm.robotcore.eventloop.opmode;

import com.qualcomm.robotcore.hardware.Gamepad;
import com.qualcomm.robotcore.hardware.HardwareMap;
import org.firstinspires.ftc.robotcore.external.Telemetry;

/** Simulator implementation of the FTC SDK iterative OpMode base class. */
public abstract class OpMode {
    public volatile Gamepad gamepad1 = null;
    public volatile Gamepad gamepad2 = null;
    public Telemetry telemetry = null;
    public volatile HardwareMap hardwareMap = null;
    /** Seconds this OpMode has been running; updated before each loop(). */
    public volatile double time = 0.0;

    volatile boolean simStarted = false;
    volatile boolean simStopRequested = false;
    private volatile long startNanos = System.nanoTime();

    public OpMode() {
    }

    public abstract void init();

    public void init_loop() {
    }

    public void start() {
    }

    public abstract void loop();

    public void stop() {
    }

    public final void requestOpModeStop() {
        simStopRequested = true;
    }

    public final void terminateOpModeNow() {
        simStopRequested = true;
        throw new OpModeControl.TerminateSignal();
    }

    public double getRuntime() {
        return (System.nanoTime() - startNanos) / 1.0e9;
    }

    public void resetRuntime() {
        startNanos = System.nanoTime();
    }

    public void updateTelemetry(Telemetry telemetry) {
        telemetry.update();
    }
}
