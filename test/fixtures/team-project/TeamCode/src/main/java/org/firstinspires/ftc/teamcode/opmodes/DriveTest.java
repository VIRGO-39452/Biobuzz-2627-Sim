package org.firstinspires.ftc.teamcode.opmodes;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import org.firstinspires.ftc.teamcode.Robot;

@TeleOp(name = "Drive Test")
public class DriveTest extends LinearOpMode {
    private Robot robot;

    @Override
    public void runOpMode() {
        robot = new Robot(hardwareMap);
        telemetry.addData("Status", "Ready v1");
        telemetry.update();
        waitForStart();
        while (opModeIsActive()) {
            robot.drive.arcade(-gamepad1.left_stick_y, gamepad1.right_stick_x);
            telemetry.addData("Left ticks", robot.drive.left.getCurrentPosition());
            telemetry.addData("Left velocity", "%.1f", robot.drive.left.getVelocity());
            telemetry.addData("A pressed", gamepad1.a);
            telemetry.update();
        }
    }
}
