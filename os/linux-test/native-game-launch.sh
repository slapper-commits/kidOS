#!/bin/sh
# Fixed commands for this ordinary-user disposable VM fixture, not an app API.
set -eu
test "$#" = 1 || exit 64
case "$1" in puttzoo|openttd) ;; *) exit 64 ;; esac
test "$(id -un)" = kidos-test || exit 77
test "$(id -u)" = 1000 || exit 77
umask 077
game_root=/home/kidos-test/.local/share/kidos-native-demos
test -d "$game_root" || exit 78
export SDL_VIDEODRIVER=wayland
export XDG_CONFIG_HOME="$game_root/config"
export XDG_DATA_HOME="$game_root/data"
export XDG_CACHE_HOME="$game_root/cache"
cd "$game_root"
case "$1" in
  puttzoo)
    exec /usr/bin/flock -n "$game_root/puttzoo.lock" /usr/games/scummvm \
      --no-fullscreen --gfx-mode=opengl --window-size=960,720 \
      --config="$game_root/config/scummvm.ini" \
      --savepath="$game_root/puttzoo-saves" \
      --path=/opt/kidos-linux-test/game-data/puttzoo scumm:puttzoo \
      > "$game_root/puttzoo.log" 2>&1
    ;;
  openttd)
    exec /usr/bin/flock -n "$game_root/openttd.lock" /usr/games/openttd \
      -v sdl -r 960x640 -I OpenGFX -S OpenSFX -M OpenMSX \
      -c "$game_root/config/openttd/openttd.cfg" \
      > "$game_root/openttd.log" 2>&1
    ;;
esac
