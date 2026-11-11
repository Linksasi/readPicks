package com.readpicks.app;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityService.ScreenshotResult;
import android.accessibilityservice.AccessibilityService.TakeScreenshotCallback;
import android.graphics.Bitmap;
import android.graphics.ColorSpace;
import android.hardware.HardwareBuffer;
import android.os.Handler;
import android.view.Display;

/**
 * API 30+ 的截屏逻辑单独成类：旧系统不会加载到 ScreenshotResult / takeScreenshot 这些新 API。
 */
final class OcrCapture {

    interface Callback {
        void onBitmap(Bitmap bmp);
        void onError(String message);
    }

    private OcrCapture() {
    }

    static void capture(AccessibilityService service, Handler handler, Callback callback) {
        service.takeScreenshot(Display.DEFAULT_DISPLAY, command -> handler.post(command),
                new TakeScreenshotCallback() {
                    @Override
                    public void onSuccess(ScreenshotResult result) {
                        HardwareBuffer buffer = result.getHardwareBuffer();
                        ColorSpace colorSpace = result.getColorSpace();
                        Bitmap bmp = null;
                        try {
                            if (buffer != null) {
                                bmp = Bitmap.wrapHardwareBuffer(buffer, colorSpace);
                                if (bmp != null) bmp = bmp.copy(Bitmap.Config.ARGB_8888, false);
                            }
                        } catch (Exception e) {
                            android.util.Log.d("RPA11y", "screenshot decode failed: " + e.getMessage());
                        } finally {
                            if (buffer != null) buffer.close();
                        }
                        Bitmap resultBmp = bmp;
                        handler.post(() -> callback.onBitmap(resultBmp));
                    }

                    @Override
                    public void onFailure(int errorCode) {
                        String message;
                        if (errorCode == AccessibilityService.ERROR_TAKE_SCREENSHOT_SECURE_WINDOW) {
                            message = "当前界面禁止截图";
                        } else if (errorCode == AccessibilityService.ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT) {
                            message = "截屏太频繁，稍后再试";
                        } else if (errorCode == AccessibilityService.ERROR_TAKE_SCREENSHOT_NO_ACCESSIBILITY_ACCESS) {
                            message = "无障碍服务未授权截屏";
                        } else {
                            message = "截屏失败（" + errorCode + "）";
                        }
                        String finalMessage = message;
                        handler.post(() -> callback.onError(finalMessage));
                    }
                });
    }
}
