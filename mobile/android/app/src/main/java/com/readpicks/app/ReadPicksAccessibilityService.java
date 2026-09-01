package com.readpicks.app;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

/**
 * 跨软件取词语境：监听全系统「文本选择变化」事件，缓存选中位置的节点全文与选中下标。
 * 只读不写、不监听按键；节点全文供 JS 提取所在句子（PROCESS_TEXT 只带选中词，语境靠这里补齐）。
 */
public class ReadPicksAccessibilityService extends AccessibilityService {

    public static volatile boolean running = false;

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        running = true;
    }

    @Override
    public boolean onUnbind(Intent intent) {
        running = false;
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
        if (text == null || text.length() == 0 || start < 0 || end <= start) return;
        if (end - start > 2000 || text.length() > 200000) return; // 超大选中/节点不缓存

        SelectionHolder.text = text.toString();
        SelectionHolder.start = start;
        SelectionHolder.end = end;
        SelectionHolder.pkg = event.getPackageName() == null ? "" : event.getPackageName().toString();
        SelectionHolder.at = System.currentTimeMillis();
    }

    @Override
    public void onInterrupt() {
        // 无前台打断处理；服务仍保持运行
    }
}
