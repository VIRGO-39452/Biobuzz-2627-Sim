package ftcsim.runtime;

import com.qualcomm.robotcore.hardware.DistanceSensor;
import org.firstinspires.ftc.robotcore.external.navigation.DistanceUnit;

/** Reading 0: distance in metres, negative when nothing is in range. */
public class SimDistanceSensor extends SimSensor implements DistanceSensor {
    public SimDistanceSensor(String name) {
        super(name, "distance", "Simulated Distance Sensor");
    }

    @Override
    public double getDistance(DistanceUnit unit) {
        double m = value(0, -1);
        return m < 0 ? DistanceSensor.distanceOutOfRange : unit.fromMeters(m);
    }
}
