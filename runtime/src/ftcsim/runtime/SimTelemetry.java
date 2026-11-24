package ftcsim.runtime;

import org.firstinspires.ftc.robotcore.external.Telemetry;

import java.util.ArrayList;
import java.util.List;

/** Telemetry that forwards what the OpMode submits to the simulator UI. Nothing is synthesized. */
public class SimTelemetry implements Telemetry {
    private final List<LineImpl> lines = new ArrayList<LineImpl>();
    private boolean autoClear = true;
    private int msInterval = 250;
    private String itemSeparator = " | ";
    private String captionValueSeparator = " : ";
    private long lastTransmit = 0;
    private String pending = null;

    private class LineImpl implements Line {
        final String caption;
        final List<ItemImpl> items = new ArrayList<ItemImpl>();

        LineImpl(String caption) {
            this.caption = caption;
        }

        @Override
        public Item addData(String caption, String format, Object... args) {
            return add(caption, String.format(format, args));
        }

        @Override
        public Item addData(String caption, Object value) {
            return add(caption, String.valueOf(value));
        }

        Item add(String caption, String value) {
            synchronized (SimTelemetry.this) {
                ItemImpl it = new ItemImpl(this, caption, value);
                items.add(it);
                return it;
            }
        }

        boolean retained() {
            for (ItemImpl i : items) if (i.retained) return true;
            return false;
        }

        String render() {
            StringBuilder sb = new StringBuilder(caption);
            boolean first = true;
            for (ItemImpl i : items) {
                if (!first) sb.append(itemSeparator);
                first = false;
                sb.append(i.caption).append(captionValueSeparator).append(i.value);
            }
            return sb.toString();
        }
    }

    private class ItemImpl implements Item {
        final LineImpl line;
        String caption;
        String value;
        boolean retained = false;

        ItemImpl(LineImpl line, String caption, String value) {
            this.line = line;
            this.caption = caption;
            this.value = value;
        }

        @Override
        public String getCaption() {
            return caption;
        }

        @Override
        public Item setCaption(String caption) {
            this.caption = caption;
            return this;
        }

        @Override
        public Item setValue(String format, Object... args) {
            this.value = String.format(format, args);
            return this;
        }

        @Override
        public Item setValue(Object value) {
            this.value = String.valueOf(value);
            return this;
        }

        @Override
        public Item setRetained(Boolean retained) {
            this.retained = retained != null && retained;
            return this;
        }

        @Override
        public boolean isRetained() {
            return retained;
        }

        @Override
        public Item addData(String caption, String format, Object... args) {
            return line.addData(caption, format, args);
        }

        @Override
        public Item addData(String caption, Object value) {
            return line.addData(caption, value);
        }
    }

    @Override
    public synchronized Item addData(String caption, String format, Object... args) {
        LineImpl l = new LineImpl("");
        lines.add(l);
        return l.addData(caption, format, args);
    }

    @Override
    public synchronized Item addData(String caption, Object value) {
        LineImpl l = new LineImpl("");
        lines.add(l);
        return l.addData(caption, value);
    }

    @Override
    public synchronized boolean removeItem(Item item) {
        for (LineImpl l : lines) {
            if (l.items.remove(item)) return true;
        }
        return false;
    }

    @Override
    public synchronized void clear() {
        for (int i = lines.size() - 1; i >= 0; i--) {
            if (!lines.get(i).retained()) lines.remove(i);
        }
    }

    @Override
    public synchronized void clearAll() {
        lines.clear();
    }

    @Override
    public synchronized Line addLine() {
        return addLine("");
    }

    @Override
    public synchronized Line addLine(String lineCaption) {
        LineImpl l = new LineImpl(lineCaption);
        lines.add(l);
        return l;
    }

    @Override
    public synchronized boolean removeLine(Line line) {
        return lines.remove(line);
    }

    @Override
    public synchronized boolean isAutoClear() {
        return autoClear;
    }

    @Override
    public synchronized void setAutoClear(boolean autoClear) {
        this.autoClear = autoClear;
    }

    @Override
    public synchronized int getMsTransmissionInterval() {
        return msInterval;
    }

    @Override
    public synchronized void setMsTransmissionInterval(int msTransmissionInterval) {
        this.msInterval = msTransmissionInterval;
    }

    @Override
    public synchronized String getItemSeparator() {
        return itemSeparator;
    }

    @Override
    public synchronized void setItemSeparator(String itemSeparator) {
        this.itemSeparator = itemSeparator;
    }

    @Override
    public synchronized String getCaptionValueSeparator() {
        return captionValueSeparator;
    }

    @Override
    public synchronized void setCaptionValueSeparator(String captionValueSeparator) {
        this.captionValueSeparator = captionValueSeparator;
    }

    @Override
    public synchronized boolean update() {
        StringBuilder sb = new StringBuilder("{\"t\":\"telemetry\",\"lines\":[");
        boolean first = true;
        for (LineImpl l : lines) {
            if (!first) sb.append(',');
            first = false;
            sb.append(Bridge.q(l.render()));
        }
        sb.append("]}");
        pending = sb.toString();
        if (autoClear) clear();
        // Like the Driver Station link, transmissions are rate limited (default 250 ms).
        long now = System.nanoTime();
        if (lastTransmit != 0 && (now - lastTransmit) < msInterval * 1000000L) return false;
        return flush();
    }

    /** Send the most recent update() now. Used when the OpMode changes state or ends. */
    public synchronized boolean flush() {
        if (pending == null) return false;
        Bridge.send(pending);
        pending = null;
        lastTransmit = System.nanoTime();
        return true;
    }
}
