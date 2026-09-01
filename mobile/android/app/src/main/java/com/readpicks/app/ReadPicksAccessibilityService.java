package com.readpicks.app;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;

/**
 * 跨软件取词语境：监听全系统「文本选择变化」事件，缓存选中位置的节点全文与选中下标。
 * 只读不写、不监听按键；节点全文供 JS 提取所在句子（PROCESS_TEXT 只带选中词，语境靠这里补齐）。
 */
public class ReadPicksAccessibilityService extends AccessibilityService {

    public static volatile boolean running = false;
    private static volatile ReadPicksAccessibilityService instance = null;

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        running = true;
        instance = this;
    }

    @Override
    public boolean onUnbind(Intent intent) {
        running = false;
        instance = null;
        return super.onUnbind(intent);
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event.getEventType() != AccessibilityEvent.TYPE_VIEW_TEXT_SELECTION_CHANGED) return;

        CharSequence text = (event.getText() != null && !event.getText().isEmpty())
                ? event.getText().get(0) : null;
        int start = -1;
        int end = -1;
        AccessibilityNodeInfo node = event.getSource();
        if (node != null) {
            start = node.getTextSelectionStart();
            end = node.getTextSelectionEnd();
            CharSequence nodeText = node.getText();
            if (nodeText != null && nodeText.length() > 0) text = nodeText;
        }
        android.util.Log.d("RPA11y", "selection event pkg=" + event.getPackageName()
                + " src=" + (node != null) + " idx=" + start + ".." + end
                + " textLen=" + (text == null ? -1 : text.length()));
        cacheSelection(text, start, end, event.getPackageName() == null ? "" : event.getPackageName().toString());
    }

    private static void cacheSelection(CharSequence text, int start, int end, String pkg) {
        // 网页内容（Chrome 等）事件常带整段文本但不带选区下标（idx=-1）——文本本身就是语境，
        // 下标缺失时 JS 侧按词首次命中定位，仍然可用
        if (text == null || text.length() == 0) return;
        if (start >= 0 && end <= start) return;
        if (text.length() > 200000) return;
        SelectionHolder.text = text.toString();
        SelectionHolder.start = start;
        SelectionHolder.end = end;
        SelectionHolder.pkg = pkg == null ? "" : pkg;
        SelectionHolder.at = System.currentTimeMillis();
    }

    /**
     * 按需兜底：选中文本事件在部分应用/渲染路径不触发。
     * 查词卡打开时扫描各窗口的文本节点，找包含查询词的节点缓存（用户刚在哪个视图选词，那个视图就含词）。
     * 跳过自己（卡片自身的输入框），限制深度防卡顿。
     */
    public static void scanSelectionIntoHolder(String word) {
        ReadPicksAccessibilityService svc = instance;
        if (svc == null || word == null || word.length() < 2) return;
        final String needle = word.toLowerCase();
        try {
            // 同步扫描（getWindows/节点遍历为 binder 调用，后台线程可直接执行）：
            // 若 post 到主线程，会与卡片 WebView 初始化竞争主线程导致结果迟到
            if (svc.getWindows() == null) return;
            for (AccessibilityWindowInfo win : svc.getWindows()) {
                if (win == null || win.getRoot() == null) continue;
                AccessibilityNodeInfo root = win.getRoot();
                String rootPkg = root.getPackageName() == null ? "" : root.getPackageName().toString();
                if (svc.getPackageName().equals(rootPkg)) continue; // 跳过拾词自己的窗口
                AccessibilityNodeInfo hit = findNodeContainingWord(root, needle, 0);
                if (hit != null) {
                    CharSequence t = hit.getText();
                    int s = hit.getTextSelectionStart();
                    int e = hit.getTextSelectionEnd();
                    // 有真实选区下标用下标，否则 -1（JS 按词首现定位）
                    boolean hasSel = s >= 0 && e > s;
                    cacheSelection(t, hasSel ? s : -1, hasSel ? e : -1, rootPkg);
                    android.util.Log.d("RPA11y", "scan hit pkg=" + rootPkg + " len=" + t.length());
                    return;
                }
            }
            android.util.Log.d("RPA11y", "scan finished, no matching node");
        } catch (Exception e) {
            android.util.Log.d("RPA11y", "scan failed: " + e.getMessage());
        }
    }

    private static AccessibilityNodeInfo findNodeContainingWord(AccessibilityNodeInfo node, String needle, int depth) {
        if (node == null || depth > 25) return null;
        CharSequence t = node.getText();
        if (t != null && t.length() > needle.length() && t.length() <= 200000
                && t.toString().toLowerCase().contains(needle)) {
            return node;
        }
        int count = node.getChildCount();
        for (int i = 0; i < count && depth < 25; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child == null) continue;
            AccessibilityNodeInfo hit = findNodeContainingWord(child, needle, depth + 1);
            if (hit != null) return hit;
        }
        return null;
    }

    @Override
    public void onInterrupt() {
        // 无前台打断处理；服务仍保持运行
    }
}
