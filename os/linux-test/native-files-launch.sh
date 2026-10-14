#!/bin/sh
# Fixed ordinary-user commands for the disposable VM; never a browser API.
set -eu
test "$#" = 1 || exit 64
case "$1" in paint|writer|calculator|files|documents|downloads|trash|solitaire|minesweeper|pinball|puzzlebox) ;; *) exit 64 ;; esac
exec /opt/kidos-node/v24.21.0/bin/node /opt/kidos-linux-test/native-files.mjs --launch "$1"
