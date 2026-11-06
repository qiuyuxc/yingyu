package android.os;

/** Host composition tests read theme locals without drawing or profiling Android UI. */
public final class Trace {
    private Trace() {}

    public static void beginSection(String sectionName) {}

    public static void endSection() {}

    public static boolean isEnabled() {
        return false;
    }
}
