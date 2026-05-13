package com.sukodo.absensi;

import android.os.Bundle;
import android.webkit.WebView;
import android.view.ViewGroup;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.aparajita.capacitor.biometricauth.BiometricAuthNative;
import java.util.ArrayList;

public class MainActivity extends BridgeActivity {

    private SwipeRefreshLayout swipeRefreshLayout;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Splash screen — harus dipanggil SEBELUM super.onCreate()
        setTheme(R.style.AppTheme_NoActionBar);

        // Daftarkan plugin BiometricAuth ke Capacitor Bridge
        registerPlugin(BiometricAuthNative.class);

        super.onCreate(savedInstanceState);

        WebView webView = getBridge().getWebView();
        ViewGroup parent = (ViewGroup) webView.getParent();

        swipeRefreshLayout = new SwipeRefreshLayout(this);
        swipeRefreshLayout.setLayoutParams(new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        swipeRefreshLayout.setColorSchemeColors(
            0xFF4f8ef7,
            0xFF1a237e
        );

        int index = parent.indexOfChild(webView);
        parent.removeView(webView);
        swipeRefreshLayout.addView(webView);
        parent.addView(swipeRefreshLayout, index);

        swipeRefreshLayout.setOnRefreshListener(() -> {
            webView.reload();
            swipeRefreshLayout.postDelayed(() ->
                swipeRefreshLayout.setRefreshing(false), 1500
            );
        });

        webView.setOnScrollChangeListener((v, scrollX, scrollY, oldScrollX, oldScrollY) -> {
            swipeRefreshLayout.setEnabled(scrollY == 0);
        });
    }
}
