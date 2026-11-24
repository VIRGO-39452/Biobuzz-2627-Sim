package com.qualcomm.hardware.rev;

import com.qualcomm.robotcore.hardware.ImuOrientationOnRobot;

/**
 * How the Control Hub is mounted. The simulator reports yaw, pitch and roll of the robot directly,
 * which is what a correctly configured hub reports; a wrong mounting setting cannot be detected here.
 */
public class RevHubOrientationOnRobot implements ImuOrientationOnRobot {
    public enum LogoFacingDirection { UP, DOWN, FORWARD, BACKWARD, LEFT, RIGHT }

    public enum UsbFacingDirection { UP, DOWN, FORWARD, BACKWARD, LEFT, RIGHT }

    public final LogoFacingDirection logoFacingDirection;
    public final UsbFacingDirection usbFacingDirection;

    public RevHubOrientationOnRobot(LogoFacingDirection logoFacingDirection, UsbFacingDirection usbFacingDirection) {
        if (logoFacingDirection.name().equals(usbFacingDirection.name())
                || opposite(logoFacingDirection.name()).equals(usbFacingDirection.name())) {
            throw new IllegalArgumentException("The specified combination of logo and USB directions is physically impossible");
        }
        this.logoFacingDirection = logoFacingDirection;
        this.usbFacingDirection = usbFacingDirection;
    }

    private static String opposite(String d) {
        switch (d) {
            case "UP": return "DOWN";
            case "DOWN": return "UP";
            case "FORWARD": return "BACKWARD";
            case "BACKWARD": return "FORWARD";
            case "LEFT": return "RIGHT";
            default: return "LEFT";
        }
    }
}
