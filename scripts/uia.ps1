# TranEn UIA 取词脚本（不碰剪贴板）：
# 1. 取前台窗口 → 遍历其控件树找支持 TextPattern 的元素
# 2. 读取选中文本，并扩展获取所在段落（段落→行逐级回退）
# 被 main/hotkey.js 的常驻 PowerShell 进程 dot-source 后调用。
# 注意：PowerShell 5.1 需要 UTF-8 BOM，且空 catch 块不合法（用 $null = 1）

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

if (-not ("TranenWin32" -as [type])) {
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public class TranenWin32 {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
}
"@
}

function Get-TranenSelection {
    $result = [ordered]@{ selected = ''; context = ''; ok = $false; status = 'no-selection'; error = '' }
    try {
        $hwnd = [TranenWin32]::GetForegroundWindow()
        if ($hwnd -eq [IntPtr]::Zero) { $result.status = 'no-foreground-window'; return $result }
        $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
        if ($null -eq $root) { $result.status = 'no-root-element'; return $result }

        # BFS 遍历控件树（限 1500 个元素）找「有真实选区」的 TextPattern 元素
        $queue = New-Object System.Collections.Queue
        $queue.Enqueue($root)
        $count = 0
        while ($queue.Count -gt 0 -and $count -lt 1500) {
            $count++
            $el = $queue.Dequeue()
            $tp = $null
            if ($el.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$tp)) {
                try {
                    $selection = $tp.GetSelection()
                    if ($null -ne $selection -and $selection.Count -gt 0) {
                        $range = $selection[0]
                        $txt = $range.GetText(-1)
                        # 只认有真实选中文本的控件（地址栏等空选区直接跳过）
                        if ($null -ne $txt -and $txt.Trim().Length -gt 0) {
                            $result.selected = $txt.Trim()
                            $result.ok = $true
                            # 扩展选区到所在段落（失败则尝试行）
                            foreach ($unit in @([System.Windows.Automation.Text.TextUnit]::Paragraph, [System.Windows.Automation.Text.TextUnit]::Line)) {
                                try {
                                    $r2 = $range.Clone()
                                    $r2.ExpandToEnclosingUnit($unit)
                                    $para = $r2.GetText(-1)
                                    if ($null -ne $para) {
                                        if ($para.Length -gt 4000) { $para = $para.Substring(0, 4000) }
                                        if ($para.Length -gt $result.selected.Length) {
                                            $result.context = $para
                                            break
                                        }
                                    }
                                } catch { $null = 1 }
                            }
                            $result.status = 'ok'
                            return $result
                        }
                    }
                } catch {
                    $result.status = 'selection-error'
                    $result.error = $_.Exception.Message
                }
            }
            try {
                foreach ($child in $el.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)) {
                    $queue.Enqueue($child)
                }
            } catch { $null = 1 }
        }
        if ($count -ge 1500) { $result.status = 'tree-too-large' }
    } catch {
        $result.status = 'error'
        $result.error = $_.Exception.Message
    }
    return $result
}
