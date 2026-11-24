package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.hardware.HardwareMap;
import org.firstinspires.ftc.teamcode.subsystems.Drive;

public class Robot {
    public final Drive drive;

    public Robot(HardwareMap hardwareMap) {
        drive = new Drive(hardwareMap);
    }
}
