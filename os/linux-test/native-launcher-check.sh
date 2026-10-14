#!/bin/sh
set -eu
unset NODE_OPTIONS NODE_PATH LD_PRELOAD LD_LIBRARY_PATH
exec /opt/kidos-node/v24.21.0/bin/node /opt/kidos-linux-test/native-launcher-check.mjs "$@"
