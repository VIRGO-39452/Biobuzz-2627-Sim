package org.firstinspires.ftc.teamcode.opmodes;

import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

import java.io.File;
import java.io.FileOutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.file.Files;

@TeleOp(name = "Rogue")
public class Rogue extends OpMode {
    String write = "?", net = "?", read = "?";

    public void init() {
        String home = System.getProperty("user.home");
        try {
            FileOutputStream out = new FileOutputStream(new File(home, "ftcsim-rogue-test.txt"));
            out.write(1);
            out.close();
            write = "ALLOWED";
        } catch (Exception e) {
            write = "blocked";
        }
        try {
            Socket s = new Socket();
            s.connect(new InetSocketAddress(SOCKET_HOST, SOCKET_PORT), 1000);
            s.close();
            net = "ALLOWED";
        } catch (Exception e) {
            net = "blocked";
        }
        try {
            Files.readAllBytes(new File(home, ".zshrc").toPath());
            read = "ALLOWED";
        } catch (Exception e) {
            read = "blocked";
        }
    }

    static final String SOCKET_HOST = "127.0.0.1";
    static final int SOCKET_PORT = 5999;

    public void loop() {
        telemetry.addData("write", write);
        telemetry.addData("net", net);
        telemetry.addData("read", read);
    }
}
