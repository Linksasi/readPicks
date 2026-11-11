package com.readpicks.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.RectF;
import android.os.Build;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;

/**
 * OCR 框选层：截屏画面上盖一层，拖一个框，松手裁图交给识别器。
 * 不依赖目标 App 的文本层，覆盖 PDF/图片/游戏。
 */
public class OcrSelectionOverlay extends View {

    public interface Listener {
        void onCropped(CropResult result);
        void onCancel();
    }

    /** text：框内的整句/整段（不再只裁一个词） */
    public static class CropResult {
        public final Bitmap text;

        CropResult(Bitmap text) {
            this.text = text;
        }
    }

    private final WindowManager wm;
    private final WindowManager.LayoutParams lp;
    private final Bitmap shot;
    private final Listener listener;
    private final Paint dimPaint = new Paint();
    private final Paint borderPaint = new Paint();
    private final Paint textPaint = new Paint();
    private final Paint cancelBg = new Paint();
    private final RectF sel = new RectF();
    private final RectF cancelRect = new RectF();
    private final Rect drawRect = new Rect();

    private float downX;
    private float downY;
    private boolean dragging;
    private boolean shown;
    private boolean cancelPressed;

    public OcrSelectionOverlay(Context ctx, Bitmap shot, Listener listener) {
        super(ctx);
        this.shot = shot;
        this.listener = listener;
        wm = (WindowManager) ctx.getSystemService(Context.WINDOW_SERVICE);
        lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                overlayType(),
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        setBackgroundColor(Color.TRANSPARENT);
        dimPaint.setColor(0x99000000);
        borderPaint.setColor(0xFF4C8DFF);
        borderPaint.setStyle(Paint.Style.STROKE);
        borderPaint.setStrokeWidth(dp(2));
        textPaint.setColor(Color.WHITE);
        textPaint.setTextSize(dp(14));
        textPaint.setAntiAlias(true);
        cancelBg.setColor(0x99000000);
        cancelBg.setAntiAlias(true);
    }

    public void show() {
        if (shown) return;
        wm.addView(this, lp);
        shown = true;
    }

    public void remove() {
        if (shown) {
            try {
                wm.removeView(this);
            } catch (Exception ignored) {
            }
            shown = false;
        }
        if (!shot.isRecycled()) shot.recycle();
    }

    @Override
    protected void onDraw(Canvas c) {
        int w = getWidth();
        int h = getHeight();
        if (w <= 0 || h <= 0) return;
        drawRect.set(0, 0, w, h);
        c.drawBitmap(shot, null, drawRect, null);
        c.drawRect(0, 0, w, h, dimPaint);
        if (sel.width() > 0 && sel.height() > 0) {
            c.save();
            c.clipRect(sel);
            c.drawBitmap(shot, null, drawRect, null);
            c.restore();
            c.drawRect(sel, borderPaint);
        }
        c.drawText("框选一整句，松手识别", dp(20), dp(56), textPaint);
        float cx = w - dp(86);
        float cy = dp(30);
        cancelRect.set(cx, cy - dp(16), w - dp(12), cy + dp(16));
        c.drawRoundRect(cancelRect, dp(16), dp(16), cancelBg);
        c.drawText("取消", cancelRect.centerX() - textPaint.measureText("取消") / 2,
                cancelRect.centerY() + dp(5), textPaint);
    }

    @Override
    public boolean onTouchEvent(MotionEvent e) {
        float x = e.getX();
        float y = e.getY();
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                if (cancelRect.contains(x, y)) {
                    cancelPressed = true;
                    return true;
                }
                downX = x;
                downY = y;
                sel.set(x, y, x, y);
                dragging = true;
                invalidate();
                return true;
            case MotionEvent.ACTION_MOVE:
                if (dragging) {
                    sel.set(Math.min(downX, x), Math.min(downY, y),
                            Math.max(downX, x), Math.max(downY, y));
                    invalidate();
                }
                return true;
            case MotionEvent.ACTION_UP:
                if (cancelPressed) {
                    cancelPressed = false;
                    if (listener != null) listener.onCancel();
                    return true;
                }
                if (!dragging) return true;
                dragging = false;
                if (sel.width() < dp(8) || sel.height() < dp(8)) {
                    sel.setEmpty();
                    invalidate();
                    return true;
                }
                CropResult crop = cropSelection();
                if (crop != null && listener != null) {
                    listener.onCropped(crop);
                } else {
                    sel.setEmpty();
                    invalidate();
                }
                return true;
            default:
                return true;
        }
    }

    private CropResult cropSelection() {
        int w = Math.max(1, getWidth());
        int h = Math.max(1, getHeight());
        int bw = shot.getWidth();
        int bh = shot.getHeight();
        // 框选稍微外扩，避免用户框得太紧把首尾字母切掉
        int pad = dp(6);
        int x = Math.round((sel.left - pad) * bw / w);
        int y = Math.round((sel.top - pad) * bh / h);
        int r = Math.round((sel.right + pad) * bw / w);
        int b = Math.round((sel.bottom + pad) * bh / h);
        x = Math.max(0, Math.min(x, bw - 1));
        y = Math.max(0, Math.min(y, bh - 1));
        r = Math.max(x + 1, Math.min(r, bw));
        b = Math.max(y + 1, Math.min(b, bh));
        try {
            return new CropResult(Bitmap.createBitmap(shot, x, y, r - x, b - y));
        } catch (Exception e) {
            return null;
        }
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private int overlayType() {
        return Build.VERSION.SDK_INT >= 26
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
    }
}
