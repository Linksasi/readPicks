package com.readpicks.app;

import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

/**
 * 划词悬浮卡：PROCESS_TEXT 直接拉起的对话框式半透明 Activity。
 * 形态对标 PC 端悬浮窗——浮在源应用上方（压暗背景），关闭即回到阅读处。
 * 压暗与卡片形态全部由网页 CSS 绘制（rgba 覆盖层在所有设备可靠渲染），
 * 原生只负责：窗口半透明 + 清除容器白底 + 把选中文本递给网页。
 */
public class CardActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ProcessTextPlugin.class);
        registerPlugin(SelectionPlugin.class);
        super.onCreate(savedInstanceState);
        clearBackgroundsBehindWebView();
        getBridge().getWebView().setBackgroundColor(Color.TRANSPARENT);
        forwardProcessText(getIntent());
    }

    @Override
    public void onResume() {
        super.onResume();
        getBridge().getWebView().setBackgroundColor(Color.TRANSPARENT);
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        forwardProcessText(intent);
    }

    /** 清除 WebView 上层容器的主题白底（否则盖住网页的半透明压暗层） */
    private void clearBackgroundsBehindWebView() {
        View layer = getBridge().getWebView();
        while (layer.getParent() instanceof ViewGroup) {
            ViewGroup vg = (ViewGroup) layer.getParent();
            if (vg == getWindow().getDecorView()) break;
            ((View) vg).setBackgroundColor(Color.TRANSPARENT);
            layer = vg;
        }
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
