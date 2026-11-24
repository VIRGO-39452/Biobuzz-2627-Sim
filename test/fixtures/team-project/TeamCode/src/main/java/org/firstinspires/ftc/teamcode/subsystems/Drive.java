package org.firstinspires.ftc.teamcode.subsystems;

import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DcMotorEx;
import com.qualcomm.robotcore.hardware.HardwareMap;
import com.qualcomm.robotcore.util.Range;

public class Drive {
    public static final double TICKS_PER_MM = 537.7 / (96 * Math.PI);
    public final DcMotorEx left;
    public final DcMotor right;

    public Drive(HardwareMap hardwareMap) {
        left = hardwareMap.get(DcMotorEx.class, "left_drive");
        right = hardwareMap.dcMotor.get("right_drive");
        left.setDirection(DcMotor.Direction.FORWARD);
        right.setDirection(DcMotor.Direction.REVERSE);
    }

    public void arcade(double forward, double rotate) {
        left.setPower(Range.clip(forward + rotate, -1, 1));
        right.setPower(Range.clip(forward - rotate, -1, 1));
    }

    public void driveToMm(double mm, double power) {
        left.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);
        right.setMode(DcMotor.RunMode.STOP_AND_RESET_ENCODER);
        left.setTargetPosition((int) (mm * TICKS_PER_MM));
        right.setTargetPosition((int) (mm * TICKS_PER_MM));
        left.setMode(DcMotor.RunMode.RUN_TO_POSITION);
        right.setMode(DcMotor.RunMode.RUN_TO_POSITION);
        left.setPower(power);
        right.setPower(power);
    }

    public boolean busy() {
        return left.isBusy() || right.isBusy();
    }
}
