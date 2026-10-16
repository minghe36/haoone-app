param([int]$TargetTrack,[string]$StatusPath)
$ErrorActionPreference = 'Stop'
try {
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class OgrafDestination {
 public delegate bool EnumProc(IntPtr h, IntPtr p);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
 [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int command);
 [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
 [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint source, uint target, bool attach);
 [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
 // Windows may deny foreground activation to a background PowerShell child.
 // Temporarily join the foreground input queue, always detaching afterwards.
 public static bool Activate(IntPtr window) {
  if (IsIconic(window)) ShowWindowAsync(window, 9);
  if (GetForegroundWindow() == window) return true;
  SetForegroundWindow(window);
  if (GetForegroundWindow() == window) return true;
  uint owner;
  uint foregroundThread = GetWindowThreadProcessId(GetForegroundWindow(), out owner);
  uint currentThread = GetCurrentThreadId();
  bool attached = false;
  try {
   if (foregroundThread != 0 && foregroundThread != currentThread)
    attached = AttachThreadInput(currentThread, foregroundThread, true);
   BringWindowToTop(window);
   SetForegroundWindow(window);
   return GetForegroundWindow() == window;
  } finally {
   if (attached) AttachThreadInput(currentThread, foregroundThread, false);
  }
 }
}
'@
$resolveIds = @(Get-Process Resolve | ForEach-Object { [uint32]$_.Id })
$script:targetWindow = [IntPtr]::Zero
[OgrafDestination]::EnumWindows({ param($handle,$unused)
 [uint32]$owner = 0
 [void][OgrafDestination]::GetWindowThreadProcessId($handle,[ref]$owner)
 if ($resolveIds -contains $owner -and [OgrafDestination]::IsWindowVisible($handle)) {
  $title = New-Object System.Text.StringBuilder 512
  [void][OgrafDestination]::GetWindowText($handle,$title,512)
  if ($title.ToString() -like 'DaVinci Resolve*') { $script:targetWindow=$handle; return $false }
 }
 return $true
},[IntPtr]::Zero) | Out-Null
if ($script:targetWindow -eq [IntPtr]::Zero) { throw 'Resolve main window not found' }
# UI Automation patterns can work without foreground focus. Activation is best
# effort; never reject a usable menu simply because Windows denied focus.
[void][OgrafDestination]::Activate($script:targetWindow)
Start-Sleep -Milliseconds 300
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::FromHandle($script:targetWindow)
$menuCondition = New-Object System.Windows.Automation.PropertyCondition(
 [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
 [System.Windows.Automation.ControlType]::MenuItem)
function FindMenu([string]$Expression) {
 for ($attempt=0; $attempt -lt 15; $attempt++) {
  $menus=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$menuCondition)
  foreach ($menu in $menus) {
   if ($menu.Current.Name -match $Expression -and $menu.Current.IsEnabled) { return $menu }
  }
  Start-Sleep -Milliseconds 100
 }
 $names=@($menus | ForEach-Object { $_.Current.Name }) -join ' | '
 throw ('Menu not found: ' + $Expression + '; available: ' + $names)
}
function OpenMenu($Menu) {
 $pattern=$null
 if ($Menu.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern,[ref]$pattern)) {
  $pattern.Expand(); return
 }
 if ($Menu.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)) {
  $pattern.Invoke(); return
 }
 throw ('Menu has no accessible action: ' + $Menu.Current.Name)
}
OpenMenu (FindMenu '^(Timeline|时间线)$')
OpenMenu (FindMenu '(?i)Track Destination Selection|Source Track Selector|源轨道选择器|轨道.*(目标|目的|指派)')
$destination=FindMenu ('(?i)\bV\s*' + $TargetTrack + '(?!\d)\s*(轨道|Track)?')
$pattern=$null
$alreadySelected=$false
if ($destination.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern,[ref]$pattern)) {
 $alreadySelected=$pattern.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On
}
if (-not $alreadySelected) { OpenMenu $destination }
[System.IO.File]::WriteAllText($StatusPath,'OK: Resolve menu ' + $destination.Current.Name)
exit 0
} catch {
 [System.IO.File]::WriteAllText($StatusPath,'ERROR: ' + $_.Exception.Message)
 exit 1
}
