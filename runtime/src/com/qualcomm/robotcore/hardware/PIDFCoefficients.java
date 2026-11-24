package com.qualcomm.robotcore.hardware;

public class PIDFCoefficients {
    public double p;
    public double i;
    public double d;
    public double f;

    public PIDFCoefficients() {
    }

    public PIDFCoefficients(double p, double i, double d, double f) {
        this.p = p;
        this.i = i;
        this.d = d;
        this.f = f;
    }

    public PIDFCoefficients(PIDFCoefficients them) {
        this(them.p, them.i, them.d, them.f);
    }

    public PIDFCoefficients(PIDCoefficients them) {
        this(them.p, them.i, them.d, 0);
    }

    @Override
    public String toString() {
        return String.format("PIDFCoefficients(p=%f i=%f d=%f f=%f)", p, i, d, f);
    }
}
