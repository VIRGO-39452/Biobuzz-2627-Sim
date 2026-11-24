package com.qualcomm.robotcore.util;

import java.util.concurrent.TimeUnit;

public class ElapsedTime {
    public enum Resolution { SECONDS, MILLISECONDS }

    public static final long SECOND_IN_NANO = 1000000000L;
    public static final long MILLIS_IN_NANO = 1000000L;

    protected volatile long nsStartTime;
    protected final double resolution;

    public ElapsedTime() {
        reset();
        this.resolution = SECOND_IN_NANO;
    }

    public ElapsedTime(long startTime) {
        this.nsStartTime = startTime;
        this.resolution = SECOND_IN_NANO;
    }

    public ElapsedTime(Resolution resolution) {
        reset();
        this.resolution = resolution == Resolution.MILLISECONDS ? MILLIS_IN_NANO : SECOND_IN_NANO;
    }

    protected long nsNow() {
        return System.nanoTime();
    }

    public long now(TimeUnit unit) {
        return unit.convert(nsNow(), TimeUnit.NANOSECONDS);
    }

    public void reset() {
        nsStartTime = nsNow();
    }

    public double startTime() {
        return nsStartTime / resolution;
    }

    public long startTimeNanoseconds() {
        return nsStartTime;
    }

    public double time() {
        return (nsNow() - nsStartTime) / resolution;
    }

    public long time(TimeUnit unit) {
        return unit.convert(nanoseconds(), TimeUnit.NANOSECONDS);
    }

    public double seconds() {
        return nanoseconds() / (double) SECOND_IN_NANO;
    }

    public double milliseconds() {
        return seconds() * 1000.0;
    }

    public long nanoseconds() {
        return nsNow() - nsStartTime;
    }

    public Resolution getResolution() {
        return resolution == MILLIS_IN_NANO ? Resolution.MILLISECONDS : Resolution.SECONDS;
    }

    @Override
    public String toString() {
        return String.format("%1.4f %s", time(), resolution == MILLIS_IN_NANO ? "milliseconds" : "seconds");
    }
}
