package ftcsim.runtime;

import com.qualcomm.robotcore.eventloop.opmode.Autonomous;
import com.qualcomm.robotcore.eventloop.opmode.Disabled;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.OpModeControl;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;
import com.qualcomm.robotcore.hardware.HardwareMap;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.PrintStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Modifier;
import java.net.URL;
import java.net.URLClassLoader;
import java.util.ArrayList;
import java.util.List;

/**
 * Entry point of the OpMode JVM.
 *   Main --list <classesDir>            report every OpMode class found by reflection
 *   Main <classesDir> <opModeClassName> run one OpMode under simulator control
 */
public final class Main {
    private static volatile boolean finished = false;

    public static void main(String[] args) throws Exception {
        PrintStream proto = new PrintStream(new FileOutputStream(FileDescriptor.out), false, "UTF-8");
        Bridge.init(proto);
        System.setOut(new PrintStream(new LogStream("stdout"), true, "UTF-8"));
        System.setErr(new PrintStream(new LogStream("stderr"), true, "UTF-8"));
        if (args.length == 2 && args[0].equals("--list")) {
            list(new File(args[1]));
            return;
        }
        if (args.length < 2 || args.length > 3) {
            Bridge.send("{\"t\":\"state\",\"state\":\"error\",\"error\":\"usage: Main <classesDir> <class>\"}");
            Runtime.getRuntime().halt(64);
        }
        if (args.length == 3) Bridge.loadMotorSpecs(new File(args[2]));
        run(new File(args[0]), args[1]);
    }

    /** User System.out / System.err output becomes console log lines, never protocol data. */
    private static final class LogStream extends OutputStream {
        private final String stream;
        private final ByteArrayOutputStream buf = new ByteArrayOutputStream();

        LogStream(String stream) {
            this.stream = stream;
        }

        @Override
        public synchronized void write(int b) {
            if (b == '\n') emit();
            else if (b != '\r') buf.write(b);
        }

        @Override
        public synchronized void flush() {
        }

        private void emit() {
            String text;
            try {
                text = buf.toString("UTF-8");
            } catch (java.io.UnsupportedEncodingException e) {
                text = buf.toString();
            }
            buf.reset();
            Bridge.send("{\"t\":\"log\",\"stream\":\"" + stream + "\",\"text\":" + Bridge.q(text) + "}");
        }
    }

    // ------------------------------------------------------------------ discovery

    private static void collect(File dir, String prefix, List<String> out) {
        File[] files = dir.listFiles();
        if (files == null) return;
        java.util.Arrays.sort(files);
        for (File f : files) {
            if (f.isDirectory()) collect(f, prefix + f.getName() + ".", out);
            else if (f.getName().endsWith(".class")) {
                out.add(prefix + f.getName().substring(0, f.getName().length() - 6));
            }
        }
    }

    private static void list(File classesDir) throws Exception {
        URLClassLoader cl = new URLClassLoader(new URL[]{classesDir.toURI().toURL()}, Main.class.getClassLoader());
        List<String> names = new ArrayList<String>();
        collect(classesDir, "", names);
        StringBuilder sb = new StringBuilder("{\"t\":\"opmodes\",\"list\":[");
        StringBuilder problems = new StringBuilder();
        boolean first = true;
        for (String n : names) {
            Class<?> c;
            try {
                c = Class.forName(n, false, cl);
            } catch (Throwable t) {
                if (problems.length() > 0) problems.append(',');
                problems.append("{\"class\":").append(Bridge.q(n)).append(",\"error\":").append(Bridge.q(t.toString())).append('}');
                continue;
            }
            TeleOp tele = c.getAnnotation(TeleOp.class);
            Autonomous auto = c.getAnnotation(Autonomous.class);
            if (tele == null && auto == null) continue;
            String problem = null;
            if (!OpMode.class.isAssignableFrom(c)) problem = "annotated class does not extend OpMode";
            else if (Modifier.isAbstract(c.getModifiers())) problem = "class is abstract";
            else if (!Modifier.isPublic(c.getModifiers())) problem = "class is not public";
            String display = tele != null ? tele.name() : auto.name();
            if (display.isEmpty()) display = c.getSimpleName();
            if (!first) sb.append(',');
            first = false;
            sb.append("{\"class\":").append(Bridge.q(n));
            sb.append(",\"name\":").append(Bridge.q(display));
            sb.append(",\"group\":").append(Bridge.q(tele != null ? tele.group() : auto.group()));
            sb.append(",\"flavor\":\"").append(tele != null ? "TeleOp" : "Autonomous").append('"');
            sb.append(",\"base\":\"").append(LinearOpMode.class.isAssignableFrom(c) ? "LinearOpMode" : "OpMode").append('"');
            sb.append(",\"disabled\":").append(c.getAnnotation(Disabled.class) != null);
            sb.append(",\"problem\":").append(Bridge.q(problem));
            sb.append('}');
        }
        sb.append("],\"loadErrors\":[").append(problems).append("]}");
        Bridge.send(sb.toString());
    }

