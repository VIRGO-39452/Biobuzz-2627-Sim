package ftcsim.runtime;

import com.qualcomm.robotcore.hardware.CRServo;
import com.qualcomm.robotcore.hardware.DcMotor;
import com.qualcomm.robotcore.hardware.Gamepad;
import com.qualcomm.robotcore.hardware.HardwareDevice;

import java.io.PrintStream;
import java.util.concurrent.ConcurrentHashMap;

/** Link between the OpMode's JVM and the simulator process (JSON lines out, text lines in). */
public final class Bridge {
    private Bridge() {
    }

    private static PrintStream proto;
    private static final Object LOCK = new Object();

    public static final Gamepad gamepad1 = new Gamepad();
    public static final Gamepad gamepad2 = new Gamepad();

    private static final class PadSnapshot {
        final float[] axes;
        final int buttons;

        PadSnapshot(float[] axes, int buttons) {
            this.axes = axes;
            this.buttons = buttons;
        }
    }

    private static volatile PadSnapshot pad1 = new PadSnapshot(new float[6], 0);
    private static volatile PadSnapshot pad2 = new PadSnapshot(new float[6], 0);

    /** name -> {raw position ticks, raw velocity ticks/s, current amps} */
    private static final ConcurrentHashMap<String, double[]> motorState = new ConcurrentHashMap<String, double[]>();
    private static volatile double batteryVolts = 12.0;
    /** name -> latest sensor readings from the simulator */
    private static final ConcurrentHashMap<String, double[]> sensorState = new ConcurrentHashMap<String, double[]>();
    private static final ConcurrentHashMap<String, Long> sensorStamp = new ConcurrentHashMap<String, Long>();

    public static double[] sensor(String name) {
        return sensorState.get(name);
    }

    /** Wait briefly for the next reading of a sensor (used after a command that changes what it reports). */
    public static void awaitSensorUpdate(String name, long maxMillis) {
        Long before = sensorStamp.get(name);
        long end = System.currentTimeMillis() + maxMillis;
        try {
            while (System.currentTimeMillis() < end) {
                Long now = sensorStamp.get(name);
                if (now != null && !now.equals(before)) { Thread.sleep(12); return; } // one more tick so the new zero is in effect
                Thread.sleep(2);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
    /** name -> {ticksPerRev, maxTicksPerSecond}; "*" is the fallback for devices not on the robot model. */
    private static final ConcurrentHashMap<String, double[]> motorSpec = new ConcurrentHashMap<String, double[]>();

    static void loadMotorSpecs(java.io.File file) throws java.io.IOException {
        java.io.BufferedReader r = new java.io.BufferedReader(new java.io.InputStreamReader(new java.io.FileInputStream(file), "UTF-8"));
        try {
            String line;
            while ((line = r.readLine()) != null) {
                String[] p = line.split("\t");
                if (p.length == 3) motorSpec.put(p[0], new double[]{Double.parseDouble(p[1]), Double.parseDouble(p[2])});
            }
        } finally {
            r.close();
        }
    }

    public static double[] motorSpec(String name) {
        double[] s = motorSpec.get(name);
        if (s == null) s = motorSpec.get("*");
        return s != null ? s : new double[]{537.7, 2796.0};
    }

    static void init(PrintStream out) {
        proto = out;
        gamepad1.id = 1;
        gamepad2.id = 2;
    }

    public static void send(String json) {
        synchronized (LOCK) {
            proto.println(json);
            proto.flush();
        }
    }

    public static String q(String s) {
        if (s == null) return "null";
        StringBuilder sb = new StringBuilder(s.length() + 2);
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20 || c == 0x2028 || c == 0x2029) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        sb.append('"');
        return sb.toString();
    }

    public static String num(double v) {
        if (Double.isNaN(v) || Double.isInfinite(v)) return "0";
        return Double.toString(v);
    }

    public static String kindOf(HardwareDevice d) {
        if (d instanceof SimSensor) return ((SimSensor) d).simKind();
        if (d instanceof DcMotor) return "motor";
        if (d instanceof CRServo) return "crservo";
        return "servo";
    }

    /** Copy the latest simulator input into the Gamepad objects. Called on the OpMode thread. */
    public static void syncInputs() {
        PadSnapshot a = pad1;
        PadSnapshot b = pad2;
        gamepad1.simApply(a.axes, a.buttons);
        gamepad2.simApply(b.axes, b.buttons);
    }

    public static double[] motor(String name) {
        double[] s = motorState.get(name);
        return s != null ? s : ZERO;
    }

    private static final double[] ZERO = new double[3];

    public static double batteryVolts() {
        return batteryVolts;
    }

    /** Handle one inbound state line. Returns false if the line is not a state line. */
    static boolean handleStateLine(String line) {
        try {
            if (line.startsWith("M ")) {
                String[] p = line.split(" ", 5);
                motorState.put(p[4], new double[]{Double.parseDouble(p[1]), Double.parseDouble(p[2]), Double.parseDouble(p[3])});
                return true;
            }
            if (line.startsWith("GP ")) {
                String[] p = line.split(" ");
                float[] axes = new float[6];
                for (int i = 0; i < 6; i++) axes[i] = Float.parseFloat(p[2 + i]);
                PadSnapshot s = new PadSnapshot(axes, Integer.parseInt(p[8]));
                if (p[1].equals("1")) pad1 = s;
                else pad2 = s;
                return true;
            }
            if (line.startsWith("S ")) { // S <count> v1 .. vn <name>
                String[] head = line.split(" ", 3);
                int n = Integer.parseInt(head[1]);
                String[] p = head[2].split(" ", n + 1);
                double[] v = new double[n];
                for (int i = 0; i < n; i++) v[i] = Double.parseDouble(p[i]);
                sensorState.put(p[n], v);
                sensorStamp.put(p[n], System.nanoTime());
                return true;
            }
            if (line.startsWith("V ")) {
                batteryVolts = Double.parseDouble(line.substring(2));
                return true;
            }
        } catch (RuntimeException e) {
            send("{\"t\":\"log\",\"stream\":\"sim\",\"text\":" + q("bad state line: " + line) + "}");
            return true;
        }
        return false;
    }
}
