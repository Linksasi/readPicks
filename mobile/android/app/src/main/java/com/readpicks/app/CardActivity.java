package com.readpicks.app;

import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

/**
 * 划词悬浮卡：PROCESS_TEXT 直接拉起的对话框式半透明 Activity。
 * 形态对标 PC 端悬浮窗——浮在源应用上方（半透明压暗背景），关闭即回到阅读处，不打断心流。
 * 与 MainActivity 同进程，SelectionHolder（无障碍语境缓存）直接可读。
 */
public class CardActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ProcessTextPlugin.class);
        registerPlugin(SelectionPlugin.class);
        super.onCreate(savedInstanceState);
        // WebView 透明：让卡片背后的原生压暗层/源应用透出来
        getBridge().getWebView().setBackgroundColor(Color.TRANSPARENT);
        forwardProcessText(getIntent());
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        forwardProcessText(intent);
    }

    private void forwardProcessText(Intent intent) {
        if (intent == null) return;
        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
        if (text == null || text.length() == 0) return;
        PluginHandle handle = getBridge().getPlugin("ProcessText");
        if (handle != null && handle.getInstance() instanceof ProcessTextPlugin) {
            ((ProcessTextPlugin) handle.getInstance()).receive(text.toString(), true);
        }
    }
}
