package com.readpicks.app;

import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

/**
 * 划词悬浮卡（方案 1）：全屏透明 Activity，卡片本身是 HTML 里的圆角 div。
 * 窗口不再做卡片大小/圆角裁切，源应用和 scrim 都在下面，CSS 负责纸面、阴影和动画。
 */
public class CardActivity extends BridgeActivity {

    private static volatile CardActivity instance = null;
    public static final String EXTRA_PREFILL_CLIPBOARD = "com.readpicks.app.PREFILL_CLIPBOARD";
    public static final String EXTRA_OCR_CONTEXT = "com.readpicks.app.OCR_CONTEXT";
    public static final String EXTRA_PICK_WORD = "com.readpicks.app.PICK_WORD";
    private boolean closing = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        instance = this;
        registerPlugin(ProcessTextPlugin.class);
        registerPlugin(SelectionPlugin.class);
        super.onCreate(savedInstanceState);
        // BridgeActivity 会把 Activity 主题换成 AppTheme.NoActionBar，透明窗底被覆盖；钉回 CardTheme
        setTheme(R.style.CardTheme);
        getWindow().setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        getWindow().setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        getBridge().getWebView().setBackgroundColor(Color.TRANSPARENT);
        clearParentBackgrounds();
        FloatingBallService.setVisible(false);
        forwardProcessText(getIntent());
    }

    @Override
    public void onBackPressed() {
        finishCard();
    }

    @Override
    public void onPause() {
        FloatingBallService.setVisible(true);
        super.onPause();
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        forwardProcessText(intent);
    }

    @Override
    public void onDestroy() {
        FloatingBallService.setVisible(true);
        closing = true;
        if (instance == this) instance = null;
        super.onDestroy();
    }

    /** 上滑收起：有悬浮球就留下球，没有就只是关闭卡片 */
    public static void minimize() {
        CardActivity a = instance;
        if (a == null) return;
        a.runOnUiThread(a::minimizeNow);
    }

    private void minimizeNow() {
        boolean hasBall = FloatingBallService.running;
        closing = true;
        finish();
        if (hasBall) {
            android.widget.Toast.makeText(this, "已收起到悬浮球", android.widget.Toast.LENGTH_SHORT).show();
        }
    }

    public static void close() {
        CardActivity a = instance;
        if (a == null) return;
        a.runOnUiThread(a::finishCard);
    }

    private void finishCard() {
        if (closing) return;
        closing = true;
        finish();
    }

    /** 全屏透明窗口：把 WebView 到 decor 之间的白底/内边距全部清掉 */
    private void clearParentBackgrounds() {
        View layer = getBridge().getWebView();
        layer.setPadding(0, 0, 0, 0);
        while (layer.getParent() instanceof ViewGroup) {
            ViewGroup vg = (ViewGroup) layer.getParent();
            if (vg == getWindow().getDecorView()) break;
            ((View) vg).setBackgroundColor(Color.TRANSPARENT);
            ((View) vg).setPadding(0, 0, 0, 0);
            layer = vg;
        }
        getWindow().getDecorView().setBackgroundColor(Color.TRANSPARENT);
        getWindow().getDecorView().setPadding(0, 0, 0, 0);
    }

    private void forwardProcessText(Intent intent) {
        if (intent == null) return;
        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
        if (text == null || text.length() == 0) {
            text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        }
        if (text == null) text = "";
        boolean prefillClipboard = intent.getBooleanExtra(EXTRA_PREFILL_CLIPBOARD, false);
        boolean pickWord = intent.getBooleanExtra(EXTRA_PICK_WORD, false);
        String ocrContext = intent.getStringExtra(EXTRA_OCR_CONTEXT);
        android.util.Log.d("RPA11y", "forward len=" + text.length() + " clip=" + prefillClipboard
                + " pick=" + pickWord
                + " ctx=" + (ocrContext == null ? 0 : ocrContext.length())
                + " act=" + getIntent().getAction());
        PluginHandle handle = getBridge().getPlugin("ProcessText");
        if (handle != null && handle.getInstance() instanceof ProcessTextPlugin) {
            ((ProcessTextPlugin) handle.getInstance()).receive(text.toString(), true, prefillClipboard, ocrContext, pickWord);
        }
    }
}
