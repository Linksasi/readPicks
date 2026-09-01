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

    public void receive(String text) {
        pendingText = text;
        JSObject data = new JSObject();
        data.put("text", text);
        notifyListeners("processText", data);
    }

    @PluginMethod
    public void getPending(PluginCall call) {
        JSObject r = new JSObject();
        r.put("text", pendingText == null ? "" : pendingText);
        call.resolve(r);
    }
}
