package com.readpicks.app;

import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 划词语境：读无障碍服务缓存（ReadPicksAccessibilityService）。
 * 手机端「划一个词带出整句」的数据来源——查词卡入库前调 getRecent()，句内定位 + 挖空在 JS 侧完成。
 */
@CapacitorPlugin(name = "Selection")
public class SelectionPlugin extends Plugin {

    @PluginMethod
    public void getRecent(PluginCall call) {
        String word = call.getString("word") == null ? "" : call.getString("word");
        // 缓存为空或过期时主动扫描窗口树兜底（静态文本/网页的选区事件可能不触发或不带下标）
        long age = System.currentTimeMillis() - SelectionHolder.at;
        if (SelectionHolder.text == null || age > 90_000) {
            ReadPicksAccessibilityService.scanSelectionIntoHolder(word);
        }
        JSObject r = new JSObject();
        r.put("text", SelectionHolder.text == null ? "" : SelectionHolder.text);
        r.put("start", SelectionHolder.start);
        r.put("end", SelectionHolder.end);
        r.put("pkg", SelectionHolder.pkg == null ? "" : SelectionHolder.pkg);
        r.put("at", SelectionHolder.at);
        call.resolve(r);
    }

    @PluginMethod
    public void isRunning(PluginCall call) {
        JSObject r = new JSObject();
        r.put("running", ReadPicksAccessibilityService.running);
        call.resolve(r);
    }

    /** 跳转系统无障碍设置（语境服务只能由用户在系统设置里开启） */
    @PluginMethod
    public void openAccessibilitySettings(PluginCall call) {
        Intent i = new Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }
}
