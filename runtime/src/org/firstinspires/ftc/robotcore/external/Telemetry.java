package org.firstinspires.ftc.robotcore.external;

public interface Telemetry {
    Item addData(String caption, String format, Object... args);

    Item addData(String caption, Object value);

    boolean removeItem(Item item);

    void clear();

    void clearAll();

    Line addLine();

    Line addLine(String lineCaption);

    boolean removeLine(Line line);

    boolean isAutoClear();

    void setAutoClear(boolean autoClear);

    int getMsTransmissionInterval();

    void setMsTransmissionInterval(int msTransmissionInterval);

    String getItemSeparator();

    void setItemSeparator(String itemSeparator);

    String getCaptionValueSeparator();

    void setCaptionValueSeparator(String captionValueSeparator);

    boolean update();

    interface Line {
        Item addData(String caption, String format, Object... args);

        Item addData(String caption, Object value);
    }

    interface Item {
        String getCaption();

        Item setCaption(String caption);

        Item setValue(String format, Object... args);

        Item setValue(Object value);

        Item setRetained(Boolean retained);

        boolean isRetained();

        Item addData(String caption, String format, Object... args);

        Item addData(String caption, Object value);
    }
}
