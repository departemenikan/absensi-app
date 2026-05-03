package com.sukodo.absensi;

import android.os.Bundle;
import android.webkit.WebView;
import android.view.ViewGroup;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private SwipeRefreshLayout swipeRefreshLayout;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState); // Capacitor setup jalan dulu

        // Ambil WebView dari Capacitor Bridge
        WebView webView = getBridge().getWebView();

        // Ambil parent (ViewGroup) dari WebView
        ViewGroup parent = (ViewGroup) webView.getParent();

        // Buat SwipeRefreshLayout secara programmatic
        swipeRefreshLayout = new SwipeRefreshLayout(this);
        swipeRefreshLayout.setLayoutParams(new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        // Warna indikator loading (sesuai warna app: biru)
        swipeRefreshLayout.setColorSchemeColors(
            0xFF4f8ef7,  // biru primary
            0xFF1a237e   // biru gelap
        );

        // Pindahkan WebView ke dalam SwipeRefreshLayout
        int index = parent.indexOfChild(webView);
        parent.removeView(webView);
        swipeRefreshLayout.addView(webView);
        parent.addView(swipeRefreshLayout, index);

        // Listener refresh
        swipeRefreshLayout.setOnRefreshListener(() -> {
            webView.reload();
            // Hentikan animasi loading setelah 1.5 detik
            swipeRefreshLayout.postDelayed(() ->
                swipeRefreshLayout.setRefreshing(false), 1500
            );
        });

        // Nonaktifkan pull-to-refresh jika WebView bisa scroll ke atas
        // (agar tidak bentrok saat scroll konten biasa)
        webView.setOnScrollChangeListener((v, scrollX, scrollY, oldScrollX, oldScrollY) -> {
            // Aktifkan swipe refresh hanya jika WebView di posisi paling atas
            swipeRefreshLayout.setEnabled(scrollY == 0);
        });
    }
}
