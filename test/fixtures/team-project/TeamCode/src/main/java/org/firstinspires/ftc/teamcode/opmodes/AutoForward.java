package org.firstinspires.ftc.teamcode.opmodes;

import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import org.firstinspires.ftc.teamcode.Robot;

@Autonomous(name = "Auto Forward 300", group = "Test")
public class AutoForward extends LinearOpMode {
    @Override
    public void runOpMode() {
        Robot robot = new Robot(hardwareMap);
        waitForStart();
        robot.drive.driveToMm(300, 0.5);
        while (opModeIsActive() && robot.drive.busy()) {
            telemetry.addData("pos", robot.drive.left.getCurrentPosition());
            telemetry.update();
        }
        sleep(400);
        telemetry.addData("done", robot.drive.left.getCurrentPosition());
        telemetry.update();
        System.out.println("auto finished");
    }
}
