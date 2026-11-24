package org.firstinspires.ftc.teamcode.opmodes;

import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.DcMotor;

@TeleOp(name = "Crasher")
public class Crasher extends OpMode {
    DcMotor mystery;
    DcMotor never;

    public void init() {
        mystery = hardwareMap.get(DcMotor.class, "mystery_motor");
    }

    public void loop() {
        never.setPower(1); // NullPointerException
    }
}
