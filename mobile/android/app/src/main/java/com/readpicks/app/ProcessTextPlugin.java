package com.readpicks.app;

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
}
