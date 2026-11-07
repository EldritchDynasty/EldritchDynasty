package nz.eldritchdynasty.game;

/** The native application flag, not a WebView/client preference, authorizes diagnostics. */
final class DiagnosticIntents {
    private DiagnosticIntents() {}

    static boolean shouldBlock(boolean debuggable, String scheme) {
        return !debuggable && "eldritchdynasty-smoke".equalsIgnoreCase(scheme);
    }
}
