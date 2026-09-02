package com.readpicks.app;

import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 划词入口：MainActivity 收到 ACTION_PROCESS_TEXT 后调 receive()，
 * 热路径走 processText 事件推给 WebView；冷启动时 WebView 尚未监听，由 getPending() 补投递。
 */
@CapacitorPlugin(name = "ProcessText")
public class ProcessTextPlugin extends Plugin {

    private String pendingText = null;
    private boolean pendingCard = false;

    public void receive(String text) {
        receive(text, false);
    }

    /** card=true：由悬浮卡（CardActivity）拉起，网页切换到卡片模式渲染 */
    public void receive(String text, boolean card) {
        pendingText = text;
        pendingCard = card;
        JSObject data = new JSObject();
        data.put("text", text);
        data.put("card", card);
        notifyListeners("processText", data);
    }

    @PluginMethod
    public void getPending(PluginCall call) {
        JSObject r = new JSObject();
        r.put("text", pendingText == null ? "" : pendingText);
        r.put("card", pendingCard);
        call.resolve(r);
    }

    /** 关闭悬浮卡（finish CardActivity，回到源应用）——Capacitor 8 下 App 插件未自动注册，用确定性原生实现 */
    @PluginMethod
    public void closeCard(PluginCall call) {
        getActivity().runOnUiThread(() -> getActivity().finish());
        call.resolve();
    }

    /** 读取剪贴板（仅前台调用；用于「复制单词 → 切到拾词 → 一键查词」的无法划词兜底） */
    @PluginMethod
    public void readClipboard(PluginCall call) {
        JSObject r = new JSObject();
        try {
            android.content.ClipboardManager cm = (android.content.ClipboardManager)
                    getContext().getSystemService(android.content.Context.CLIPBOARD_SERVICE);
            android.content.ClipData cd = cm == null ? null : cm.getPrimaryClip();
            String text = "";
            if (cd != null && cd.getItemCount() > 0 && cd.getItemAt(0) != null) {
                CharSequence t = cd.getItemAt(0).coerceToText(getContext());
                if (t != null) text = t.toString();
            }
            r.put("text", text);
        } catch (Exception e) {
            r.put("text", "");
        }
        call.resolve(r);
    }

    /** 原生 TTS 发音（WebView 无 speechSynthesis，走系统英文 TTS） */
    private android.speech.tts.TextToSpeech tts;
    private String pendingSpeak;

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text");
        if (tts != null) {
            speakNow(text);
            call.resolve();
            return;
        }
        pendingSpeak = text; // 引擎异步初始化，就绪后补播
        tts = new android.speech.tts.TextToSpeech(getContext(), status -> {
            if (status == android.speech.tts.TextToSpeech.SUCCESS) {
                tts.setLanguage(java.util.Locale.US);
                if (pendingSpeak != null) speakNow(pendingSpeak);
            }
            pendingSpeak = null;
        });
        call.resolve();
    }

    private void speakNow(String text) {
        if (tts != null && text != null && !text.isEmpty()) {
            tts.speak(text, android.speech.tts.TextToSpeech.QUEUE_FLUSH, null, "rp");
        }
    }

    /** 悬浮球状态：授权与运行 */
    @PluginMethod
    public void overlayStatus(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", android.provider.Settings.canDrawOverlays(getContext()));
        r.put("running", FloatingBallService.running);
        call.resolve(r);
    }

    /** 开/关悬浮球（前台服务）。未授权时返回 granted=false，由网页引导去系统设置 */
    @PluginMethod
    public void setBall(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on"));
        JSObject r = new JSObject();
        if (on && !android.provider.Settings.canDrawOverlays(getContext())) {
            r.put("granted", false);
            r.put("running", false);
            call.resolve(r);
            return;
        }
        Intent i = new Intent(getContext(), FloatingBallService.class);
        if (on) {
            getContext().startService(i);
        } else {
            getContext().stopService(i);
        }
        r.put("granted", true);
        r.put("running", on && FloatingBallService.running);
        call.resolve(r);
    }

    /** 跳转「显示在其他应用上层」授权页 */
    @PluginMethod
    public void openOverlaySettings(PluginCall call) {
        Intent i = new Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                android.net.Uri.parse("package:" + getContext().getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }
}
