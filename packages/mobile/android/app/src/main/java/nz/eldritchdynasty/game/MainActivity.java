package nz.eldritchdynasty.game;

import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private void sanitizeDiagnosticIntent(Intent intent) {
        if (intent == null) return;
        Uri data = intent.getData();
        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (data != null && DiagnosticIntents.shouldBlock(debuggable, data.getScheme())) {
            intent.setData(null);
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // The bridge can inspect the launch URI while creating its WebView.
        sanitizeDiagnosticIntent(getIntent());
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        // Explicit intents bypass URI intent-filters on an exported launcher.
        sanitizeDiagnosticIntent(intent);
        super.onNewIntent(intent);
    }
}
