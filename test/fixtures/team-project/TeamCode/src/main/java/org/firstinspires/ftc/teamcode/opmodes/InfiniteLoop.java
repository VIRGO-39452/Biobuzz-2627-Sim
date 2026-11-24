package org.firstinspires.ftc.teamcode.opmodes;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;

@TeleOp(name = "Infinite Loop")
public class InfiniteLoop extends LinearOpMode {
    @Override
    public void runOpMode() {
        DcMotor left = hardwareMap.get(DcMotor.class, "left_drive");
        waitForStart();
        left.setPower(1);
        long n = 0;
        while (true) { n++; } // never checks opModeIsActive(), ignores interrupts
    }
}
