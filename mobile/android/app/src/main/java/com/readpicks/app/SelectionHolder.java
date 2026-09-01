package com.readpicks.app;

/** 无障碍服务缓存最近一次选中文本（进程级共享，进程被杀即清空） */
public class SelectionHolder {
    public static String text = null;
    public static int start = -1;
    public static int end = -1;
    public static String pkg = "";
    public static long at = 0;
}
