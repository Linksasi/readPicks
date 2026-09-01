package com.readpicks.app;

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
}
