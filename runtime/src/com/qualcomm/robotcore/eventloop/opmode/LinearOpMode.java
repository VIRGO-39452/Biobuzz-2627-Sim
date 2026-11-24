package com.qualcomm.robotcore.eventloop.opmode;

import ftcsim.runtime.Bridge;

/** Simulator implementation of the FTC SDK LinearOpMode base class. */
public abstract class LinearOpMode extends OpMode {

    public LinearOpMode() {
    }

    public abstract void runOpMode() throws InterruptedException;

    public void waitForStart() {
        while (!isStarted() && !isStopRequested()) {
            Bridge.syncInputs();
            try {
                Thread.sleep(2);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
        }
        Bridge.syncInputs();
    }

    public final void idle() {
        Bridge.syncInputs();
        // The real SDK yields here; a 1 ms pause keeps tight loops near real Control Hub loop rates.
        try {
            Thread.sleep(1);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    public final void sleep(long milliseconds) {
        try {
            Thread.sleep(milliseconds);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        Bridge.syncInputs();
    }

    public final boolean opModeIsActive() {
        boolean active = !isStopRequested() && isStarted();
        if (active) {
            idle();
        }
        return active;
    }

    public final boolean opModeInInit() {
        return !isStarted() && !isStopRequested();
    }

    public final boolean isStarted() {
        return simStarted;
    }

    public final boolean isStopRequested() {
        return simStopRequested || Thread.currentThread().isInterrupted();
    }

    @Override
    public final void init() {
    }

    @Override
    public final void init_loop() {
    }

    @Override
    public final void start() {
    }

    @Override
    public final void loop() {
    }

    @Override
    public final void stop() {
    }
}
