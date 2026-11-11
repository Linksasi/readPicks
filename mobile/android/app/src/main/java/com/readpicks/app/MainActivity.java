package com.readpicks.app;

import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Bundle;

import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ProcessTextPlugin.class);
        registerPlugin(SelectionPlugin.class);
        super.onCreate(savedInstanceState);
        // BridgeActivity 会把主题换成 AppTheme_NoActionBar，默认状态栏是 AppCompat 的 #757575
        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
        int paper = Color.parseColor(night ? "#0E0F13" : "#F7F7F8");
        getWindow().setStatusBarColor(paper);
        getWindow().setNavigationBarColor(paper);
        WindowInsetsControllerCompat bars =
                new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
        bars.setAppearanceLightStatusBars(!night);
        bars.setAppearanceLightNavigationBars(!night);
        forwardProcessText(getIntent());
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        forwardProcessText(intent);
    }

    /** 系统文本选择菜单「拾词」：取出选中文本交给插件（WebView 未就绪时由 getPending 兜底） */
    private void forwardProcessText(Intent intent) {
        if (intent == null) return;
        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
        if (text == null || text.length() == 0) return;
        PluginHandle handle = getBridge().getPlugin("ProcessText");
        if (handle != null && handle.getInstance() instanceof ProcessTextPlugin) {
            ((ProcessTextPlugin) handle.getInstance()).receive(text.toString(), false);
        }
    }
}
