package com.readpicks.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;
import android.widget.Toast;

/**
 * 全局悬浮球：SYSTEM_ALERT_WINDOW 系统悬浮窗，常驻于所有应用之上。
 * 解决自绘选区菜单（PDF/笔记类）无法划词的场景——点球直接唤起查词卡，不依赖目标应用的任何能力。
 * 拖动移动位置；轻点打开悬浮卡（输入单词查询）。前台服务保证常驻。
 */
public class FloatingBallService extends Service {

    public static volatile boolean running = false;
    private static volatile FloatingBallService instance = null;

    private WindowManager wm;
    private View ball;
    private WindowManager.LayoutParams lp;
    private final Handler longPressHandler = new Handler(Looper.getMainLooper());
    private Runnable longPressRunnable;
    private boolean longPressed;
    private boolean ballMoved;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    /** 卡片打开时隐藏球，关闭/收起后恢复 */
    public static void setVisible(boolean visible) {
        FloatingBallService s = instance;
        if (s == null || s.ball == null) return;
        s.ball.post(() -> {
            if (s.ball != null) s.ball.setVisibility(visible ? View.VISIBLE : View.GONE);
        });
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        instance = this;
        startForegroundWithNotification();
        wm = (WindowManager) getSystemService(WINDOW_SERVICE);

        TextView view = new TextView(this);
        view.setText("词");
        view.setTextColor(Color.WHITE);
        view.setTextSize(17);
        view.setGravity(Gravity.CENTER);
        view.setBackgroundResource(R.drawable.ball_bg);

        int size = dp(46);
        lp = new WindowManager.LayoutParams(size, size, overlayType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        // 位置记忆：上次拖动后的落点（SharedPreferences）
        android.content.SharedPreferences sp = getSharedPreferences("ball", MODE_PRIVATE);
        lp.x = sp.getInt("x", dp(6));
        lp.y = sp.getInt("y", dp(200));

        // 轻点查词；长按截图取词；拖动移动
        view.setOnTouchListener(new View.OnTouchListener() {
            private float downRawX;
            private float downRawY;
            private float downX;
            private float downY;

            @Override
            public boolean onTouch(View v, MotionEvent event) {
                switch (event.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        android.util.Log.d("RPA11y", "ball DOWN raw=" + event.getRawX() + "," + event.getRawY());
                        downRawX = event.getRawX();
                        downRawY = event.getRawY();
                        downX = lp.x;
                        downY = lp.y;
                        ballMoved = false;
                        longPressed = false;
                        if (longPressRunnable != null) longPressHandler.removeCallbacks(longPressRunnable);
                        longPressRunnable = () -> {
                            if (!ballMoved) {
                                longPressed = true;
                                startOcr();
                            }
                        };
                        longPressHandler.postDelayed(longPressRunnable, 550);
                        return true;
                    case MotionEvent.ACTION_MOVE: {
                        float dx = event.getRawX() - downRawX;
                        float dy = event.getRawY() - downRawY;
                        if (Math.abs(dx) > dp(6) || Math.abs(dy) > dp(6)) {
                            if (!ballMoved && longPressRunnable != null) {
                                longPressHandler.removeCallbacks(longPressRunnable);
                            }
                            ballMoved = true;
                        }
                        if (ballMoved) {
                            lp.x = Math.max(0, Math.round(downX + dx));
                            lp.y = Math.max(0, Math.round(downY + dy));
                            wm.updateViewLayout(ball, lp);
                        }
                        return true;
                    }
                    case MotionEvent.ACTION_UP:
                        android.util.Log.d("RPA11y", "ball UP moved=" + ballMoved + " long=" + longPressed);
                        if (longPressRunnable != null) longPressHandler.removeCallbacks(longPressRunnable);
                        if (longPressed) {
                            longPressed = false;
                            return true;
                        }
                        if (ballMoved) {
                            // 位置记忆
                            getSharedPreferences("ball", MODE_PRIVATE).edit()
                                    .putInt("x", lp.x).putInt("y", lp.y).apply();
                        } else {
                            openCard();
                        }
                        return true;
                    case MotionEvent.ACTION_CANCEL:
                        if (longPressRunnable != null) longPressHandler.removeCallbacks(longPressRunnable);
                        longPressed = false;
                        return true;
                    default:
                        return false;
                }
            }
        });

        ball = view;
        wm.addView(ball, lp);
    }

    private void openCard() {
        android.util.Log.d("RPA11y", "openCard");
        try {
            Intent i = new Intent(this, CardActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            String selected = recentSelection();
            if (!selected.isEmpty()) {
                i.putExtra(Intent.EXTRA_PROCESS_TEXT, selected);
            } else {
                // 没有可用选区（如 WebView）：让卡片在前台读剪贴板预填
                i.putExtra(CardActivity.EXTRA_PREFILL_CLIPBOARD, true);
            }
            startActivity(i);
            android.util.Log.d("RPA11y", "openCard startActivity ok len=" + selected.length());
        } catch (Exception e) {
            android.util.Log.d("RPA11y", "openCard failed: " + e.getMessage());
        }
    }

    /** 长按悬浮球：截屏框选取词（覆盖 PDF/图片/游戏等无文本层界面） */
    private void startOcr() {
        if (Build.VERSION.SDK_INT < 30) {
            Toast.makeText(this, "系统版本太低，不支持截屏取词", Toast.LENGTH_SHORT).show();
            return;
        }
        if (!ReadPicksAccessibilityService.running) {
            Toast.makeText(this, "请先开启拾词的无障碍服务", Toast.LENGTH_LONG).show();
            try {
                Intent i = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
            } catch (Exception ignored) {
            }
            return;
        }
        Toast.makeText(this, "请框选一个单词", Toast.LENGTH_SHORT).show();
        ReadPicksAccessibilityService.captureForOcr();
    }

    /** 无障碍缓存里最近一次选区；没有有效下标时只接受短文本（WebView 常把整段当事件文本） */
    private String recentSelection() {
        String text = SelectionHolder.text;
        if (text == null || System.currentTimeMillis() - SelectionHolder.at > 90_000) return "";
        int start = SelectionHolder.start;
        int end = SelectionHolder.end;
        if (start >= 0 && end > start && end <= text.length()) {
            return text.substring(start, end).trim();
        }
        String oneLine = text.trim();
        return oneLine.length() > 0 && oneLine.length() <= 80 && !oneLine.contains("\n") ? oneLine : "";
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private int overlayType() {
        return Build.VERSION.SDK_INT >= 26
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
    }

    private void startForegroundWithNotification() {
        String id = "readpicks_ball";
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new NotificationChannel(id, "悬浮球", NotificationManager.IMPORTANCE_MIN));
        }
        Notification n = null;
        if (Build.VERSION.SDK_INT >= 26) {
            n = new Notification.Builder(this, id)
                    .setSmallIcon(android.R.drawable.ic_menu_search)
                    .setContentTitle("拾词悬浮球运行中")
                    .setContentText("轻点查词 · 长按截图取词 · 拖动移动")
                    .setOngoing(true)
                    .build();
        }
        if (n != null) startForeground(1, n);
    }

    @Override
    public void onDestroy() {
        running = false;
        if (instance == this) instance = null;
        if (longPressRunnable != null) longPressHandler.removeCallbacks(longPressRunnable);
        if (ball != null && wm != null) {
            try {
                wm.removeView(ball);
            } catch (Exception ignored) {
            }
        }
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }
}
