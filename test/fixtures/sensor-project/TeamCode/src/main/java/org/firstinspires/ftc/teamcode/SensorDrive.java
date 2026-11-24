package org.firstinspires.ftc.teamcode;

import com.qualcomm.hardware.rev.RevColorSensorV3;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.AnalogInput;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.DigitalChannel;
import com.qualcomm.robotcore.hardware.DistanceSensor;
import com.qualcomm.robotcore.hardware.TouchSensor;
import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;

@TeleOp(name = "Sensor Drive")
public class SensorDrive extends OpMode {
    DcMotor left, right;
    DistanceSensor front;
    TouchSensor bumper;
    RevColorSensorV3 hopper;
    DigitalChannel beam;
    AnalogInput pot;

    @Override
    public void init() {
        left = hardwareMap.get(DcMotor.class, "left_drive");
        right = hardwareMap.get(DcMotor.class, "right_drive");
        right.setDirection(DcMotor.Direction.REVERSE);
        front = hardwareMap.get(DistanceSensor.class, "front_distance");
        bumper = hardwareMap.get(TouchSensor.class, "bumper");
        hopper = hardwareMap.get(RevColorSensorV3.class, "hopper_color");
        beam = hardwareMap.get(DigitalChannel.class, "beam");
        beam.setMode(DigitalChannel.Mode.INPUT);
        pot = hardwareMap.get(AnalogInput.class, "pot");
    }

    @Override
    public void loop() {
        double cm = front.getDistance(DistanceUnit.CM);
        boolean clear = cm > 30 && !bumper.isPressed(); // creep forward until something is 30 cm ahead
        left.setPower(clear ? 0.35 : 0);
        right.setPower(clear ? 0.35 : 0);
        String seen = hopper.getDistance(DistanceUnit.CM) > 5 ? "nothing"
                : hopper.red() > 150 && hopper.green() > 120 && hopper.blue() < 100 ? "POLLEN"
                : hopper.red() > hopper.blue() ? "red NECTAR" : "blue NECTAR";
        telemetry.addData("Front", cm > 1000 ? "out of range" : String.format("%.0f cm", cm));
        telemetry.addData("Bumper", bumper.isPressed());
        telemetry.addData("Hopper", seen);
        telemetry.addData("Beam", beam.getState());
        telemetry.addData("Pot", "%.2f", pot.getVoltage());
    }
}
