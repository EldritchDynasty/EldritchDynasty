package nz.eldritchdynasty.game;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import org.junit.Test;

public class DiagnosticIntentsTest {
    @Test public void releaseBlocksPrivateDiagnosticsIncludingMixedCase() {
        assertTrue(DiagnosticIntents.shouldBlock(false, "eldritchdynasty-smoke"));
        assertTrue(DiagnosticIntents.shouldBlock(false, "ELDRITCHDYNASTY-SMOKE"));
    }

    @Test public void debugStillAllowsPrivateDiagnostics() {
        assertFalse(DiagnosticIntents.shouldBlock(true, "eldritchdynasty-smoke"));
        assertFalse(DiagnosticIntents.shouldBlock(true, "ELDRITCHDYNASTY-SMOKE"));
    }

    @Test public void normalLaunchesAndOtherLinksAreUntouched() {
        for (String scheme : new String[] { null, "", "https", "content", "eldritchdynasty-smoke-other" }) {
            assertFalse(DiagnosticIntents.shouldBlock(false, scheme));
            assertFalse(DiagnosticIntents.shouldBlock(true, scheme));
        }
    }
}
