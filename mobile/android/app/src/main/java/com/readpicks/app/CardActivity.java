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
    private volatile int contentHeightCss = -1; // JS 回报的内容高度（CSS px），-1 = 未知

    @Override
    public void onCreate(Bundle savedInstanceState) {
        instance = this;
        registerPlugin(ProcessTextPlugin.class);
        registerPlugin(SelectionPlugin.class);
        super.onCreate(savedInstanceState);
        // 顶部锚定（成熟悬浮翻译应用的通用形态）：卡片贴状态栏下方，不居中悬空
        getWindow().setGravity(android.view.Gravity.TOP | android.view.Gravity.CENTER_HORIZONTAL);
        applyWindowSize();
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

    /** JS 同步卡片尺寸：宽度滑杆百分比 + 内容高度（自适应，封顶 60% 屏高） */
    public static void applySize(float wPct, int contentCss) {
        CardActivity a = instance;
        if (a == null) return;
        a.widthPct = Math.max(60f, Math.min(100f, wPct));
        a.contentHeightCss = contentCss;
        a.runOnUiThread(a::applyWindowSize);
    }

    private void applyWindowSize() {
        DisplayMetrics dm = getResources().getDisplayMetrics();
        int w = Math.round(dm.widthPixels * widthPct / 100f);
        int h;
        if (contentHeightCss > 0) {
            h = Math.min(Math.round(contentHeightCss * dm.density) + dp(8), Math.round(dm.heightPixels * 0.6f));
        } else {
            h = Math.round(dm.heightPixels * 0.55f); // JS 首报前的初始高度
        }
        android.util.Log.d("RPA11y", "applyWindowSize screenW=" + dm.widthPixels
                + " wPct=" + widthPct + " -> w=" + w + " h=" + h);
        getWindow().setLayout(w, h);
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
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
