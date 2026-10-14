package com.lasarac.taskmanager;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;

import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // v1.2.21：**必须**在 super.onCreate() 之前注册插件。
        //
        // 根因（拖了两个大版本）：Capacitor 的 BridgeActivity.onCreate() 内部会 this.load()，
        // 而 load() 用 initialPlugins 建 bridge（BridgeActivity.java:42/48）。
        // super.onCreate() 一返回，bridge 已经建好 —— 此后再 registerPlugin 只是往一个
        // 没人再读的列表里 add，插件**永远不会注册**。
        // 症状（用户实测）：「本包未内置安装插件」= Plugins.ApkInstaller 为空 → APK 自更新
        // 从来不可用；Plugins.Http 为空 → nativeHttp 静默回落到被 CORS 拦的 webview fetch
        // → 贝壳课表 USTB 登录必挂。
        registerPlugin(InsetsPlugin.class);      // 系统栏安全区 → Web
        registerPlugin(ApkInstallerPlugin.class); // APK 自更新
        // 原生 HTTP 通道（绕 webview CORS）。npm 装了包，但 `cap sync` 会被沙箱
        // safe-delete 拦住，所以按它本该生成的样子手写接线：
        // android/capacitor.settings.gradle + app/capacitor.build.gradle + 这里。
        registerPlugin(com.getcapacitor.plugin.http.Http.class);

        super.onCreate(savedInstanceState);

        // v1.2.11：显式全屏布局（edge-to-edge），系统栏透明。
        // 内容避让不再依赖各机型 WebView 对 env(safe-area-inset-*) 的实现差异，
        // 而是由 Web 层使用 InsetsPlugin 给出的权威值做 padding —— 这是移动端
        // 「状态栏盖住顶栏、手势条压住悬浮球」这类重叠的根治办法。
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // 关掉系统自动加的对比度遮罩，否则状态栏会浮现一条灰底
            getWindow().setStatusBarContrastEnforced(false);
            getWindow().setNavigationBarContrastEnforced(false);
        }
    }
}
