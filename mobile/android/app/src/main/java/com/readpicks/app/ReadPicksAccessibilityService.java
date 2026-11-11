package com.readpicks.app;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import android.widget.TextView;
import android.widget.Toast;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

/**
 * 跨软件取词语境：监听全系统「文本选择变化」事件，缓存选中位置的节点全文与选中下标。
 * 只读不写、不监听按键；节点全文供 JS 提取所在句子（PROCESS_TEXT 只带选中词，语境靠这里补齐）。
 */
public class ReadPicksAccessibilityService extends AccessibilityService {

    public static volatile boolean running = false;
    private static volatile ReadPicksAccessibilityService instance = null;

    private WindowManager bubbleWm;
    private TextView bubbleView;
    private WindowManager.LayoutParams bubbleParams;
    private final Handler bubbleHandler = new Handler(Looper.getMainLooper());
    private Runnable bubbleShowRunnable;
    private Runnable bubbleHideRunnable;
    private String bubbleText = "";

    private TextRecognizer ocrRecognizer;
    private OcrSelectionOverlay ocrOverlay;

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        running = true;
        instance = this;
        bubbleWm = (WindowManager) getSystemService(WINDOW_SERVICE);
    }

    @Override
    public boolean onUnbind(Intent intent) {
        running = false;
        instance = null;
        hideBubble();
        removeOcrOverlay();
        if (ocrRecognizer != null) {
            ocrRecognizer.close();
            ocrRecognizer = null;
        }
        return super.onUnbind(intent);
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event.getEventType() != AccessibilityEvent.TYPE_VIEW_TEXT_SELECTION_CHANGED) return;
        // 拾词自己界面里的选区（复制时的 select-all 等）永远不是「阅读语境」
        String eventPkg = event.getPackageName() == null ? "" : event.getPackageName().toString();
        if (getPackageName().equals(eventPkg)) return;

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
        android.util.Log.d("RPA11y", "selection event pkg=" + eventPkg
                + " src=" + (node != null) + " idx=" + start + ".." + end
                + " textLen=" + (text == null ? -1 : text.length()));
        // 选区收起/密码框：不显示浮钮
        if (start >= 0 && end <= start) {
            hideBubble();
            return;
        }
        if (event.isPassword() || (node != null && node.isPassword())) {
            hideBubble();
            return;
        }
        cacheSelection(text, start, end, eventPkg);
        String selected = extractSelection(text, start, end, event);
        if (selected.isEmpty() || selected.length() > 300) {
            hideBubble();
            return;
        }
        Rect bounds = new Rect();
        try {
            if (node != null) node.getBoundsInScreen(bounds);
        } catch (Exception ignored) {
        }
        scheduleBubble(selected, bounds);
    }

    /** 取选区文本：优先用节点下标；WebView 等只给事件文本时，仅接受短文本 */
    private static String extractSelection(CharSequence text, int start, int end, AccessibilityEvent event) {
        if (text == null) return "";
        if (start >= 0 && end > start && end <= text.length()) {
            return text.subSequence(start, end).toString().trim();
        }
        if (event.getText() != null && !event.getText().isEmpty()) {
            CharSequence t = event.getText().get(0);
            if (t != null) {
                String s = t.toString().trim();
                if (!s.isEmpty() && s.length() <= 80 && !s.contains("\n")) return s;
            }
        }
        return "";
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
            AccessibilityNodeInfo best = null;
            for (AccessibilityWindowInfo win : svc.getWindows()) {
                if (win == null) continue;
                AccessibilityNodeInfo root = win.getRoot();
                if (root == null) continue;
                String rootPkg = root.getPackageName() == null ? "" : root.getPackageName().toString();
                if (svc.getPackageName().equals(rootPkg)) continue; // 跳过拾词自己的窗口
                AccessibilityNodeInfo hit = findNodeContainingWord(root, needle, 0);
                // 多个节点含词时取最长文本（段落优于标题行，语境更完整）
                if (hit != null && (best == null || hit.getText().length() > best.getText().length())) {
                    best = hit;
                }
            }
            if (best != null) {
                CharSequence t = best.getText();
                int s = best.getTextSelectionStart();
                int e = best.getTextSelectionEnd();
                boolean hasSel = s >= 0 && e > s;
                cacheSelection(t, hasSel ? s : -1, hasSel ? e : -1, "scan");
                android.util.Log.d("RPA11y", "scan hit len=" + t.length());
                return;
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

    // ---------- 选区浮钮（不依赖目标 App 的 PROCESS_TEXT 菜单） ----------

    private void scheduleBubble(String text, Rect bounds) {
        if (bubbleWm == null || !Settings.canDrawOverlays(this)) return;
        bubbleText = text;
        if (bubbleShowRunnable != null) bubbleHandler.removeCallbacks(bubbleShowRunnable);
        final int left = bounds.left;
        final int top = bounds.top;
        final int right = bounds.right;
        final int bottom = bounds.bottom;
        bubbleShowRunnable = () -> showBubble(bubbleText, left, top, right, bottom);
        bubbleHandler.postDelayed(bubbleShowRunnable, 180);
    }

    private void showBubble(String text, int left, int top, int right, int bottom) {
        if (text == null || text.isEmpty() || !Settings.canDrawOverlays(this)) return;
        try {
            if (bubbleView == null) {
                bubbleView = new TextView(this);
                bubbleView.setText("拾词");
                bubbleView.setTextColor(Color.WHITE);
                bubbleView.setTextSize(13);
                bubbleView.setGravity(Gravity.CENTER);
                bubbleView.setPadding(dp(10), 0, dp(10), 0);
                bubbleView.setBackgroundResource(R.drawable.selection_bubble_bg);
                bubbleView.setOnClickListener(v -> {
                    String t = bubbleText;
                    hideBubble();
                    if (t != null && !t.isEmpty()) openCard(t);
                });
                bubbleParams = new WindowManager.LayoutParams(
                        WindowManager.LayoutParams.WRAP_CONTENT,
                        dp(34),
                        overlayType(),
                        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                                | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                        PixelFormat.TRANSLUCENT);
                bubbleParams.gravity = Gravity.TOP | Gravity.START;
                bubbleWm.addView(bubbleView, bubbleParams);
            }
            bubbleText = text;
            DisplayMetrics dm = getResources().getDisplayMetrics();
            int w = dp(56);
            int h = dp(34);
            int x = right > left ? right - w : dm.widthPixels - w - dp(12);
            int y = bottom > top ? top - h - dp(6) : dp(120);
            x = Math.max(dp(6), Math.min(x, dm.widthPixels - w - dp(6)));
            y = Math.max(dp(30), Math.min(y, dm.heightPixels - h - dp(80)));
            bubbleParams.x = x;
            bubbleParams.y = y;
            bubbleWm.updateViewLayout(bubbleView, bubbleParams);
            if (bubbleHideRunnable != null) bubbleHandler.removeCallbacks(bubbleHideRunnable);
            bubbleHideRunnable = this::hideBubble;
            bubbleHandler.postDelayed(bubbleHideRunnable, 8000);
        } catch (Exception e) {
            android.util.Log.d("RPA11y", "bubble show failed: " + e.getMessage());
            hideBubble();
        }
    }

    private void hideBubble() {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            bubbleHandler.post(this::hideBubble);
            return;
        }
        if (bubbleShowRunnable != null) {
            bubbleHandler.removeCallbacks(bubbleShowRunnable);
            bubbleShowRunnable = null;
        }
        if (bubbleHideRunnable != null) {
            bubbleHandler.removeCallbacks(bubbleHideRunnable);
            bubbleHideRunnable = null;
        }
        if (bubbleView != null && bubbleWm != null) {
            try {
                bubbleWm.removeView(bubbleView);
            } catch (Exception ignored) {
            }
            bubbleView = null;
            bubbleParams = null;
        }
    }

    private void openCard(String text) {
        openCard(text, null);
    }

    private void openCard(String text, String context) {
        try {
            Intent i = new Intent(this, CardActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            i.putExtra(Intent.EXTRA_PROCESS_TEXT, text);
            if (context != null && !context.isEmpty()) {
                i.putExtra(CardActivity.EXTRA_OCR_CONTEXT, context);
            }
            startActivity(i);
            android.util.Log.d("RPA11y", "bubble openCard len=" + text.length()
                    + " ctx=" + (context == null ? 0 : context.length()));
        } catch (Exception e) {
            android.util.Log.d("RPA11y", "bubble openCard failed: " + e.getMessage());
        }
    }

    private int overlayType() {
        return Build.VERSION.SDK_INT >= 26
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    // ---------- OCR 框选（无文本层界面：PDF / 图片 / 游戏） ----------

    /** 悬浮球长按入口：截当前屏幕并进入框选模式 */
    public static void captureForOcr() {
        ReadPicksAccessibilityService svc = instance;
        if (svc == null) return;
        svc.doCaptureForOcr();
    }

    private void doCaptureForOcr() {
        bubbleHandler.post(() -> {
            if (Build.VERSION.SDK_INT < 30) {
                toast("系统版本太低，不支持截屏取词");
                return;
            }
            if (!Settings.canDrawOverlays(this)) {
                toast("请先允许「显示在其他应用上层」");
                return;
            }
            toast("正在截屏…");
            OcrCapture.capture(this, bubbleHandler, new OcrCapture.Callback() {
                @Override
                public void onBitmap(Bitmap bmp) {
                    bubbleHandler.post(() -> showOcrOverlay(bmp));
                }

                @Override
                public void onError(String message) {
                    bubbleHandler.post(() -> toast(message));
                }
            });
        });
    }

    private void showOcrOverlay(Bitmap bmp) {
        hideBubble();
        removeOcrOverlay();
        if (bmp == null) {
            toast("截屏失败");
            return;
        }
        if (!Settings.canDrawOverlays(this)) {
            bmp.recycle();
            toast("请先允许「显示在其他应用上层」");
            return;
        }
        ocrOverlay = new OcrSelectionOverlay(this, bmp, new OcrSelectionOverlay.Listener() {
            @Override
            public void onCropped(OcrSelectionOverlay.CropResult result) {
                bubbleHandler.post(() -> {
                    removeOcrOverlay();
                    runOcr(result);
                });
            }

            @Override
            public void onCancel() {
                bubbleHandler.post(ReadPicksAccessibilityService.this::removeOcrOverlay);
            }
        });
        try {
            ocrOverlay.show();
        } catch (Exception e) {
            android.util.Log.d("RPA11y", "ocr overlay failed: " + e.getMessage());
            removeOcrOverlay();
            toast("不能显示框选层");
        }
    }

    private void runOcr(OcrSelectionOverlay.CropResult result) {
        if (result == null || result.text == null) return;
        toast("识别中…");
        if (ocrRecognizer == null) {
            ocrRecognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        }
        final Bitmap bmp = result.text;
        ocrRecognizer.process(InputImage.fromBitmap(bmp, 0))
                .addOnSuccessListener(text -> {
                    String s = cleanOcr(text == null ? "" : text.getText());
                    bubbleHandler.post(() -> {
                        if (!bmp.isRecycled()) bmp.recycle();
                        if (s.isEmpty()) {
                            toast("没识别到文字");
                            return;
                        }
                        if (s.trim().split("\\s+").length > 1) openCardPick(s);
                        else openCard(s);
                    });
                })
                .addOnFailureListener(e -> bubbleHandler.post(() -> {
                    if (!bmp.isRecycled()) bmp.recycle();
                    toast("识别失败：" + e.getMessage());
                }));
    }

    /** 多词：先开分词选择卡，用户点哪个词再查哪个词 */
    private void openCardPick(String sentence) {
        try {
            Intent i = new Intent(this, CardActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            i.putExtra(Intent.EXTRA_PROCESS_TEXT, sentence);
            i.putExtra(CardActivity.EXTRA_PICK_WORD, true);
            startActivity(i);
            android.util.Log.d("RPA11y", "pickCard len=" + sentence.length());
        } catch (Exception e) {
            android.util.Log.d("RPA11y", "pickCard failed: " + e.getMessage());
        }
    }

    private static String cleanOcr(String raw) {
        String s = String.valueOf(raw == null ? "" : raw).replace('\n', ' ').replace('\r', ' ');
        s = s.replaceAll("^[\\s\\p{Punct}]+", "").replaceAll("[\\s\\p{Punct}]+$", "");
        return s.replaceAll("\\s+", " ").trim();
    }

    private void removeOcrOverlay() {
        if (ocrOverlay != null) {
            ocrOverlay.remove();
            ocrOverlay = null;
        }
    }

    private void toast(String msg) {
        bubbleHandler.post(() -> Toast.makeText(this, msg, Toast.LENGTH_SHORT).show());
    }

    @Override
    public void onInterrupt() {
        // 无前台打断处理；服务仍保持运行
        hideBubble();
        removeOcrOverlay();
    }

    @Override
    public void onDestroy() {
        hideBubble();
        removeOcrOverlay();
        if (ocrRecognizer != null) {
            ocrRecognizer.close();
            ocrRecognizer = null;
        }
        super.onDestroy();
    }
}
