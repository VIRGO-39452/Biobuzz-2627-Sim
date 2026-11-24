package org.firstinspires.ftc.robotcore.external.navigation;

public enum DistanceUnit {
    METER(0), CM(1), MM(2), INCH(3);

    public static final double infinity = Double.MAX_VALUE;
    public static final double mmPerInch = 25.4;
    public static final double mPerInch = mmPerInch * 0.001;

    public final byte bVal;

    DistanceUnit(int i) {
        this.bVal = (byte) i;
    }

    private double perMeter() {
        switch (this) {
            case CM: return 100.0;
            case MM: return 1000.0;
            case INCH: return 1.0 / mPerInch;
            default: return 1.0;
        }
    }

    public double fromUnit(DistanceUnit them, double theirs) {
        if (theirs == infinity) return infinity;
        return theirs / them.perMeter() * this.perMeter();
    }

    public double fromMeters(double meters) { return fromUnit(METER, meters); }

    public double fromInches(double inches) { return fromUnit(INCH, inches); }

    public double fromCm(double cm) { return fromUnit(CM, cm); }

    public double fromMm(double mm) { return fromUnit(MM, mm); }

    public double toMeters(double inOurUnits) { return METER.fromUnit(this, inOurUnits); }

    public double toInches(double inOurUnits) { return INCH.fromUnit(this, inOurUnits); }

    public double toCm(double inOurUnits) { return CM.fromUnit(this, inOurUnits); }

    public double toMm(double inOurUnits) { return MM.fromUnit(this, inOurUnits); }

    public String toString(double inOurUnits) {
        switch (this) {
            case CM: return String.format("%.1fcm", inOurUnits);
            case MM: return String.format("%.0fmm", inOurUnits);
            case INCH: return String.format("%.2fin", inOurUnits);
            default: return String.format("%.3fm", inOurUnits);
        }
    }
}
