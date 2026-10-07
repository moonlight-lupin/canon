# Canon's icon for the tray and the Start-menu shortcut (scripts\canon-tray.ps1, scripts\windows-task.ps1):
# Canon's mark (as public/canon-mark.svg), with a dot for the tray: green = running, grey = not running.
Add-Type -AssemblyName System.Drawing

function New-CanonBitmap([string]$dot = '', [int]$size = 32) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.ScaleTransform($size / 32, $size / 32)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $r = 14
  $path.AddArc(0, 0, $r, $r, 180, 90); $path.AddArc(31 - $r, 0, $r, $r, 270, 90)
  $path.AddArc(31 - $r, 31 - $r, $r, $r, 0, 90); $path.AddArc(0, 31 - $r, $r, $r, 90, 90); $path.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#1e2430'))), $path)
  $pen = { param($c, $w) $p = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml($c)), $w; $p.StartCap = 'Round'; $p.EndCap = 'Round'; $p }
  $g.DrawLine((& $pen '#f3eee2' 2.2), 9.5, 10, 22.5, 10)
  $g.DrawLine((& $pen '#a8893c' 3), 16, 5, 16, 27)
  $tick = & $pen '#a8893c' 1.8
  $g.DrawLine($tick, 16, 15, 19.5, 15); $g.DrawLine($tick, 16, 20, 21, 20)
  if ($dot) {
    $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)), 19, 19, 13, 13)
    $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($dot))), 21, 21, 9, 9)
  } else {
    $g.DrawLine($tick, 16, 25.5, 20, 25.5)
  }
  $g.Dispose()
  return $bmp
}

function New-CanonIcon([string]$dot) { [System.Drawing.Icon]::FromHandle((New-CanonBitmap $dot 32).GetHicon()) }

# an .ico file for the shortcuts: one 256-pixel PNG image (Windows scales it)
function Save-CanonIco([string]$file) {
  $ms = New-Object System.IO.MemoryStream
  (New-CanonBitmap '' 256).Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $png = $ms.ToArray()
  $out = New-Object System.IO.MemoryStream
  $w = New-Object System.IO.BinaryWriter $out
  $w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]1)            # header: an icon, one image
  $w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0) # 256 x 256, no palette
  $w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$png.Length); $w.Write([uint32]22)
  $w.Write($png)
  $w.Flush()
  [System.IO.File]::WriteAllBytes($file, $out.ToArray())
}
