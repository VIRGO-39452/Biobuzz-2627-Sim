package com.qualcomm.robotcore.hardware;

import ftcsim.runtime.Bridge;
import ftcsim.runtime.SimCRServo;
import ftcsim.runtime.SimDcMotor;
import ftcsim.runtime.SimAnalogInput;
import ftcsim.runtime.SimColorSensor;
import ftcsim.runtime.SimDigitalChannel;
import ftcsim.runtime.SimDistanceSensor;
import ftcsim.runtime.SimIMU;
import ftcsim.runtime.SimServo;
import ftcsim.runtime.SimTouchSensor;
import ftcsim.runtime.SimVoltageSensor;
import com.qualcomm.hardware.lynx.LynxModule;
import com.qualcomm.hardware.rev.Rev2mDistanceSensor;
import com.qualcomm.hardware.rev.RevColorSensorV3;
import com.qualcomm.hardware.rev.RevTouchSensor;

import java.util.Iterator;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Simulator HardwareMap. Devices are created on first request and reported to the simulator,
 * which binds them to the robot model (or flags them as unresolved).
 */
public class HardwareMap {
    private final Map<String, HardwareDevice> devices = new LinkedHashMap<String, HardwareDevice>();

    public final DeviceMapping<DcMotor> dcMotor = new DeviceMapping<DcMotor>(DcMotor.class);
    public final DeviceMapping<Servo> servo = new DeviceMapping<Servo>(Servo.class);
    public final DeviceMapping<CRServo> crservo = new DeviceMapping<CRServo>(CRServo.class);
    public final DeviceMapping<VoltageSensor> voltageSensor = new DeviceMapping<VoltageSensor>(VoltageSensor.class);
    public final DeviceMapping<TouchSensor> touchSensor = new DeviceMapping<TouchSensor>(TouchSensor.class);
    public final DeviceMapping<ColorSensor> colorSensor = new DeviceMapping<ColorSensor>(ColorSensor.class);
    public final DeviceMapping<DigitalChannel> digitalChannel = new DeviceMapping<DigitalChannel>(DigitalChannel.class);
    public final DeviceMapping<AnalogInput> analogInput = new DeviceMapping<AnalogInput>(AnalogInput.class);

    private final LynxModule hub = new LynxModule();

    public HardwareMap() {
        // Every Control Hub has a battery voltage sensor, so code that iterates hardwareMap.voltageSensor finds one.
        devices.put("Control Hub", new SimVoltageSensor("Control Hub"));
    }

    public class DeviceMapping<T extends HardwareDevice> implements Iterable<T> {
        private final Class<T> type;

        DeviceMapping(Class<T> type) {
            this.type = type;
        }

        public T get(String deviceName) {
            return HardwareMap.this.get(type, deviceName);
        }

        @Override
        public Iterator<T> iterator() {
            return HardwareMap.this.getAll(type).iterator();
        }

        public int size() {
            return HardwareMap.this.getAll(type).size();
        }

        public boolean contains(String deviceName) {
            HardwareDevice d = devices.get(deviceName.trim());
            return d != null && type.isInstance(d);
        }
    }

    public synchronized <T> T get(Class<? extends T> classOrInterface, String deviceName) {
        String name = deviceName.trim();
        HardwareDevice existing = devices.get(name);
        if (existing != null) {
            if (classOrInterface.isInstance(existing)) {
                return classOrInterface.cast(existing);
            }
            throw new IllegalArgumentException(String.format(
                    "Unable to find a hardware device with name \"%s\" and type %s", name, classOrInterface.getSimpleName()));
        }
        HardwareDevice created;
        if (classOrInterface.isAssignableFrom(SimDcMotor.class) && DcMotorSimple.class.isAssignableFrom(classOrInterface)
                && !CRServo.class.isAssignableFrom(classOrInterface)) {
            created = new SimDcMotor(name);
        } else if (classOrInterface.isAssignableFrom(SimCRServo.class) && CRServo.class.isAssignableFrom(classOrInterface)) {
            created = new SimCRServo(name);
        } else if (classOrInterface.isAssignableFrom(SimServo.class) && Servo.class.isAssignableFrom(classOrInterface)) {
            created = new SimServo(name);
        } else if (IMU.class.isAssignableFrom(classOrInterface) && classOrInterface.isAssignableFrom(SimIMU.class)) {
            created = new SimIMU(name);
        } else if (VoltageSensor.class.isAssignableFrom(classOrInterface) && classOrInterface.isAssignableFrom(SimVoltageSensor.class)) {
            created = new SimVoltageSensor(name);
        } else if (classOrInterface.isAssignableFrom(RevColorSensorV3.class) && (ColorSensor.class.isAssignableFrom(classOrInterface)
                || NormalizedColorSensor.class.isAssignableFrom(classOrInterface) || SimColorSensor.class.isAssignableFrom(classOrInterface))) {
            created = new RevColorSensorV3(name);
        } else if (classOrInterface.isAssignableFrom(Rev2mDistanceSensor.class) && (DistanceSensor.class.isAssignableFrom(classOrInterface) || SimDistanceSensor.class.isAssignableFrom(classOrInterface))) {
            created = new Rev2mDistanceSensor(name);
        } else if (classOrInterface.isAssignableFrom(RevTouchSensor.class) && (TouchSensor.class.isAssignableFrom(classOrInterface) || SimTouchSensor.class.isAssignableFrom(classOrInterface))) {
            created = new RevTouchSensor(name);
        } else if (DigitalChannel.class.isAssignableFrom(classOrInterface) && classOrInterface.isAssignableFrom(SimDigitalChannel.class)) {
            created = new SimDigitalChannel(name);
        } else if (AnalogInput.class.isAssignableFrom(classOrInterface) && classOrInterface.isAssignableFrom(SimAnalogInput.class)) {
            created = new SimAnalogInput(name);
        } else {
            Bridge.send("{\"t\":\"unsupported\",\"name\":" + Bridge.q(name) + ",\"cls\":" + Bridge.q(classOrInterface.getName()) + "}");
            throw new IllegalArgumentException("ftc-sim: hardware type " + classOrInterface.getName()
                    + " (device \"" + name + "\") is not simulated yet");
        }
        devices.put(name, created);
        Bridge.send("{\"t\":\"hw\",\"name\":" + Bridge.q(name) + ",\"kind\":" + Bridge.q(Bridge.kindOf(created))
                + ",\"requested\":" + Bridge.q(classOrInterface.getSimpleName()) + "}");
        return classOrInterface.cast(created);
    }

    public <T> T tryGet(Class<? extends T> classOrInterface, String deviceName) {
        try {
            return get(classOrInterface, deviceName);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    public synchronized <T> List<T> getAll(Class<? extends T> classOrInterface) {
        List<T> result = new ArrayList<T>();
        if (classOrInterface.isInstance(hub)) result.add(classOrInterface.cast(hub));
        for (HardwareDevice d : devices.values()) {
            if (classOrInterface.isInstance(d)) result.add(classOrInterface.cast(d));
        }
        return result;
    }
}
