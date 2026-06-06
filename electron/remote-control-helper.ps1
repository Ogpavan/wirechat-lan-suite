$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class WireChatRemoteInput
{
    [DllImport("user32.dll")]
    private static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    private static extern void mouse_event(uint dwFlags, uint dx, uint dy, int dwData, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int nIndex);

    private const int SM_XVIRTUALSCREEN = 76;
    private const int SM_YVIRTUALSCREEN = 77;
    private const int SM_CXVIRTUALSCREEN = 78;
    private const int SM_CYVIRTUALSCREEN = 79;

    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;
    private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    private const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    private const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    private const uint MOUSEEVENTF_WHEEL = 0x0800;

    private const uint KEYEVENTF_KEYUP = 0x0002;

    private static double Clamp01(double value)
    {
        if (Double.IsNaN(value) || Double.IsInfinity(value)) return 0;
        if (value < 0) return 0;
        if (value > 1) return 1;
        return value;
    }

    public static void MoveNormalized(double x, double y)
    {
        int left = GetSystemMetrics(SM_XVIRTUALSCREEN);
        int top = GetSystemMetrics(SM_YVIRTUALSCREEN);
        int width = Math.Max(1, GetSystemMetrics(SM_CXVIRTUALSCREEN));
        int height = Math.Max(1, GetSystemMetrics(SM_CYVIRTUALSCREEN));

        int pixelX = left + (int)Math.Round(Clamp01(x) * (width - 1));
        int pixelY = top + (int)Math.Round(Clamp01(y) * (height - 1));
        SetCursorPos(pixelX, pixelY);
    }

    public static void MouseButton(string button, bool isDown)
    {
        uint flags = 0;

        switch ((button ?? "").ToLowerInvariant())
        {
            case "left":
                flags = isDown ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP;
                break;
            case "right":
                flags = isDown ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP;
                break;
            case "middle":
                flags = isDown ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP;
                break;
        }

        if (flags != 0)
        {
            mouse_event(flags, 0, 0, 0, UIntPtr.Zero);
        }
    }

    public static void Wheel(int delta)
    {
        mouse_event(MOUSEEVENTF_WHEEL, 0, 0, delta, UIntPtr.Zero);
    }

    public static void Key(byte vk, bool isDown)
    {
        keybd_event(vk, 0, isDown ? 0u : KEYEVENTF_KEYUP, UIntPtr.Zero);
    }
}
'@

function Get-StringValue($value) {
  if ($null -eq $value) {
    return ''
  }

  return [string]$value
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
  try {
    if ([string]::IsNullOrWhiteSpace($line)) {
      continue
    }

    $inputEvent = $line | ConvertFrom-Json
    $type = Get-StringValue $inputEvent.type

    if ($type -eq 'pointer') {
      $action = Get-StringValue $inputEvent.action
      [WireChatRemoteInput]::MoveNormalized([double]$inputEvent.x, [double]$inputEvent.y)

      if ($action -eq 'down') {
        [WireChatRemoteInput]::MouseButton((Get-StringValue $inputEvent.button), $true)
      } elseif ($action -eq 'up') {
        [WireChatRemoteInput]::MouseButton((Get-StringValue $inputEvent.button), $false)
      } elseif ($action -eq 'wheel') {
        [WireChatRemoteInput]::Wheel([int]$inputEvent.delta)
      }

      continue
    }

    if ($type -eq 'key') {
      $action = Get-StringValue $inputEvent.action
      $virtualKey = [int]$inputEvent.vk

      if ($virtualKey -ge 1 -and $virtualKey -le 254) {
        [WireChatRemoteInput]::Key([byte]$virtualKey, $action -eq 'down')
      }
    }
  } catch {
  }
}