    // ------------------------------------------------------------------ execution

    private static void state(String state, String error) {
        Bridge.send("{\"t\":\"state\",\"state\":\"" + state + "\",\"error\":" + Bridge.q(error) + "}");
    }

    private static String stack(Throwable t) {
        StringWriter sw = new StringWriter();
        t.printStackTrace(new PrintWriter(sw));
        return sw.toString();
    }

    private static void run(File classesDir, String className) throws Exception {
        final OpMode op;
        final SimTelemetry telemetry = new SimTelemetry();
        try {
            URLClassLoader cl = new URLClassLoader(new URL[]{classesDir.toURI().toURL()}, Main.class.getClassLoader());
            Class<?> c = Class.forName(className, true, cl);
            Constructor<?> ctor = c.getDeclaredConstructor();
            ctor.setAccessible(true);
            op = (OpMode) ctor.newInstance();
        } catch (Throwable t) {
            Throwable cause = t instanceof InvocationTargetException && t.getCause() != null ? t.getCause() : t;
            state("error", "Could not create OpMode " + className + "\n" + stack(cause));
            Runtime.getRuntime().halt(2);
            return;
        }
        op.gamepad1 = Bridge.gamepad1;
        op.gamepad2 = Bridge.gamepad2;
        op.telemetry = telemetry;
        op.hardwareMap = new HardwareMap();

        final Thread thread = new Thread(new Runnable() {
            @Override
            public void run() {
                lifecycle(op, telemetry);
            }
        }, "OpMode");
        thread.setDaemon(true);
        thread.start();

        BufferedReader in = new BufferedReader(new InputStreamReader(System.in, "UTF-8"));
        String line;
        while ((line = in.readLine()) != null) {
            if (Bridge.handleStateLine(line)) continue;
            if (line.equals("START")) {
                op.resetRuntime();
                OpModeControl.start(op);
                state("running", null);
            } else if (line.equals("STOP")) {
                OpModeControl.requestStop(op);
                thread.interrupt();
                thread.join(1000);
                if (thread.isAlive() && !finished) {
                    state("stuck", "OpMode did not stop within 1000 ms of STOP; the JVM was terminated.");
                    Runtime.getRuntime().halt(3);
                }
            }
        }
        // Simulator went away: never outlive it.
        Runtime.getRuntime().halt(4);
    }

    private static void lifecycle(OpMode op, SimTelemetry telemetry) {
        try {
            state("init", null);
            Bridge.syncInputs();
            if (op instanceof LinearOpMode) {
                ((LinearOpMode) op).runOpMode();
            } else {
                op.init();
                telemetry.update();
                telemetry.flush();
                while (!OpModeControl.isStarted(op) && !OpModeControl.isStopRequested(op)) {
                    Bridge.syncInputs();
                    op.time = op.getRuntime();
                    op.init_loop();
                    telemetry.update();
                    pace();
                }
                if (!OpModeControl.isStopRequested(op)) {
                    Bridge.syncInputs();
                    op.start();
                    while (!OpModeControl.isStopRequested(op)) {
                        Bridge.syncInputs();
                        op.time = op.getRuntime();
                        op.loop();
                        telemetry.update();
                        pace();
                    }
                }
                Thread.interrupted(); // clear, so stop() can run normally
                op.stop();
            }
        } catch (InterruptedException e) {
            // normal way for a LinearOpMode to end on STOP
        } catch (OpModeControl.TerminateSignal e) {
            // terminateOpModeNow()
        } catch (Throwable t) {
            telemetry.flush();
            state("error", stack(t));
            Runtime.getRuntime().halt(2);
        }
        telemetry.flush();
        finished = true;
        state("stopped", null);
        Runtime.getRuntime().halt(0);
    }

    /** Iterative OpModes on a Control Hub loop at a few hundred Hz at most; pace to ~200 Hz. */
    private static void pace() {
        try {
            Thread.sleep(5);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
