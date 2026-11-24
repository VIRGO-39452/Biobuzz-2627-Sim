package com.qualcomm.robotcore.hardware;

public class NormalizedRGBA {
    public float red, green, blue, alpha;

    public int toColor() {
        return ((int) (alpha * 255) << 24) | ((int) (red * 255) << 16) | ((int) (green * 255) << 8) | (int) (blue * 255);
    }
}
