package com.readpicks.app;

import android.content.Intent;
import android.graphics.Color;
import android.graphics.Outline;
import android.os.Bundle;
import android.util.DisplayMetrics;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewOutlineProvider;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

/**
 * 划词悬浮卡：PROCESS_TEXT 直接拉起的对话框式半透明 Activity。
 * 形态对标 PC 端悬浮窗——浮在源应用上方，关闭即回到阅读处，不打断心流。
 * 不依赖 WebView 透明（部分设备不可靠）：WebView 本身被原生裁成卡片矩形（圆角裁切），
 * 四周留边处直接露出源应用 + 系统压暗。卡片宽度和内容高度由 JS 经 setCardSize 同步。
 */
public class CardActivity extends BridgeActivity {

    private static volatile CardActivity instance = null;
    private volatile float widthPct = 94f;
    private volatile int contentHeightCss = -1; // JS 报告的网页内容高度（CSS px）

    @Override
    public void onCreate(Bundle savedInstanceState) {
        instance = this;
        registerPlugin(ProcessTextPlugin.class);
        registerPlugin(SelectionPlugin.class);
        super.onCreate(savedInstanceState);
        getBridge().getWebView().setBackgroundColor(Color.TRANSPARENT);
        styleCard();
        forwardProcessText(getIntent());
    }

    @Override
    public void onResume() {
        super.onResume();
        styleCard();
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

    /** JS 侧同步卡片尺寸（宽度百分比 + 内容高度 CSS px） */
    public static void applySize(float wPct, int contentCss) {
        CardActivity a = instance;
        if (a == null) return;
        a.widthPct = Math.max(60f, Math.min(100f, wPct));
        a.contentHeightCss = contentCss;
        android.util.Log.d("RPA11y", "applySize wPct=" + a.widthPct + " contentCss=" + contentCss);
        a.runOnUiThread(a::styleCard);
    }

    /** 把 WebView 布局成居中的圆角卡片矩形 */
    private void styleCard() {
        View wv = getBridge().getWebView();
        if (wv == null || !(wv.getLayoutParams() instanceof ViewGroup.MarginLayoutParams)) return;
        DisplayMetrics dm = getResources().getDisplayMetrics();
        int screenW = dm.widthPixels;
        int screenH = dm.heightPixels;
        int side = Math.max(8, Math.round((screenW * (100f - widthPct)) / 200f));
        int top = Math.round(36 * dm.density);
        int bottom = Math.round(16 * dm.density);
        android.util.Log.d("RPA11y", "styleCard screenW=" + screenW + " d=" + dm.density
                + " side=" + side + " top=" + top + " h=" + (contentHeightCss > 0 ? "content" : "match"));

        ViewGroup.MarginLayoutParams lp = (ViewGroup.MarginLayoutParams) wv.getLayoutParams();
        lp.setMargins(side, top, side, bottom);
        if (contentHeightCss > 0) {
            int content = Math.round(contentHeightCss * dm.density);
            lp.height = Math.min(top + content + bottom, Math.round(screenH * 0.72f));
        } else {
            lp.height = Math.round(screenH * 0.62f); // JS 首次回报前的初始高度（避免满屏闪烁）
        }
        lp.width = ViewGroup.LayoutParams.MATCH_PARENT;
        wv.setLayoutParams(lp);

        float radius = 16 * dm.density;
        wv.setOutlineProvider(new ViewOutlineProvider() {
            @Override
            public void getOutline(View view, Outline outline) {
                outline.setRoundRect(0, 0, view.getWidth(), view.getHeight(), radius);
            }
        });
        wv.setClipToOutline(true);
        wv.setBackgroundColor(Color.TRANSPARENT);
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
