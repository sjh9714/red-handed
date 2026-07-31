# The short one, for a feed.
#
#   npm run build && vhs scripts/social.tape
#
# docs/demo.gif is the README's version: two checks, room to read, 20s. That is
# right for someone who already clicked through. It is wrong for a timeline,
# where the GIF autoplays next to forty other things and has about two seconds
# to earn the rest.
#
# So this one tells a single story instead: the agent said the tests pass, the
# last run said otherwise, here is the timestamp. One finding, one screen, no
# scrolling, and short enough to loop before anyone gets bored.

Output docs/social.gif

Set Shell zsh
Set FontSize 22
Set Width 1200
Set Height 500
Set Padding 28
Set Theme "Catppuccin Mocha"
Set TypingSpeed 45ms
Set Framerate 24

Hide
# Warm npx's cache off-camera. On a cold cache npx stops to ask "Ok to proceed?"
# before it will fetch anything, and two of the eleven seconds spent watching
# someone type "y" is two seconds not spent on the finding. The command on
# camera is the one in the README, unchanged.
Type "cd /tmp && npx --yes @jinhyuk9714/red-handed@latest --version >/dev/null 2>&1 && clear" Enter
Sleep 20s
Type "clear" Enter
Show

Sleep 500ms
Type "npx @jinhyuk9714/red-handed@latest demo --detectors claim-vs-fail --compact"
Sleep 400ms
Enter

# The finding lands as one block. Hold on it long enough to read the quote and
# the two timestamps, which is the whole point of the image.
Sleep 7s
Screenshot docs/social-frame.png
Sleep 1s
