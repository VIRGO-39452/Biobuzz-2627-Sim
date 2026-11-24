package ftcsim.runtime;

import com.qualcomm.robotcore.hardware.IMU;
import org.firstinspires.ftc.robotcore.external.navigation.AngleUnit;
import org.firstinspires.ftc.robotcore.external.navigation.AngularVelocity;
import org.firstinspires.ftc.robotcore.external.navigation.Quaternion;
import org.firstinspires.ftc.robotcore.external.navigation.YawPitchRollAngles;

/** Readings: yaw, pitch, roll (rad), then pitch, roll, yaw rates (rad/s) as x, y, z rotation rates. */
public class SimIMU extends SimSensor implements IMU {
    public SimIMU(String name) {
        super(name, "imu", "Simulated IMU");
    }

    @Override
    public boolean initialize(Parameters parameters) {
        return true;
    }

    @Override
    public void resetYaw() {
        Bridge.send("{\"t\":\"imu\",\"name\":" + Bridge.q(name) + ",\"resetYaw\":true}");
        Bridge.awaitSensorUpdate(name, 50);
    }

    @Override
    public YawPitchRollAngles getRobotYawPitchRollAngles() {
        return new YawPitchRollAngles(AngleUnit.RADIANS, value(0, 0), value(1, 0), value(2, 0), System.nanoTime());
    }

    @Override
    public Quaternion getRobotOrientationAsQuaternion() {
        double y = value(0, 0) / 2, p = value(1, 0) / 2, r = value(2, 0) / 2; // Z (yaw), X (pitch), Y (roll)
        double cy = Math.cos(y), sy = Math.sin(y), cp = Math.cos(p), sp = Math.sin(p), cr = Math.cos(r), sr = Math.sin(r);
        return new Quaternion((float) (cy * cp * cr - sy * sp * sr), (float) (cy * sp * cr - sy * cp * sr),
                (float) (cy * cp * sr + sy * sp * cr), (float) (sy * cp * cr + cy * sp * sr), System.nanoTime());
    }

    @Override
    public AngularVelocity getRobotAngularVelocity(AngleUnit angleUnit) {
        return new AngularVelocity(AngleUnit.RADIANS, (float) value(3, 0), (float) value(4, 0), (float) value(5, 0), System.nanoTime()).toAngleUnit(angleUnit);
    }
}
