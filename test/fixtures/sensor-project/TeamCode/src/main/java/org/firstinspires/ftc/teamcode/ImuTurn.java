package org.firstinspires.ftc.teamcode;

import com.qualcomm.hardware.lynx.LynxModule;
import com.qualcomm.hardware.rev.RevHubOrientationOnRobot;
import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.IMU;
import com.qualcomm.robotcore.hardware.VoltageSensor;
import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;

@Autonomous(name = "IMU Turn 90")
public class ImuTurn extends LinearOpMode {
    @Override
    public void runOpMode() {
        for (LynxModule hub : hardwareMap.getAll(LynxModule.class)) {
            hub.setBulkCachingMode(LynxModule.BulkCachingMode.AUTO);
        }
        DcMotor left = hardwareMap.get(DcMotor.class, "left_drive");
        DcMotor right = hardwareMap.get(DcMotor.class, "right_drive");
        right.setDirection(DcMotor.Direction.REVERSE);
        IMU imu = hardwareMap.get(IMU.class, "imu");
        imu.initialize(new IMU.Parameters(new RevHubOrientationOnRobot(
                RevHubOrientationOnRobot.LogoFacingDirection.UP, RevHubOrientationOnRobot.UsbFacingDirection.FORWARD)));
        VoltageSensor battery = hardwareMap.voltageSensor.iterator().next();
        telemetry.addData("Battery", "%.1f", battery.getVoltage());
        telemetry.update();
        waitForStart();
        imu.resetYaw();
        double yaw = 0;
        while (opModeIsActive() && (yaw = imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.DEGREES)) < 85) {
            double power = Math.max(0.08, 0.004 * (90 - yaw)); // slow down near the target
            left.setPower(-power);
            right.setPower(power); // counter-clockwise = positive yaw
            telemetry.addData("Yaw", "%.1f", yaw);
            telemetry.addData("Rate", "%.0f", imu.getRobotAngularVelocity(AngleUnit.DEGREES).zRotationRate);
            telemetry.update();
        }
        left.setPower(0);
        right.setPower(0);
        sleep(500);
        telemetry.addData("Final yaw", "%.1f", imu.getRobotYawPitchRollAngles().getYaw(AngleUnit.DEGREES));
        telemetry.update();
        sleep(300);
    }
}
