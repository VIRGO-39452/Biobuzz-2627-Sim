package org.firstinspires.ftc.robotcore.external.navigation;

public enum AngleUnit {
    DEGREES, RADIANS;

    protected static final double TwoPi = 2 * Math.PI;

    public double fromDegrees(double degrees) {
        return this == RADIANS ? normalize(degrees / 180.0 * Math.PI) : normalize(degrees);
    }

    public double fromRadians(double radians) {
        return this == RADIANS ? normalize(radians) : normalize(radians / Math.PI * 180.0);
    }

    public double fromUnit(AngleUnit them, double theirs) {
        return them == RADIANS ? fromRadians(theirs) : fromDegrees(theirs);
    }

    public double toDegrees(double inOurUnits) {
        return this == RADIANS ? DEGREES.fromRadians(inOurUnits) : DEGREES.fromDegrees(inOurUnits);
    }

    public double toRadians(double inOurUnits) {
        return this == RADIANS ? RADIANS.fromRadians(inOurUnits) : RADIANS.fromDegrees(inOurUnits);
    }

    public double normalize(double mine) {
        return this == RADIANS ? normalizeRadians(mine) : normalizeDegrees(mine);
    }

    public static double normalizeDegrees(double degrees) {
        while (degrees >= 180.0) degrees -= 360.0;
        while (degrees < -180.0) degrees += 360.0;
        return degrees;
    }

    public static double normalizeRadians(double radians) {
        while (radians >= Math.PI) radians -= TwoPi;
        while (radians < -Math.PI) radians += TwoPi;
        return radians;
    }
}
