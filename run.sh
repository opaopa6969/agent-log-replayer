#!/bin/sh
cd "$(dirname "$0")"
exec node --experimental-global-webcrypto dist/index.js
