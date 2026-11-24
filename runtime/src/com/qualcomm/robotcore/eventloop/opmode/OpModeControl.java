package com.qualcomm.robotcore.eventloop.opmode;

/** Simulator-internal lifecycle hooks. Not part of the FTC SDK API. */
public final class OpModeControl {
    private OpModeControl() {
    }

    public static final class TerminateSignal extends RuntimeException {
        public TerminateSignal() {
            super("terminateOpModeNow()");
        }
    }

    public static void start(OpMode op) {
        op.simStarted = true;
    }

    public static void requestStop(OpMode op) {
        op.simStopRequested = true;
    }

    public static boolean isStarted(OpMode op) {
        return op.simStarted;
    }

    public static boolean isStopRequested(OpMode op) {
        return op.simStopRequested;
    }
}
