package com.qualcomm.hardware.lynx;

import com.qualcomm.robotcore.hardware.HardwareDevice;

/**
 * Stand-in for the Control/Expansion Hub object, so the common bulk-caching setup compiles and runs.
 * The simulator always serves the latest readings, so the caching mode has no effect here.
 */
public class LynxModule implements HardwareDevice {
    public enum BulkCachingMode { OFF, MANUAL, AUTO }

    private BulkCachingMode mode = BulkCachingMode.OFF;

    public void setBulkCachingMode(BulkCachingMode mode) { this.mode = mode; }

    public BulkCachingMode getBulkCachingMode() { return mode; }

    public void clearBulkCache() { }

    public boolean isParent() { return true; }

    @Override public Manufacturer getManufacturer() { return Manufacturer.Lynx; }

    @Override public String getDeviceName() { return "Simulated Control Hub"; }

    @Override public String getConnectionInfo() { return "ftc-sim"; }

    @Override public int getVersion() { return 1; }

    @Override public void resetDeviceConfigurationForOpMode() { }

    @Override public void close() { }
}
