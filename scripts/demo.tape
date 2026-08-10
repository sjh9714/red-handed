# Demo GIF for the README.
#
#   npm run build && vhs scripts/demo.tape
#
# Records the real published command. The font is large on purpose: this image
# gets seen in feeds, where small terminal text reads as noise. The final frame
# alone should carry the whole idea: said "tests pass" this many times, and
# this many times nothing had run.

Output docs/demo.gif

Set Shell zsh
Set FontSize 26
Set Width 1000
Set Height 470
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 45ms
Set Framerate 24

# Warm the npx cache and the scan cache off-screen, so the recording shows the
# answer rather than the download.
Hide
Type "cd /tmp && npx @jinhyuk9714/red-handed@latest >/dev/null 2>&1; clear" Enter
Sleep 15s
Show

Sleep 800ms
Type "npx @jinhyuk9714/red-handed@latest"
Sleep 600ms
Enter

# ~8s warm scan (measured), then hold on the numbers long enough to read them.
Sleep 11s
Screenshot docs/demo-frame.png
Sleep 6s
