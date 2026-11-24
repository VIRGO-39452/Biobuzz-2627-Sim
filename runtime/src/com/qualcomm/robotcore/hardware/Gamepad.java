package com.qualcomm.robotcore.hardware;

/**
 * Simulator implementation of the FTC SDK Gamepad. Fields are refreshed from the simulator's
 * current input between loop iterations (and inside waitForStart/idle/sleep/opModeIsActive).
 * Not yet simulated: rumble, LED, touchpad fingers, and the *WasPressed() edge helpers.
 */
public class Gamepad {
    public volatile float left_stick_x = 0f;
    public volatile float left_stick_y = 0f;
    public volatile float right_stick_x = 0f;
    public volatile float right_stick_y = 0f;
    public volatile float left_trigger = 0f;
    public volatile float right_trigger = 0f;

    public volatile boolean a, b, x, y;
    public volatile boolean dpad_up, dpad_down, dpad_left, dpad_right;
    public volatile boolean left_bumper, right_bumper;
    public volatile boolean left_stick_button, right_stick_button;
    public volatile boolean back, start, guide;

    // PlayStation aliases
    public volatile boolean cross, circle, square, triangle, share, options, ps;
    public volatile boolean touchpad = false;

    public volatile int id = -1;

    public Gamepad() {
    }

    /** Simulator-internal: apply one input snapshot. */
    public void simApply(float[] axes, int buttons) {
        left_stick_x = axes[0];
        left_stick_y = axes[1];
        right_stick_x = axes[2];
        right_stick_y = axes[3];
        left_trigger = axes[4];
        right_trigger = axes[5];
        a = cross = (buttons & 1) != 0;
        b = circle = (buttons & 2) != 0;
        x = square = (buttons & 4) != 0;
        y = triangle = (buttons & 8) != 0;
        dpad_up = (buttons & 16) != 0;
        dpad_down = (buttons & 32) != 0;
        dpad_left = (buttons & 64) != 0;
        dpad_right = (buttons & 128) != 0;
        left_bumper = (buttons & 256) != 0;
        right_bumper = (buttons & 512) != 0;
        left_stick_button = (buttons & 1024) != 0;
        right_stick_button = (buttons & 2048) != 0;
        back = share = (buttons & 4096) != 0;
        start = options = (buttons & 8192) != 0;
        guide = ps = (buttons & 16384) != 0;
    }

    public boolean atRest() {
        return left_stick_x == 0f && left_stick_y == 0f && right_stick_x == 0f && right_stick_y == 0f
                && left_trigger == 0f && right_trigger == 0f;
    }

    @Override
    public String toString() {
        return String.format("ID: %2d lx: % 1.2f ly: % 1.2f rx: % 1.2f ry: % 1.2f lt: %1.2f rt: %1.2f",
                id, left_stick_x, left_stick_y, right_stick_x, right_stick_y, left_trigger, right_trigger);
    }
}
