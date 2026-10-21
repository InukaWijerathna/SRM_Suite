package com.srmsuite.app;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Android 15+ (targetSdk 35+) draws edge-to-edge by default, letting the system
        // navigation bar overlap the WebView. The web layer's `env(safe-area-inset-*)` relies
        // on Capacitor feeding real inset values through, which isn't reliable across devices —
        // so instead we opt back into the classic behaviour where Android reserves space for
        // the system bars itself, keeping the sticky header/footer fully visible.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
    }
}
