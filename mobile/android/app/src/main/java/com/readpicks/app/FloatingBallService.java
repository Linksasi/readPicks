package com.readpicks.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.IBinder;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;

/**
 * 全局悬浮球：SYSTEM_ALERT_WINDOW 系统悬浮窗，常驻于所有应用之上。
 * 解决自绘选区菜单（PDF/笔记类）无法划词的场景——点球直接唤起查词卡，不依赖目标应用的任何能力。
 * 拖动移动位置；轻点打开悬浮卡（输入单词查询）。前台服务保证常驻。
 */
public class FloatingBallService extends Service {

    public static volatile boolean running = false;

    private WindowManager wm;
    private View ball;
    private WindowManager.LayoutParams lp;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
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
        lp.x = dp(6);
        lp.y = dp(200);

        // 拖动移动；位移小于阈值视为轻点 → 打开悬浮卡
        view.setOnTouchListener(new View.OnTouchListener() {
            private float downRawX;
            private float downRawY;
            private float downX;
            private float downY;
            private boolean moved;

            @Override
            public boolean onTouch(View v, MotionEvent event) {
                switch (event.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        android.util.Log.d("RPA11y", "ball DOWN raw=" + event.getRawX() + "," + event.getRawY());
                        downRawX = event.getRawX();
                        downRawY = event.getRawY();
                        downX = lp.x;
                        downY = lp.y;
                        moved = false;
                        return true;
                    case MotionEvent.ACTION_MOVE: {
                        float dx = event.getRawX() - downRawX;
                        float dy = event.getRawY() - downRawY;
                        if (Math.abs(dx) > dp(6) || Math.abs(dy) > dp(6)) moved = true;
                        if (moved) {
                            lp.x = Math.max(0, Math.round(downX + dx));
                            lp.y = Math.max(0, Math.round(downY + dy));
                            wm.updateViewLayout(ball, lp);
                        }
                        return true;
                    }
                    case MotionEvent.ACTION_UP:
                        android.util.Log.d("RPA11y", "ball UP moved=" + moved);
                        if (!moved) openCard();
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
            startActivity(i);
            android.util.Log.d("RPA11y", "openCard startActivity ok");
        } catch (Exception e) {
            android.util.Log.d("RPA11y", "openCard failed: " + e.getMessage());
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
                    .setContentText("轻点查词 · 长按拖动 · 通知可在设置中静音")
                    .setOngoing(true)
                    .build();
        }
        if (n != null) startForeground(1, n);
    }

    @Override
    public void onDestroy() {
        running = false;
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
