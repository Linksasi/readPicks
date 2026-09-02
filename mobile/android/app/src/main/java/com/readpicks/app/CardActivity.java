package com.readpicks.app;

import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.util.DisplayMetrics;
import android.view.View;
import android.view.ViewGroup;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

/**
 * 划词悬浮卡：PROCESS_TEXT 拉起的真·对话框窗口（windowIsFloating）。
 * 窗口本身只有卡片大小——窗口外由系统合成，必然露出源应用 + 对话框压暗，
 * 不依赖 WebView 透明（部分设备不可靠）。关闭即回到阅读处，不打断心流。
 */
public class CardActivity extends BridgeActivity {

    private static volatile CardActivity instance = null;
    private volatile float widthPct = 72f;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        instance = this;
        registerPlugin(ProcessTextPlugin.class);
        registerPlugin(SelectionPlugin.class);
        super.onCreate(savedInstanceState);
        applyWindowSize();
        // WebView 透明：露出窗口圆角白底（若设备不支持，退化为方角，纯外观差异）
        getBridge().getWebView().setBackgroundColor(Color.TRANSPARENT);
        clearParentBackgrounds();
        forwardProcessText(getIntent());
    }

    @Override
    public void onResume() {
        super.onResume();
        applyWindowSize();
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        forwardProcessText(intent);
    }

    @Override
    public void onDestroy() {
        if (instance == this) instance = null;
        super.onDestroy();
    }

    /** JS 设置页滑杆同步卡片宽度（高度固定 62% 屏高，内容内部滚动） */
    public static void applySize(float wPct) {
        CardActivity a = instance;
        if (a == null) return;
        a.widthPct = Math.max(60f, Math.min(100f, wPct));
        a.runOnUiThread(a::applyWindowSize);
    }

    private void applyWindowSize() {
        DisplayMetrics dm = getResources().getDisplayMetrics();
        getWindow().setLayout(
                Math.round(dm.widthPixels * widthPct / 100f),
                Math.round(dm.heightPixels * 0.62f));
    }

    /** 清除 WebView 上层容器的主题白底（让窗口的圆角白底透出来） */
    private void clearParentBackgrounds() {
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
        // 两种入口文本：PROCESS_TEXT（系统选择菜单）与 SEND（应用自带菜单的「分享」）
        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
        if (text == null || text.length() == 0) {
            text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        }
        if (text == null) text = "";
        android.util.Log.d("RPA11y", "forward len=" + text.length() + " act=" + getIntent().getAction());
        PluginHandle handle = getBridge().getPlugin("ProcessText");
        if (handle != null && handle.getInstance() instanceof ProcessTextPlugin) {
            ((ProcessTextPlugin) handle.getInstance()).receive(text.toString(), true);
        }
    }
}
