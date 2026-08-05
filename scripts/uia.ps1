# TranEn UIA 取词脚本（不碰剪贴板）：
# 通过 Windows UI Automation 读取当前焦点窗口的选中文本，
# 并扩展获取选中文本所在的整段文字（语境）。
# 被 main/hotkey.js 的常驻 PowerShell 进程 dot-source 后调用。

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Get-TranenSelection {
    $result = [ordered]@{ selected = ''; context = ''; ok = $false; error = '' }
    try {
        $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
        $el = $focused
        $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
        while ($null -ne $el) {
            $tp = $null
            if ($el.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$tp)) {
                $selection = $tp.GetSelection()
                if ($null -ne $selection -and $selection.Count -gt 0) {
                    $range = $selection[0]
                    $txt = $range.GetText(-1)
                    if ($null -ne $txt) { $result.selected = $txt.Trim() }
                    # 扩展到选中文本所在的整段，作为语境
                    try {
                        $r2 = $range.Clone()
                        $r2.ExpandToEnclosingUnit([System.Windows.Automation.TextUnit]::Paragraph)
                        $para = $r2.GetText(-1)
                        if ($null -ne $para) {
                            if ($para.Length -gt 4000) { $para = $para.Substring(0, 4000) }
                            $result.context = $para
                        }
                    } catch { $null = 1 }
                    $result.ok = $true
                    break
                }
            }
            try { $el = $walker.GetParent($el) } catch { break }
        }
    } catch {
        $result.error = $_.Exception.Message
    }
    return $result
}
